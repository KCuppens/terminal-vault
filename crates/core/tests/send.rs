use tvcore::keys::generate_ed25519;
use tvcore::session::{KnownHosts, PtySize, SessionHandle, SessionManager};
use tvcore::{Host, Vault};
use uuid::Uuid;

fn require_send<T: Send>(_: &T) {}
fn require_send_sync<T: Send + Sync>() {}

#[test]
fn api_is_usable_from_async_runtimes_and_shared_state() {
    require_send_sync::<Vault>();
    require_send_sync::<SessionHandle>();
    require_send_sync::<SessionManager>();

    let manager = SessionManager::default();
    let key = generate_ed25519("k", "k").unwrap();
    let host = Host {
        id: Uuid::new_v4(),
        name: "h".into(),
        addr: "127.0.0.1".into(),
        port: 22,
        user: "u".into(),
        key_id: Some(key.id),
        tags: vec![],
        tmux_session: None,
    };
    let mut known = KnownHosts::default();
    let future = manager.open(&host, &key, &mut known, PtySize { cols: 80, rows: 24 });
    require_send(&future);
}
