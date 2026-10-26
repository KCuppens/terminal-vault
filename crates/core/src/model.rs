use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const MAX_PANE_DEPTH: usize = 16;

#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Host {
    pub id: Uuid,
    pub name: String,
    pub addr: String,
    pub port: u16,
    pub user: String,
    pub key_id: Option<Uuid>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// tmux session every terminal on this host attaches to. `None` opens a plain shell.
    #[serde(default)]
    pub tmux_session: Option<String>,
}

/// A host before it has an id: what the UI submits and what an ssh config import yields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostInput {
    pub name: String,
    pub addr: String,
    pub port: u16,
    pub user: String,
    pub key_id: Option<Uuid>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tmux_session: Option<String>,
}

impl HostInput {
    pub fn into_host(self) -> Host {
        Host {
            id: Uuid::new_v4(),
            name: self.name,
            addr: self.addr,
            port: self.port,
            user: self.user,
            key_id: self.key_id,
            tags: self.tags,
            tmux_session: self.tmux_session,
        }
    }
}

/// Hosts as pretty JSON for sharing: no ids, no key links, no pinned host keys.
pub fn hosts_export_json(hosts: &[Host]) -> String {
    #[derive(Serialize)]
    struct Row<'a> {
        name: &'a str,
        addr: &'a str,
        port: u16,
        user: &'a str,
        tags: &'a [String],
        tmux_session: Option<&'a str>,
    }
    let rows: Vec<Row> = hosts
        .iter()
        .map(|h| Row {
            name: &h.name,
            addr: &h.addr,
            port: h.port,
            user: &h.user,
            tags: &h.tags,
            tmux_session: h.tmux_session.as_deref(),
        })
        .collect();
    serde_json::to_string_pretty(&rows).expect("plain rows always serialize")
}

