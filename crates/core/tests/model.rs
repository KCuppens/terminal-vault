use tvcore::keys::generate_ed25519;
use tvcore::{Host, KnownHost, Layout, ModelError, PaneNode, SplitDir, Tab, VaultData};
use uuid::Uuid;

fn host(name: &str, key_id: Option<Uuid>) -> Host {
    Host {
        id: Uuid::new_v4(),
        name: name.into(),
        addr: "10.0.0.1".into(),
        port: 22,
        user: "me".into(),
        key_id,
        tags: vec![],
        tmux_session: None,
    }
}

fn term(h: &Host) -> PaneNode {
    PaneNode::Terminal { host_id: h.id }
}

fn split(ratio: f32, a: PaneNode, b: PaneNode) -> PaneNode {
    PaneNode::Split {
        dir: SplitDir::H,
        ratio,
        a: Box::new(a),
        b: Box::new(b),
    }
}

fn layout(name: &str, tabs: Vec<Tab>) -> Layout {
    Layout {
        id: Uuid::new_v4(),
        name: name.into(),
        tabs,
    }
}

fn tab(title: &str, root: PaneNode) -> Tab {
    Tab {
        title: title.into(),
        root,
    }
}

#[test]
fn host_validation() {
    let mut d = VaultData::default();
    d.add_host(host("web", None)).unwrap();

    assert!(matches!(
        d.add_host(host("WEB ", None)),
        Err(ModelError::DuplicateName { .. })
    ));
    assert_eq!(d.add_host(host("  ", None)), Err(ModelError::EmptyName));

    let mut h = host("p0", None);
    h.port = 0;
    assert_eq!(d.add_host(h), Err(ModelError::ZeroPort));

    let mut h = host("noaddr", None);
    h.addr = " ".into();
    assert_eq!(d.add_host(h), Err(ModelError::EmptyAddr));

    let mut h = host("nouser", None);
    h.user = String::new();
    assert_eq!(d.add_host(h), Err(ModelError::EmptyUser));

    let missing = Uuid::new_v4();
    assert_eq!(
        d.add_host(host("badkey", Some(missing))),
        Err(ModelError::UnknownKey(missing))
    );
    assert_eq!(d.hosts.len(), 1);
}

#[test]
fn update_and_remove_host() {
    let mut d = VaultData::default();
    let mut a = host("a", None);
    d.add_host(a.clone()).unwrap();
    d.add_host(host("b", None)).unwrap();

    a.name = "b".into();
    assert!(matches!(
        d.update_host(a.clone()),
        Err(ModelError::DuplicateName { .. })
    ));
    a.name = "a2".into();
    d.update_host(a.clone()).unwrap();
    assert_eq!(d.host(a.id).unwrap().name, "a2");

    let ghost = host("ghost", None);
    assert_eq!(
        d.update_host(ghost.clone()),
        Err(ModelError::UnknownHost(ghost.id))
    );
    assert_eq!(
        d.remove_host(ghost.id),
        Err(ModelError::UnknownHost(ghost.id))
    );
    d.remove_host(a.id).unwrap();
    assert_eq!(d.hosts.len(), 1);
}

#[test]
fn key_in_use_and_host_in_use() {
    let mut d = VaultData::default();
    let key = generate_ed25519("k", "k").unwrap();
    let key_id = key.id;
    d.add_key(key).unwrap();
    assert!(matches!(
        d.add_key(generate_ed25519("K", "K").unwrap()),
        Err(ModelError::DuplicateName { .. })
    ));
    let h = host("web", Some(key_id));
    d.add_host(h.clone()).unwrap();
    assert!(matches!(
        d.remove_key(key_id),
        Err(ModelError::KeyInUse { .. })
    ));
    assert_eq!(
        d.remove_key(key_id).unwrap_err().to_string(),
        "key is used by 1 host"
    );
    let mut second = host("db", Some(key_id));
    second.addr = "db.example.com".into();
    d.add_host(second.clone()).unwrap();
    assert_eq!(
        d.remove_key(key_id).unwrap_err().to_string(),
        "key is used by 2 hosts"
    );
    d.remove_host(second.id).unwrap();

    let l = layout("l", vec![tab("t", term(&h))]);
    let lid = l.id;
    d.save_layout(l).unwrap();
    assert!(matches!(
        d.remove_host(h.id),
        Err(ModelError::HostInUse { .. })
    ));

    d.remove_layout(lid).unwrap();
    assert_eq!(d.remove_layout(lid), Err(ModelError::UnknownLayout(lid)));
    d.remove_host(h.id).unwrap();
    d.remove_key(key_id).unwrap();
}

