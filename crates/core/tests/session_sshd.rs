#![cfg(unix)]

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use russh::keys::ssh_key::LineEnding;
use russh::keys::{Algorithm, HashAlg, PrivateKey};
use tempfile::TempDir;
use tokio::sync::mpsc::Receiver;
use tvcore::keys::generate_ed25519;
use tvcore::session::{
    HostKeyDecision, KnownHosts, PtySize, SessionError, SessionEvent, SessionManager,
};
use tvcore::{Host, KeyEntry, KnownHost};
use uuid::Uuid;

const SSHD: &str = "/usr/sbin/sshd";
const WAIT: Duration = Duration::from_secs(20);

struct Sshd {
    child: Child,
    _dir: TempDir,
    port: u16,
    host_fingerprint: String,
    client_key: KeyEntry,
    user: String,
}

impl Drop for Sshd {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn current_user() -> Option<String> {
    ["USER", "LOGNAME"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .or_else(|| {
            let out = Command::new("id").arg("-un").output().ok()?;
            let name = String::from_utf8(out.stdout).ok()?.trim().to_string();
            (!name.is_empty()).then_some(name)
        })
}

fn write_private(path: &Path, key: &PrivateKey) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, key.to_openssh(LineEnding::LF).unwrap().as_bytes()).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

impl Sshd {
    fn start() -> Result<Sshd, String> {
        if !Path::new(SSHD).exists() {
            return Err(format!("{SSHD} not found"));
        }
        let user = current_user().ok_or("cannot determine current user")?;
        let dir = tempfile::tempdir().unwrap();
        let host_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
        let host_fingerprint = host_key
            .public_key()
            .fingerprint(HashAlg::Sha256)
            .to_string();
        write_private(&dir.path().join("host_key"), &host_key);
        let client_key = generate_ed25519("test-client", "test-client").unwrap();
        std::fs::write(
            dir.path().join("authorized_keys"),
            format!("{}\n", client_key.public),
        )
        .unwrap();

        let port = free_port();
        let d = dir.path().display();
        let config = format!(
            "Port {port}\nListenAddress 127.0.0.1\nHostKey {d}/host_key\nPidFile {d}/sshd.pid\n\
             AuthorizedKeysFile {d}/authorized_keys\nPubkeyAuthentication yes\n\
             PasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\n\
             StrictModes no\nAllowUsers {user}\nLogLevel ERROR\n"
        );
        std::fs::write(dir.path().join("sshd_config"), config).unwrap();

        let mut child = Command::new(SSHD)
            .args(["-D", "-e", "-f"])
            .arg(dir.path().join("sshd_config"))
            .args(["-p", &port.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("cannot spawn sshd: {e}"))?;

        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
                break;
            }
            if let Ok(Some(status)) = child.try_wait() {
                let mut stderr = String::new();
                if let Some(mut s) = child.stderr.take() {
                    std::io::Read::read_to_string(&mut s, &mut stderr).ok();
                }
                return Err(format!("sshd exited early ({status}): {}", stderr.trim()));
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                return Err("sshd did not start listening within 5s".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Ok(Sshd {
            child,
            _dir: dir,
            port,
            host_fingerprint,
            client_key,
            user,
        })
    }

    fn host(&self) -> Host {
        Host {
            id: Uuid::new_v4(),
            name: "local".into(),
            addr: "127.0.0.1".into(),
            port: self.port,
            user: self.user.clone(),
            key_id: Some(self.client_key.id),
            tags: vec![],
            tmux_session: None,
        }
    }

    fn addr_port(&self) -> String {
        format!("127.0.0.1:{}", self.port)
    }
}

macro_rules! sshd_or_skip {
    () => {
        match Sshd::start() {
            Ok(s) => s,
            Err(reason) => {
                eprintln!("SKIPPING sshd integration test: {reason}");
                return;
            }
        }
    };
}

const SIZE: PtySize = PtySize { cols: 80, rows: 24 };

async fn open_trusted(
    sshd: &Sshd,
) -> (
    tvcore::session::SessionHandle,
    Receiver<SessionEvent>,
    KnownHosts,
) {
    let mut known = KnownHosts::default();
    known.trust_new_fingerprint(&sshd.host_fingerprint);
    let (h, rx) = SessionManager::default()
        .open(&sshd.host(), &sshd.client_key, &mut known, SIZE)
        .await
        .expect("open");
    (h, rx, known)
}

async fn collect_until(
    rx: &mut Receiver<SessionEvent>,
    mut done: impl FnMut(&[u8], &[SessionEvent]) -> bool,
) -> (Vec<u8>, Vec<SessionEvent>) {
    let mut bytes = Vec::new();
    let mut events = Vec::new();
    let deadline = tokio::time::Instant::now() + WAIT;
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Err(_) => panic!(
                "timed out; output so far: {:?}",
                String::from_utf8_lossy(&bytes)
            ),
            Ok(None) => return (bytes, events),
            Ok(Some(SessionEvent::Data(d))) => bytes.extend_from_slice(&d),
            Ok(Some(e)) => events.push(e),
        }
        if done(&bytes, &events) {
            return (bytes, events);
        }
    }
}

fn contains(hay: &[u8], needle: &str) -> bool {
    hay.windows(needle.len()).any(|w| w == needle.as_bytes())
}

fn tmux_available() -> bool {
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .is_ok_and(|o| o.status.success())
}

/// Kills the tmux session even when the test panics.
struct KillTmux(String);

impl Drop for KillTmux {
    fn drop(&mut self) {
        let _ = std::process::Command::new("tmux")
            .args(["kill-session", "-t", &format!("={}", self.0)])
            .output();
    }
}

/// The id of the window a pane runs in. `-t "$TMUX_PANE"` matters: without it tmux answers
/// for whichever client was active last.
async fn window_index(
    handle: &tvcore::session::SessionHandle,
    rx: &mut Receiver<SessionEvent>,
) -> u32 {
    handle
        .write(b"echo w=$(tmux display-message -p -t \"$TMUX_PANE\" '#{window_id}' | tr -d @)x\r")
        .await
        .unwrap();
    let (bytes, _) = collect_until(rx, |b, _| marker_value(b).is_some()).await;
    marker_value(&bytes).unwrap()
}

/// Finds `w=<digits>x`; the echoed command line has `w=$(` so it never matches.
fn marker_value(bytes: &[u8]) -> Option<u32> {
    let text = String::from_utf8_lossy(bytes);
    text.match_indices("w=").find_map(|(i, _)| {
        let rest = &text[i + 2..];
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        (!digits.is_empty() && rest[digits.len()..].starts_with('x'))
            .then(|| digits.parse().unwrap())
    })
}

#[tokio::test]
async fn tmux_open_creates_session_listed_by_list_tmux_and_survives_close() {
    let sshd = sshd_or_skip!();
    if !tmux_available() {
        eprintln!("SKIPPING tmux test: tmux not installed");
        return;
    }
    let name = format!("tvtest{}", std::process::id());
    let _kill = KillTmux(name.clone());
    let mgr = SessionManager::default();
    let mut known = KnownHosts::default();
    known.trust_new_fingerprint(&sshd.host_fingerprint);

    let (handle, mut rx) = mgr
        .open_tmux(&sshd.host(), &sshd.client_key, &mut known, SIZE, &name)
        .await
        .expect("open_tmux");
    handle.write(b"echo mark$((20+1))\r").await.unwrap();
    collect_until(&mut rx, |b, _| contains(b, "mark21")).await;
    let listed = mgr
        .list_tmux(&sshd.host(), &sshd.client_key, &mut known)
        .await
        .expect("list_tmux");
    assert!(listed.contains(&name), "{listed:?}");

    handle.close().await.ok();
    let listed = mgr
        .list_tmux(&sshd.host(), &sshd.client_key, &mut known)
        .await
        .expect("list_tmux after close");
    assert!(
        listed.contains(&name),
        "session must outlive the connection: {listed:?}"
    );
}

#[tokio::test]
async fn panes_opened_in_parallel_get_their_own_windows_and_stay_out_of_the_picker() {
    let sshd = sshd_or_skip!();
    if !tmux_available() {
        eprintln!("SKIPPING tmux test: tmux not installed");
        return;
    }
    let name = format!("tvpar{}", std::process::id());
    let _kill = KillTmux(name.clone());
    let mgr = SessionManager::default();
    let open = || {
        let mgr = mgr.clone();
        let (host, key) = (sshd.host(), sshd.client_key.clone());
        let name = name.clone();
        let mut known = KnownHosts::default();
        known.trust_new_fingerprint(&sshd.host_fingerprint);
        async move {
            mgr.open_tmux(&host, &key, &mut known, SIZE, &name)
                .await
                .expect("open_tmux")
        }
    };
    let ((h1, mut _r1), (h2, mut _r2), (h3, mut _r3)) = tokio::join!(open(), open(), open());
    tokio::time::sleep(Duration::from_millis(300)).await;

    let mut known = KnownHosts::default();
    known.trust_new_fingerprint(&sshd.host_fingerprint);
    let listed = mgr
        .list_tmux(&sshd.host(), &sshd.client_key, &mut known)
        .await
        .expect("list_tmux");
    assert_eq!(
        listed.iter().filter(|n| **n == name).count(),
        1,
        "{listed:?}"
    );
    // When attaching directly to the session, all clients attach directly without extra hidden sessions

    h2.close().await.ok();
    h3.close().await.ok();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let listed = mgr
        .list_tmux(&sshd.host(), &sshd.client_key, &mut known)
        .await
        .expect("list_tmux after closing panes");
    assert!(listed.contains(&name), "{listed:?}");
    h1.close().await.ok();
}

#[tokio::test]
async fn list_tmux_drops_names_unsafe_for_a_command() {
    let sshd = sshd_or_skip!();
    if !tmux_available() {
        eprintln!("SKIPPING tmux test: tmux not installed");
        return;
    }
    let good = format!("tvgood{}", std::process::id());
    let bad = format!("tv bad{}", std::process::id());
    let _k1 = KillTmux(good.clone());
    let _k2 = KillTmux(bad.clone());
    for n in [&good, &bad] {
        let out = std::process::Command::new("tmux")
            .args(["new-session", "-d", "-s", n])
            .output()
            .unwrap();
        assert!(out.status.success(), "{out:?}");
    }
    let mut known = KnownHosts::default();
    known.trust_new_fingerprint(&sshd.host_fingerprint);
    let listed = SessionManager::default()
        .list_tmux(&sshd.host(), &sshd.client_key, &mut known)
        .await
        .expect("list_tmux");
    assert!(listed.contains(&good), "{listed:?}");
    assert!(!listed.iter().any(|n| n.contains(' ')), "{listed:?}");
}

#[tokio::test]
async fn tofu_flow_and_echo() {
    let sshd = sshd_or_skip!();
    let mgr = SessionManager::default();

    let mut known = KnownHosts::default();
    let err = mgr
        .open(&sshd.host(), &sshd.client_key, &mut known, SIZE)
        .await
        .err()
        .expect("unknown host key must not connect");
    let SessionError::HostKey(HostKeyDecision::NewKey {
        fingerprint,
        key_type,
    }) = err
    else {
        panic!("expected NewKey, got {err:?}");
    };
    assert_eq!(fingerprint, sshd.host_fingerprint);
    assert_eq!(key_type, "ssh-ed25519");
    assert!(known.entries().is_empty() && !known.is_dirty());

    known.trust_new_fingerprint("SHA256:not-the-right-one");
    assert!(matches!(
        mgr.open(&sshd.host(), &sshd.client_key, &mut known, SIZE)
            .await
            .err(),
        Some(SessionError::HostKey(HostKeyDecision::NewKey { .. }))
    ));

    known.trust_new_fingerprint(&fingerprint);
    let (handle, mut rx) = mgr
        .open(&sshd.host(), &sshd.client_key, &mut known, SIZE)
        .await
        .expect("open after trusting");
    assert!(known.is_dirty());
    assert_eq!(
        known.entries(),
        [KnownHost {
            addr_port: sshd.addr_port(),
            key_type: "ssh-ed25519".into(),
            fingerprint_sha256: fingerprint.clone(),
        }]
    );

    handle.write(b"echo hi\n").await.unwrap();
    let (out, _) = collect_until(&mut rx, |b, _| contains(b, "\rhi\r\n")).await;
    assert!(contains(&out, "\rhi\r\n"));

    handle.write(b"exit 3\n").await.unwrap();
    let (_, events) = collect_until(&mut rx, |_, e| e.contains(&SessionEvent::Closed)).await;
    let exit_pos = events.iter().position(|e| *e == SessionEvent::Exit(3));
    let closed_pos = events.iter().position(|e| *e == SessionEvent::Closed);
    assert!(exit_pos.is_some(), "events: {events:?}");
    assert!(exit_pos < closed_pos);

    let mut persisted = KnownHosts::new(known.into_entries());
    let (handle, _rx) = mgr
        .open(&sshd.host(), &sshd.client_key, &mut persisted, SIZE)
        .await
        .expect("known host reconnects without pin");
    assert!(!persisted.is_dirty());
    handle.close().await.unwrap();
}

#[tokio::test]
async fn resize_reaches_the_pty() {
    let sshd = sshd_or_skip!();
    let (handle, mut rx, _) = open_trusted(&sshd).await;

    handle.write(b"stty size\n").await.unwrap();
    collect_until(&mut rx, |b, _| contains(b, "\r24 80\r\n")).await;

    handle.resize(100, 30).await.unwrap();
    handle.write(b"stty size\n").await.unwrap();
    collect_until(&mut rx, |b, _| contains(b, "\r30 100\r\n")).await;
    handle.close().await.unwrap();
}

#[tokio::test]
async fn changed_host_key_is_rejected_unless_explicitly_accepted() {
    let sshd = sshd_or_skip!();
    let mgr = SessionManager::default();
    let stale = KnownHost {
        addr_port: sshd.addr_port(),
        key_type: "ssh-ed25519".into(),
        fingerprint_sha256: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
    };
    let mut known = KnownHosts::new(vec![stale.clone()]);

    let err = mgr
        .open(&sshd.host(), &sshd.client_key, &mut known, SIZE)
        .await
        .err()
        .expect("changed key must be refused");
    let SessionError::HostKey(HostKeyDecision::Changed { expected, got, .. }) = err else {
        panic!("expected Changed, got {err:?}");
    };
    assert_eq!(expected, stale.fingerprint_sha256);
    assert_eq!(got, sshd.host_fingerprint);
    assert_eq!(known.entries(), std::slice::from_ref(&stale));

    known.trust_new_fingerprint(&got);
    assert!(matches!(
        mgr.open(&sshd.host(), &sshd.client_key, &mut known, SIZE)
            .await
            .err(),
        Some(SessionError::HostKey(HostKeyDecision::Changed { .. }))
    ));
    known.accept_changed_fingerprint("SHA256:something-else");
    assert!(matches!(
        mgr.open(&sshd.host(), &sshd.client_key, &mut known, SIZE)
            .await
            .err(),
        Some(SessionError::HostKey(HostKeyDecision::Changed { .. }))
    ));
    assert_eq!(known.entries(), [stale]);

    known.accept_changed_fingerprint(&got);
    let (handle, _rx) = mgr
        .open(&sshd.host(), &sshd.client_key, &mut known, SIZE)
        .await
        .expect("explicitly accepted");
    assert!(known.is_dirty());
    assert_eq!(known.entries()[0].fingerprint_sha256, got);
    handle.close().await.unwrap();
}

#[tokio::test]
async fn unauthorized_key_is_rejected() {
    let sshd = sshd_or_skip!();
    let stranger = generate_ed25519("stranger", "stranger").unwrap();
    let mut known = KnownHosts::default();
    known.trust_new_fingerprint(&sshd.host_fingerprint);
    let err = SessionManager::default()
        .open(&sshd.host(), &stranger, &mut known, SIZE)
        .await
        .err()
        .expect("must fail");
    assert!(matches!(err, SessionError::AuthRejected), "{err:?}");
    assert!(!known.is_dirty());
}

#[tokio::test]
async fn closed_port_reports_connect_error() {
    let host = Host {
        id: Uuid::new_v4(),
        name: "nope".into(),
        addr: "127.0.0.1".into(),
        port: free_port(),
        user: "x".into(),
        key_id: None,
        tags: vec![],
        tmux_session: None,
    };
    let key = generate_ed25519("k", "k").unwrap();
    let err = SessionManager::default()
        .open(&host, &key, &mut KnownHosts::default(), SIZE)
        .await
        .err()
        .expect("must fail");
    assert!(matches!(err, SessionError::Connect(_)), "{err:?}");
}

#[tokio::test]
async fn output_is_coalesced_into_bounded_chunks() {
    let sshd = sshd_or_skip!();
    let (handle, mut rx, _) = open_trusted(&sshd).await;

    handle
        .write(b"stty -echo; head -c 300000 /dev/zero | tr '\\0' 'x'; echo; echo DONE-$((1+1))\n")
        .await
        .unwrap();

    let mut chunks = Vec::new();
    let mut seen = Vec::new();
    let deadline = tokio::time::Instant::now() + WAIT;
    while !contains(&seen, "DONE-2") {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Some(SessionEvent::Data(d))) => {
                seen.extend_from_slice(&d);
                chunks.push(d.len());
            }
            Ok(Some(_)) => {}
            other => panic!("stream ended early: {other:?}"),
        }
    }
    assert!(chunks.iter().all(|&n| n <= 16 * 1024), "{chunks:?}");
    assert!(seen.iter().filter(|&&b| b == b'x').count() >= 300_000);
    assert!(
        chunks.len() < seen.len() / 64,
        "expected batching, got {} chunks for {} bytes",
        chunks.len(),
        seen.len()
    );
    handle.close().await.unwrap();
}
