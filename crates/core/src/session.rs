use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle, Msg};
use russh::keys::{Algorithm, HashAlg, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Disconnect, Preferred};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::keys::KeyError;
use crate::model::{valid_tmux_name, Host, KeyEntry, KnownHost};

const CHUNK_BYTES: usize = 16 * 1024;
const COALESCE_WINDOW: Duration = Duration::from_millis(4);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
const EVENT_QUEUE: usize = 256;
const TERM: &str = "xterm-256color";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtySize {
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEvent {
    Data(Vec<u8>),
    Exit(u32),
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyDecision {
    Trusted,
    NewKey {
        key_type: String,
        fingerprint: String,
    },
    Changed {
        key_type: String,
        expected: String,
        got: String,
    },
}

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("host key not accepted: {0:?}")]
    HostKey(HostKeyDecision),
    #[error("connection failed: {0}")]
    Connect(String),
    #[error("connection timed out")]
    Timeout,
    #[error("authentication rejected by server")]
    AuthRejected,
    #[error("session error: {0}")]
    Channel(String),
    #[error(transparent)]
    Key(#[from] KeyError),
}

pub fn addr_port(host: &Host) -> String {
    if host.addr.contains(':') && !host.addr.starts_with('[') {
        format!("[{}]:{}", host.addr, host.port)
    } else {
        format!("{}:{}", host.addr, host.port)
    }
}

#[derive(Debug, Clone, Default)]
pub struct KnownHosts {
    entries: Vec<KnownHost>,
    trust_new: Option<String>,
    accept_changed: Option<String>,
    dirty: bool,
}

impl KnownHosts {
    pub fn new(entries: Vec<KnownHost>) -> Self {
        Self {
            entries,
            ..Self::default()
        }
    }

    pub fn entries(&self) -> &[KnownHost] {
        &self.entries
    }

    pub fn into_entries(self) -> Vec<KnownHost> {
        self.entries
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Accept an unknown host key, but only if its SHA256 fingerprint equals `fingerprint`.
    pub fn trust_new_fingerprint(&mut self, fingerprint: &str) {
        self.trust_new = Some(fingerprint.to_string());
    }

    /// Replace a changed host key, but only if the presented fingerprint equals `fingerprint`.
    pub fn accept_changed_fingerprint(&mut self, fingerprint: &str) {
        self.accept_changed = Some(fingerprint.to_string());
    }

    fn lookup(&self, addr_port: &str) -> Option<&KnownHost> {
        self.entries.iter().find(|k| k.addr_port == addr_port)
    }

    pub fn decide(&self, addr_port: &str, key_type: &str, fingerprint: &str) -> HostKeyDecision {
        match self.lookup(addr_port) {
            None => HostKeyDecision::NewKey {
                key_type: key_type.to_string(),
                fingerprint: fingerprint.to_string(),
            },
            Some(k) if k.fingerprint_sha256 == fingerprint => HostKeyDecision::Trusted,
            Some(k) => HostKeyDecision::Changed {
                key_type: key_type.to_string(),
                expected: k.fingerprint_sha256.clone(),
                got: fingerprint.to_string(),
            },
        }
    }

    fn allows(&self, decision: &HostKeyDecision) -> bool {
        match decision {
            HostKeyDecision::Trusted => true,
            HostKeyDecision::NewKey { fingerprint, .. } => {
                self.trust_new.as_deref() == Some(fingerprint)
            }
            HostKeyDecision::Changed { got, .. } => self.accept_changed.as_deref() == Some(got),
        }
    }

    fn record(&mut self, addr_port: &str, decision: &HostKeyDecision) {
        let (key_type, fingerprint) = match decision {
            HostKeyDecision::Trusted => return,
            HostKeyDecision::NewKey {
                key_type,
                fingerprint,
            } => (key_type, fingerprint),
            HostKeyDecision::Changed { key_type, got, .. } => (key_type, got),
        };
        let entry = KnownHost {
            addr_port: addr_port.to_string(),
            key_type: key_type.clone(),
            fingerprint_sha256: fingerprint.clone(),
        };
        match self.entries.iter_mut().find(|k| k.addr_port == addr_port) {
            Some(existing) => *existing = entry,
            None => self.entries.push(entry),
        }
        self.dirty = true;
    }
}

struct Client {
    addr_port: String,
    known: KnownHosts,
    observed: Arc<Mutex<Option<HostKeyDecision>>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key = match server_public_key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => key,
            russh::keys::PublicKeyOrCertificate::Certificate(_) => {
                return Ok(false);
            }
        };
        let decision = self.known.decide(
            &self.addr_port,
            key_family(&key.algorithm()),
            &key.fingerprint(HashAlg::Sha256).to_string(),
        );
        let allowed = self.known.allows(&decision);
        if let Ok(mut slot) = self.observed.lock() {
            *slot = Some(decision);
        }
        Ok(allowed)
    }
}

