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
use crate::model::{Host, KeyEntry, KnownHost};

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
    Error(String),
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
        let key = server_public_key.public_key();
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

impl SessionManager {
    pub async fn open(
        &self,
        host: &Host,
        key: &KeyEntry,
        known: &mut KnownHosts,
        size: PtySize,
    ) -> Result<(SessionHandle, mpsc::Receiver<SessionEvent>), SessionError> {
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
            channel
                .request_pty(false, TERM, size.cols, size.rows, 0, 0, &[])
                .await
                .map_err(|e| SessionError::Channel(e.to_string()))?;
            channel
                .request_shell(false)
                .await
                .map_err(|e| SessionError::Channel(e.to_string()))?;
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
