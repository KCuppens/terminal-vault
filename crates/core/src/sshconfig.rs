use std::collections::HashSet;

use crate::model::HostInput;

#[derive(Default)]
struct Block {
    names: Vec<String>,
    hostname: Option<String>,
    user: Option<String>,
    port: Option<String>,
}

fn split_directive(line: &str) -> Option<(String, &str)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let at = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let key = line[..at].to_ascii_lowercase();
    let rest = line[at..].trim_start_matches(|c: char| c.is_whitespace() || c == '=');
    Some((key, rest.trim()))
}

fn words(rest: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut any = false;
    for c in rest.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            '#' if !quoted && cur.is_empty() && !any => break,
            c if c.is_whitespace() && !quoted => {
                if any {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            c => {
                cur.push(c);
                any = true;
            }
        }
    }
    if any {
        out.push(cur);
    }
    out
}

fn is_concrete(pattern: &str) -> bool {
    !pattern.is_empty() && !pattern.starts_with('!') && !pattern.contains(['*', '?'])
}

/// The login name to assume when a block has no `User`: `USER`, else `USERNAME`.
pub fn default_user_from_env() -> Option<String> {
    ["USER", "USERNAME"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
}

/// Turns the `Host` blocks of an OpenSSH client config into host candidates. Wildcard patterns,
/// negations and `Match` blocks are skipped, as is every directive except `HostName`, `User`
/// and `Port`. Like OpenSSH, the first value given in a block wins. A host with no `User`
/// takes `default_user`; with none available it is skipped. A pattern listed twice is kept once.
pub fn parse(text: &str, default_user: Option<&str>) -> Vec<HostInput> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut current: Option<Block> = None;
    for line in text.lines() {
        let Some((key, rest)) = split_directive(line) else {
            continue;
        };
        match key.as_str() {
            "host" => {
                blocks.extend(current.take());
                current = Some(Block {
                    names: words(rest),
                    ..Block::default()
                });
            }
            "match" => blocks.extend(current.take()),
            "hostname" | "user" | "port" => {
                let Some(block) = current.as_mut() else {
                    continue;
                };
                let Some(value) = words(rest).into_iter().next() else {
                    continue;
                };
                let slot = match key.as_str() {
                    "hostname" => &mut block.hostname,
                    "user" => &mut block.user,
                    _ => &mut block.port,
                };
                slot.get_or_insert(value);
            }
            _ => {}
        }
    }
    blocks.extend(current);

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for block in blocks {
        for name in block.names.iter().filter(|n| is_concrete(n)) {
            if !seen.insert(name.to_lowercase()) {
                continue;
            }
            let Some(user) = block
                .user
                .as_deref()
                .or(default_user)
                .filter(|u| !u.is_empty())
            else {
                continue;
            };
            let port = match block.port.as_deref() {
                None => 22,
                Some(p) => match p.parse::<u16>() {
                    Ok(p) if p != 0 => p,
                    _ => continue,
                },
            };
            let addr = block
                .hostname
                .as_deref()
                .map(|h| h.replace("%h", name))
                .unwrap_or_else(|| name.clone());
            out.push(HostInput {
                name: name.clone(),
                addr,
                port,
                user: user.to_string(),
                key_id: None,
                tags: Vec::new(),
                tmux_session: None,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_host_blocks() {
        let text = "\
# comment
Host web
    HostName web.example.com
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host db
  HostName=10.0.0.5
  User = admin
";
        let hosts = parse(text, None);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].name, "web");
        assert_eq!(hosts[0].addr, "web.example.com");
        assert_eq!(hosts[0].user, "deploy");
        assert_eq!(hosts[0].port, 2222);
        assert_eq!(hosts[0].key_id, None);
        assert!(hosts[0].tags.is_empty());
        assert_eq!(hosts[0].tmux_session, None);
        assert_eq!(hosts[1].addr, "10.0.0.5");
        assert_eq!(hosts[1].user, "admin");
        assert_eq!(hosts[1].port, 22);
    }

    #[test]
    fn skips_wildcards_negations_and_match() {
        let text = "\
Host *
  User nobody
Host *.internal gate?
  User x
Host a !b
  User me
Match host c
  User other
Host d
";
        let hosts = parse(text, Some("fallback"));
        let names: Vec<_> = hosts.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, ["a", "d"]);
        assert_eq!(hosts[0].user, "me");
        assert_eq!(hosts[1].user, "fallback");
    }

    #[test]
    fn multiple_patterns_share_settings_and_missing_hostname_uses_the_name() {
        let hosts = parse("Host one two\n  User u\n  Port 2200\n", None);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[1].name, "two");
        assert_eq!(hosts[1].addr, "two");
        assert_eq!(hosts[1].port, 2200);
    }

    #[test]
    fn host_without_user_is_skipped_without_a_default() {
        assert!(parse("Host a\n  HostName a.example.com\n", None).is_empty());
        assert!(parse("Host a\n", Some("")).is_empty());
    }

    #[test]
    fn first_value_wins_and_bad_ports_skip_the_host() {
        let hosts = parse("Host a\n User one\n User two\n Port 22\n Port 23\nHost b\n User u\n Port 99999\nHost c\n User u\n Port 0\n", None);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].user, "one");
        assert_eq!(hosts[0].port, 22);
    }

    #[test]
    fn directives_before_any_host_and_includes_are_ignored() {
        let text = "Include ~/.ssh/other\nUser global\nHost a\n  HostName \"quoted.example.com\"\n  User u\n";
        let hosts = parse(text, None);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].addr, "quoted.example.com");
    }

    #[test]
    fn duplicate_patterns_are_kept_once() {
        let hosts = parse("Host a\n User first\nHost A\n User second\n", None);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].user, "first");
    }

    #[test]
    fn empty_and_garbage_input() {
        assert!(parse("", Some("u")).is_empty());
        assert!(parse("\u{0}\u{0}\n=\n  \n", Some("u")).is_empty());
    }
}