fn key_family(alg: &Algorithm) -> &str {
    match alg {
        Algorithm::Rsa { .. } => "ssh-rsa",
        other => other.as_str(),
    }
}

fn preferred_for(known: Option<&KnownHost>) -> Preferred {
    let Some(known) = known else {
        return Preferred::default();
    };
    let mut algs: Vec<Algorithm> = Preferred::default().key.into_owned();
    algs.sort_by_key(|a| key_family(a) != known.key_type);
    Preferred {
        key: Cow::Owned(algs),
        ..Preferred::default()
    }
}

#[derive(Clone)]
pub struct SessionHandle {
    inner: Arc<Inner>,
}

struct Inner {
    writer: ChannelWriteHalf<Msg>,
    conn: Handle<Client>,
}

impl SessionHandle {
    pub async fn write(&self, data: &[u8]) -> Result<(), SessionError> {
        self.inner
            .writer
            .data_bytes(data.to_vec())
            .await
            .map_err(|e| SessionError::Channel(e.to_string()))
    }

    pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), SessionError> {
        self.inner
            .writer
            .window_change(cols, rows, 0, 0)
            .await
            .map_err(|e| SessionError::Channel(e.to_string()))
    }

    pub async fn close(&self) -> Result<(), SessionError> {
        let _ = self.inner.writer.close().await;
        self.inner
            .conn
            .disconnect(Disconnect::ByApplication, "", "en")
            .await
            .map_err(|e| SessionError::Channel(e.to_string()))
    }
}

#[derive(Debug, Clone)]
pub struct SessionManager {
    pub connect_timeout: Duration,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(20),
        }
    }
}

/// What to start on the channel once authenticated.
enum Launch<'a> {
    Shell(PtySize),
    Tmux(&'a str, PtySize),
    Exec(&'a str),
}

/// Directories searched for `tmux` besides the login PATH; a non-interactive SSH command often
/// lacks them (Homebrew, MacPorts, user installs).
macro_rules! tmux_path {
    () => {
        r#"PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:$HOME/.local/bin"; export PATH"#
    };
}

/// Command that opens `name` as one more window of a tmux session, so every pane on a host
/// gets its own window while the session survives disconnects. It is wrapped in `/bin/sh -c`
/// so it works whatever the account's login shell is.
///
/// Whichever pane creates the session (`new-session -d` is atomic, so exactly one pane wins
/// even when several open at once) attaches it directly. The others attach a grouped session
/// (shared windows, own current window) and add a window; that group member goes away when its
/// pane closes. The window a pane added stays, so reconnecting leaves the old window behind in
/// the session. Without tmux it emits the private sequence `ESC ] 777 ; tv-no-tmux BEL` (so the
/// UI can flag the pane), prints a notice and starts a login shell. `name` must pass
/// [`valid_tmux_name`], which is why it needs no quoting.
pub fn tmux_command(name: &str) -> String {
    format!(
        "exec /bin/sh -c '{path}; \
         if ! command -v tmux >/dev/null 2>&1; then \
         printf \"\\033]777;tv-no-tmux\\007\"; \
         echo \"terminal-vault: tmux is not installed on this server, using a plain shell\"; \
         exec \"${{SHELL:-/bin/sh}}\" -l; fi; \
         if tmux has-session -t ={name} 2>/dev/null; then \
           exec tmux attach-session -t ={name}; \
         fi; \
         exec tmux new-session -s {name}'",
        path = tmux_path!()
    )
}

/// Command that prints `name:group` per tmux session (tmux never puts ':' in a name), or
/// nothing when tmux is missing or idle.
const TMUX_LIST_COMMAND: &str = concat!(
    r#"exec /bin/sh -c '"#,
    tmux_path!(),
    "; ",
    r#"tmux list-sessions -F "#,
    r##""#{session_name}:#{session_group}" 2>/dev/null || true'"##
);
const EXEC_OUTPUT_LIMIT: usize = 64 * 1024;

/// Picks the session names to offer from `tmux list-sessions -F '#{session_name}:#{session_group}'`
/// output. Members of a session group other than the one carrying the group's name are the
/// per-pane sessions this app creates, so they are left out; names that are not safe to put
/// in a command are dropped too.
pub fn tmux_session_names(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| {
            let (name, group) = line.trim().split_once(':').unwrap_or((line.trim(), ""));
            (valid_tmux_name(name) && (group.is_empty() || group == name)).then(|| name.to_string())
        })
        .collect()
}