/// tmux treats ':' as a target separator and the name goes into a shell command, so only a
/// conservative character set is allowed (letters, digits, '.', '_' and '-').
pub fn valid_tmux_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyEntry {
    pub id: Uuid,
    pub name: String,
    pub private_openssh: Secret,
    pub public: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SplitDir {
    H,
    V,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PaneNode {
    Terminal {
        host_id: Uuid,
    },
    Split {
        dir: SplitDir,
        ratio: f32,
        a: Box<PaneNode>,
        b: Box<PaneNode>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tab {
    pub title: String,
    pub root: PaneNode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    pub id: Uuid,
    pub name: String,
    pub tabs: Vec<Tab>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownHost {
    pub addr_port: String,
    pub key_type: String,
    pub fingerprint_sha256: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct VaultData {
    #[serde(default)]
    pub hosts: Vec<Host>,
    #[serde(default)]
    pub keys: Vec<KeyEntry>,
    #[serde(default)]
    pub layouts: Vec<Layout>,
    #[serde(default)]
    pub known_hosts: Vec<KnownHost>,
}

#[derive(Debug, Error, PartialEq)]
pub enum ModelError {
    #[error("name must not be empty")]
    EmptyName,
    #[error("a {kind} named \"{name}\" already exists")]
    DuplicateName { kind: &'static str, name: String },
    #[error("duplicate {kind} id {id}")]
    DuplicateId { kind: &'static str, id: Uuid },
    #[error("address must not be empty")]
    EmptyAddr,
    #[error("user must not be empty")]
    EmptyUser,
    #[error("port must be non-zero")]
    ZeroPort,
    #[error("tmux session name {0:?} must be 1 to 64 letters, digits, '_' or '-'")]
    BadTmuxSession(String),
    #[error("split ratio {0} must be within (0, 1)")]
    BadRatio(f32),
    #[error("pane tree deeper than {MAX_PANE_DEPTH} levels")]
    TooDeep,
    #[error("unknown host {0}")]
    UnknownHost(Uuid),
    #[error("unknown key {0}")]
    UnknownKey(Uuid),
    #[error("unknown layout {0}")]
    UnknownLayout(Uuid),
    #[error("host \"{host}\" is used by layout \"{layout}\"")]
    HostInUse { host: String, layout: String },
    #[error("key is used by {hosts} {}", host_word(*.hosts))]
    KeyInUse { hosts: usize },
    #[error("duplicate known host entry for {0}")]
    DuplicateKnownHost(String),
}

fn host_word(n: usize) -> &'static str {
    if n == 1 {
        "host"
    } else {
        "hosts"
    }
}

fn unique_name<'a>(
    kind: &'static str,
    names: impl Iterator<Item = (Uuid, &'a str)>,
    id: Uuid,
    name: &str,
) -> Result<(), ModelError> {
    let wanted = name.trim().to_lowercase();
    if wanted.is_empty() {
        return Err(ModelError::EmptyName);
    }
    for (other_id, other) in names {
        if other_id != id && other.trim().to_lowercase() == wanted {
            return Err(ModelError::DuplicateName {
                kind,
                name: name.trim().to_string(),
            });
        }
    }
    Ok(())
}

impl PaneNode {
    pub fn validate(&self, host_ids: &HashSet<Uuid>) -> Result<(), ModelError> {
        self.validate_at(host_ids, 0)
    }

    fn validate_at(&self, host_ids: &HashSet<Uuid>, depth: usize) -> Result<(), ModelError> {
        if depth > MAX_PANE_DEPTH {
            return Err(ModelError::TooDeep);
        }
        match self {
            PaneNode::Terminal { host_id } => {
                if host_ids.contains(host_id) {
                    Ok(())
                } else {
                    Err(ModelError::UnknownHost(*host_id))
                }
            }
            PaneNode::Split { ratio, a, b, .. } => {
                if !(ratio.is_finite() && *ratio > 0.0 && *ratio < 1.0) {
                    return Err(ModelError::BadRatio(*ratio));
                }
                a.validate_at(host_ids, depth + 1)?;
                b.validate_at(host_ids, depth + 1)
            }
        }
    }

    pub fn host_ids(&self, out: &mut Vec<Uuid>) {
        match self {
            PaneNode::Terminal { host_id } => out.push(*host_id),
            PaneNode::Split { a, b, .. } => {
                a.host_ids(out);
                b.host_ids(out);
            }
        }
    }
}

impl VaultData {
    fn host_id_set(&self) -> HashSet<Uuid> {
        self.hosts.iter().map(|h| h.id).collect()
    }

    fn check_host(&self, host: &Host) -> Result<(), ModelError> {
        unique_name(
            "host",
            self.hosts.iter().map(|h| (h.id, h.name.as_str())),
            host.id,
            &host.name,
        )?;
        if host.addr.trim().is_empty() {
            return Err(ModelError::EmptyAddr);
        }
        if host.user.trim().is_empty() {
            return Err(ModelError::EmptyUser);
        }
        if host.port == 0 {
            return Err(ModelError::ZeroPort);
        }
        if let Some(name) = &host.tmux_session {
            if !valid_tmux_name(name) {
                return Err(ModelError::BadTmuxSession(name.clone()));
            }
        }
        if let Some(key_id) = host.key_id {
            if !self.keys.iter().any(|k| k.id == key_id) {
                return Err(ModelError::UnknownKey(key_id));
            }
        }
        Ok(())
    }

    fn check_key(&self, key: &KeyEntry) -> Result<(), ModelError> {
        unique_name(
            "key",
            self.keys.iter().map(|k| (k.id, k.name.as_str())),
            key.id,
            &key.name,
        )
    }

    fn check_layout(&self, layout: &Layout) -> Result<(), ModelError> {
        unique_name(
            "layout",
            self.layouts.iter().map(|l| (l.id, l.name.as_str())),
            layout.id,
            &layout.name,
        )?;
        let hosts = self.host_id_set();
        layout.tabs.iter().try_for_each(|t| t.root.validate(&hosts))
    }

    pub fn validate(&self) -> Result<(), ModelError> {
        let mut seen = HashSet::new();
        for k in &self.keys {
            if !seen.insert(k.id) {
                return Err(ModelError::DuplicateId {
                    kind: "key",
                    id: k.id,
                });
            }
            self.check_key(k)?;
        }
        seen.clear();
        for h in &self.hosts {
            if !seen.insert(h.id) {
                return Err(ModelError::DuplicateId {
                    kind: "host",
                    id: h.id,
                });
            }
            self.check_host(h)?;
        }
        seen.clear();
        for l in &self.layouts {
            if !seen.insert(l.id) {
                return Err(ModelError::DuplicateId {
                    kind: "layout",
                    id: l.id,
                });
            }
            self.check_layout(l)?;
        }
        let mut addrs = HashSet::new();
        for kh in &self.known_hosts {
            if !addrs.insert(kh.addr_port.as_str()) {
                return Err(ModelError::DuplicateKnownHost(kh.addr_port.clone()));
            }
        }
        Ok(())
    }

    pub fn add_host(&mut self, host: Host) -> Result<(), ModelError> {
        if self.hosts.iter().any(|h| h.id == host.id) {
            return Err(ModelError::DuplicateId {
                kind: "host",
                id: host.id,
            });
        }
        self.check_host(&host)?;
        self.hosts.push(host);
        Ok(())
    }

    pub fn update_host(&mut self, host: Host) -> Result<(), ModelError> {
        let idx = self
            .hosts
            .iter()
            .position(|h| h.id == host.id)
            .ok_or(ModelError::UnknownHost(host.id))?;
        self.check_host(&host)?;
        self.hosts[idx] = host;
        Ok(())
    }

    pub fn remove_host(&mut self, id: Uuid) -> Result<Host, ModelError> {
        let idx = self
            .hosts
            .iter()
            .position(|h| h.id == id)
            .ok_or(ModelError::UnknownHost(id))?;
        for layout in &self.layouts {
            let mut ids = Vec::new();
            layout.tabs.iter().for_each(|t| t.root.host_ids(&mut ids));
            if ids.contains(&id) {
                return Err(ModelError::HostInUse {
                    host: self.hosts[idx].name.clone(),
                    layout: layout.name.clone(),
                });
            }
        }
        Ok(self.hosts.remove(idx))
    }

    pub fn add_key(&mut self, key: KeyEntry) -> Result<(), ModelError> {
        if self.keys.iter().any(|k| k.id == key.id) {
            return Err(ModelError::DuplicateId {
                kind: "key",
                id: key.id,
            });
        }
        self.check_key(&key)?;
        self.keys.push(key);
        Ok(())
    }

    pub fn remove_key(&mut self, id: Uuid) -> Result<KeyEntry, ModelError> {
        let idx = self
            .keys
            .iter()
            .position(|k| k.id == id)
            .ok_or(ModelError::UnknownKey(id))?;
        let used_by = self.hosts.iter().filter(|h| h.key_id == Some(id)).count();
        if used_by > 0 {
            return Err(ModelError::KeyInUse { hosts: used_by });
        }
        Ok(self.keys.remove(idx))
    }

    pub fn save_layout(&mut self, layout: Layout) -> Result<(), ModelError> {
        self.check_layout(&layout)?;
        match self.layouts.iter().position(|l| l.id == layout.id) {
            Some(idx) => self.layouts[idx] = layout,
            None => self.layouts.push(layout),
        }
        Ok(())
    }

    pub fn remove_layout(&mut self, id: Uuid) -> Result<Layout, ModelError> {
        let idx = self
            .layouts
            .iter()
            .position(|l| l.id == id)
            .ok_or(ModelError::UnknownLayout(id))?;
        Ok(self.layouts.remove(idx))
    }

    pub fn upsert_known_host(&mut self, entry: KnownHost) {
        match self
            .known_hosts
            .iter_mut()
            .find(|k| k.addr_port == entry.addr_port)
        {
            Some(existing) => *existing = entry,
            None => self.known_hosts.push(entry),
        }
    }

    pub fn remove_known_host(&mut self, addr_port: &str) -> bool {
        let before = self.known_hosts.len();
        self.known_hosts.retain(|k| k.addr_port != addr_port);
        self.known_hosts.len() != before
    }

    pub fn host(&self, id: Uuid) -> Option<&Host> {
        self.hosts.iter().find(|h| h.id == id)
    }

    pub fn key(&self, id: Uuid) -> Option<&KeyEntry> {
        self.keys.iter().find(|k| k.id == id)
    }

    pub fn layout(&self, id: Uuid) -> Option<&Layout> {
        self.layouts.iter().find(|l| l.id == id)
    }
}
