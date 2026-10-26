use tvcore::model::{Host, ModelError, VaultData};
use tvcore::session::{tmux_command, tmux_session_names};
use tvcore::valid_tmux_name;
use uuid::Uuid;

fn host(tmux: Option<&str>) -> Host {
    Host {
        id: Uuid::new_v4(),
        name: "h".into(),
        addr: "10.0.0.1".into(),
        port: 22,
        user: "root".into(),
        key_id: None,
        tags: vec![],
        tmux_session: tmux.map(Into::into),
    }
}

#[test]
fn tmux_names_reject_anything_tmux_or_the_shell_would_interpret() {
    for ok in ["main", "work_1", "a-b", "v1.2", "app.dev", &"x".repeat(64)] {
        assert!(valid_tmux_name(ok), "{ok}");
    }
    for bad in [
        "",
        "a:b",
        "a b",
        "a;rm",
        "$(x)",
        "a'b",
        "é",
        &"x".repeat(65),
    ] {
        assert!(!valid_tmux_name(bad), "{bad:?}");
    }
}

#[test]
fn host_with_invalid_tmux_name_is_refused() {
    let mut d = VaultData::default();
    assert_eq!(
        d.add_host(host(Some("bad name"))),
        Err(ModelError::BadTmuxSession("bad name".into()))
    );
    d.add_host(host(Some("main"))).unwrap();
}

#[test]
fn old_vault_hosts_without_tmux_field_still_load() {
    let json = r#"{"id":"6f9619ff-8b86-d011-b42d-00c04fc964ff","name":"h","addr":"a","port":22,"user":"u","key_id":null}"#;
    let h: Host = serde_json::from_str(json).unwrap();
    assert_eq!(h.tmux_session, None);
}

#[cfg(unix)]
#[test]
fn without_tmux_the_command_prints_a_notice_and_runs_a_plain_shell() {
    if ["/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"]
        .iter()
        .any(|d| std::path::Path::new(d).join("tmux").exists())
    {
        return;
    }
    let out = std::process::Command::new("/bin/sh")
        .args(["-c", &tmux_command("main")])
        .env_clear()
        .env("PATH", "/nonexistent")
        .env("HOME", "/nonexistent")
        .env("SHELL", "/bin/sh")
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("tmux is not installed"));
    assert!(stdout.starts_with("\x1b]777;tv-no-tmux\x07"), "{stdout:?}");
}

#[test]
fn session_picker_lists_group_leaders_and_plain_sessions_only() {
    let listed = tmux_session_names(
        "main:main\n1:main\n2:main\n0:\nwork:\nbad name:\nx;y:\n\nodd\n  spaced:spaced  \n",
    );
    assert_eq!(listed, ["main", "0", "work", "odd", "spaced"]);
    assert!(tmux_session_names("").is_empty());
}