impl SessionManager {
    /// Opens a plain login shell.
    pub async fn open(
        &self,
        host: &Host,
        key: &KeyEntry,
        known: &mut KnownHosts,
        size: PtySize,
    ) -> Result<(SessionHandle, mpsc::Receiver<SessionEvent>), SessionError> {
        self.open_launch(host, key, known, Launch::Shell(size))
            .await
    }

    /// Attaches to the tmux session `name`, creating it when missing.
    pub async fn open_tmux(
        &self,
        host: &Host,
        key: &KeyEntry,
        known: &mut KnownHosts,
        size: PtySize,
        name: &str,
    ) -> Result<(SessionHandle, mpsc::Receiver<SessionEvent>), SessionError> {
        if !valid_tmux_name(name) {
            return Err(SessionError::Channel(format!(
                "invalid tmux session name {name:?}"
            )));
        }
        self.open_launch(host, key, known, Launch::Tmux(name, size))
            .await
    }

    async fn open_launch(
        &self,
        host: &Host,
        key: &KeyEntry,
        known: &mut KnownHosts,
        launch: Launch<'_>,
    ) -> Result<(SessionHandle, mpsc::Receiver<SessionEvent>), SessionError> {
        let (conn, channel) = self.connect(host, key, known, launch).await?;
        let (read_half, writer) = channel.split();
        let (tx, rx) = mpsc::channel(EVENT_QUEUE);
        tokio::spawn(pump(read_half, tx));
        Ok((
            SessionHandle {
                inner: Arc::new(Inner { writer, conn }),
            },
            rx,
        ))
    }

    /// Names of the tmux sessions running on the server, empty when there are none.
    pub async fn list_tmux(
        &self,
        host: &Host,
        key: &KeyEntry,
        known: &mut KnownHosts,
    ) -> Result<Vec<String>, SessionError> {
        let (conn, mut channel) = self
            .connect(host, key, known, Launch::Exec(TMUX_LIST_COMMAND))
            .await?;
        let mut out = Vec::new();
        let read = async {
            while let Some(msg) = channel.wait().await {
                match msg {
                    ChannelMsg::Data { data } => {
                        if out.len() + data.len() > EXEC_OUTPUT_LIMIT {
                            break;
                        }
                        out.extend_from_slice(&data);
                    }
                    ChannelMsg::Close => break,
                    _ => {}
                }
            }
        };
        let finished = tokio::time::timeout(self.connect_timeout, read).await;
        let _ = conn.disconnect(Disconnect::ByApplication, "", "en").await;
        finished.map_err(|_| SessionError::Timeout)?;
        Ok(tmux_session_names(&String::from_utf8_lossy(&out)))
    }