#[test]
fn layout_validation() {
    let mut d = VaultData::default();
    let a = host("a", None);
    let b = host("b", None);
    d.add_host(a.clone()).unwrap();
    d.add_host(b.clone()).unwrap();

    for bad in [0.0, 1.0, -0.2, 1.5, f32::NAN, f32::INFINITY] {
        let l = layout("x", vec![tab("t", split(bad, term(&a), term(&b)))]);
        assert!(
            matches!(d.save_layout(l), Err(ModelError::BadRatio(_))),
            "{bad}"
        );
    }

    let ghost = host("ghost", None);
    let l = layout("x", vec![tab("t", split(0.5, term(&a), term(&ghost)))]);
    assert_eq!(d.save_layout(l), Err(ModelError::UnknownHost(ghost.id)));

    let mut deep = term(&a);
    for _ in 0..40 {
        deep = split(0.5, deep, term(&b));
    }
    assert_eq!(
        d.save_layout(layout("deep", vec![tab("t", deep)])),
        Err(ModelError::TooDeep)
    );

    let ok = layout("ok", vec![tab("t", split(0.3, term(&a), term(&b)))]);
    let mut renamed = ok.clone();
    d.save_layout(ok).unwrap();
    assert!(matches!(
        d.save_layout(layout("OK", vec![])),
        Err(ModelError::DuplicateName { .. })
    ));
    renamed.tabs[0].title = "renamed".into();
    d.save_layout(renamed).unwrap();
    assert_eq!(d.layouts.len(), 1);
    d.validate().unwrap();
}

#[test]
fn validate_catches_inconsistent_data() {
    let mut d = VaultData::default();
    let h = host("a", None);
    d.hosts.push(h.clone());
    d.hosts.push(h.clone());
    assert!(matches!(d.validate(), Err(ModelError::DuplicateId { .. })));

    let mut d = VaultData::default();
    let entry = KnownHost {
        addr_port: "a:22".into(),
        key_type: "ssh-ed25519".into(),
        fingerprint_sha256: "SHA256:x".into(),
    };
    d.known_hosts.push(entry.clone());
    d.known_hosts.push(entry);
    assert!(matches!(
        d.validate(),
        Err(ModelError::DuplicateKnownHost(_))
    ));
}

#[test]
fn known_hosts_upsert_and_remove() {
    let mut d = VaultData::default();
    let mut entry = KnownHost {
        addr_port: "a:22".into(),
        key_type: "ssh-ed25519".into(),
        fingerprint_sha256: "SHA256:one".into(),
    };
    d.upsert_known_host(entry.clone());
    entry.fingerprint_sha256 = "SHA256:two".into();
    d.upsert_known_host(entry);
    assert_eq!(d.known_hosts.len(), 1);
    assert_eq!(d.known_hosts[0].fingerprint_sha256, "SHA256:two");
    assert!(d.remove_known_host("a:22"));
    assert!(!d.remove_known_host("a:22"));
}

#[test]
fn pane_tree_serde_shape() {
    let a = host("a", None);
    let n = split(0.25, term(&a), term(&a));
    let json = serde_json::to_value(&n).unwrap();
    assert_eq!(json["type"], "split");
    assert_eq!(json["dir"], "H");
    assert_eq!(json["a"]["type"], "terminal");
    assert_eq!(json["a"]["host_id"], a.id.to_string());
    assert_eq!(serde_json::from_value::<PaneNode>(json).unwrap(), n);
}

#[test]
fn hosts_export_has_only_shareable_fields() {
    let mut h = host("web", Some(Uuid::new_v4()));
    h.tags = vec!["prod".into()];
    h.tmux_session = Some("main".into());
    let json = tvcore::hosts_export_json(&[h, host("db", None)]);
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(
        v[0],
        serde_json::json!({
            "name": "web", "addr": "10.0.0.1", "port": 22, "user": "me",
            "tags": ["prod"], "tmux_session": "main"
        })
    );
    assert_eq!(v[1]["tmux_session"], serde_json::Value::Null);
    assert_eq!(v.as_array().unwrap().len(), 2);
}