    async fn connect(
        &self,
        host: &Host,
        key: &KeyEntry,
        known: &mut KnownHosts,
        launch: Launch<'_>,
    ) -> Result<(Handle<Client>, russh::Channel<Msg>), SessionError> {
        let addr_port = addr_port(host);
        let private = key.private_key()?;
        let observed = Arc::new(Mutex::new(None));
        let handler = Client {
            addr_port: addr_port.clone(),
            known: known.clone(),
            observed: Arc::clone(&observed),
        };
        let config = Arc::new(client::Config {
            keepalive_interval: Some(KEEPALIVE_INTERVAL),
            keepalive_max: 3,
            preferred: preferred_for(known.lookup(&addr_port)),
            ..client::Config::default()
        });

        let setup = async {
            let mut conn = client::connect(config, (host.addr.as_str(), host.port), handler)
                .await
                .map_err(|e| SessionError::Connect(e.to_string()))?;
            let rsa_hash = conn
                .best_supported_rsa_hash()
                .await
                .map_err(|e| SessionError::Connect(e.to_string()))?
                .flatten();
            let auth = conn
                .authenticate_publickey(
                    host.user.as_str(),
                    PrivateKeyWithHashAlg::new(private, rsa_hash),
                )
                .await
                .map_err(|e| SessionError::Connect(e.to_string()))?;
            if !auth.success() {
                return Err(SessionError::AuthRejected);
            }
            let channel = conn
                .channel_open_session()
                .await
                .map_err(|e| SessionError::Channel(e.to_string()))?;
            let chan_err = |e: russh::Error| SessionError::Channel(e.to_string());
            if let Launch::Shell(size) | Launch::Tmux(_, size) = launch {
                channel
                    .request_pty(false, TERM, size.cols, size.rows, 0, 0, &[])
                    .await
                    .map_err(chan_err)?;
            }
            match launch {
                Launch::Shell(_) => channel.request_shell(false).await.map_err(chan_err)?,
                Launch::Tmux(name, _) => channel
                    .exec(false, tmux_command(name))
                    .await
                    .map_err(chan_err)?,
                Launch::Exec(cmd) => channel.exec(false, cmd).await.map_err(chan_err)?,
            }
            Ok((conn, channel))
        };

        let outcome = tokio::time::timeout(self.connect_timeout, setup).await;
        let decision = observed.lock().ok().and_then(|mut d| d.take());
        let (conn, channel) = match outcome {
            Err(_) => return Err(SessionError::Timeout),
            Ok(Err(e)) => {
                return Err(match decision {
                    Some(d) if !known.allows(&d) => SessionError::HostKey(d),
                    _ => e,
                })
            }
            Ok(Ok(ok)) => ok,
        };
        if let Some(d) = decision {
            known.record(&addr_port, &d);
        }
        Ok((conn, channel))
    }
}

async fn flush(buf: &mut Vec<u8>, tx: &mpsc::Sender<SessionEvent>) -> bool {
    if buf.is_empty() {
        return true;
    }
    let chunk = std::mem::replace(buf, Vec::with_capacity(CHUNK_BYTES));
    tx.send(SessionEvent::Data(chunk)).await.is_ok()
}

async fn pump(mut rx: ChannelReadHalf, tx: mpsc::Sender<SessionEvent>) {
    let mut buf: Vec<u8> = Vec::with_capacity(CHUNK_BYTES);
    let mut deadline: Option<Instant> = None;
    loop {
        let msg = match deadline {
            Some(at) => tokio::select! {
                m = rx.wait() => Some(m),
                () = tokio::time::sleep_until(at) => None,
            },
            None => Some(rx.wait().await),
        };
        let alive = match msg {
            None => {
                deadline = None;
                flush(&mut buf, &tx).await
            }
            Some(Some(ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. })) => {
                let mut rest: &[u8] = &data;
                let mut ok = true;
                while !rest.is_empty() && ok {
                    if buf.is_empty() {
                        deadline = Some(Instant::now() + COALESCE_WINDOW);
                    }
                    let take = rest.len().min(CHUNK_BYTES - buf.len());
                    buf.extend_from_slice(&rest[..take]);
                    rest = &rest[take..];
                    if buf.len() >= CHUNK_BYTES {
                        deadline = None;
                        ok = flush(&mut buf, &tx).await;
                    }
                }
                ok
            }
            Some(Some(ChannelMsg::ExitStatus { exit_status })) => {
                deadline = None;
                flush(&mut buf, &tx).await && tx.send(SessionEvent::Exit(exit_status)).await.is_ok()
            }
            Some(Some(ChannelMsg::ExitSignal { .. })) => {
                deadline = None;
                flush(&mut buf, &tx).await && tx.send(SessionEvent::Exit(255)).await.is_ok()
            }
            Some(Some(ChannelMsg::Close) | None) => {
                let _ = flush(&mut buf, &tx).await;
                let _ = tx.send(SessionEvent::Closed).await;
                return;
            }
            Some(Some(_)) => true,
        };
        if !alive {
            return;
        }
    }
}
