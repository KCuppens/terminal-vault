use tvcore::keys::generate_ed25519;
use tvcore::layout::{plan_open, OpenPlan, PlanError};
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
    let key = generate_ed25519("k").unwrap();
    let key_id = key.id;
    d.add_key(key).unwrap();
    assert!(matches!(
        d.add_key(generate_ed25519("K").unwrap()),
        Err(ModelError::DuplicateName { .. })
    ));
    let h = host("web", Some(key_id));
    d.add_host(h.clone()).unwrap();
    assert!(matches!(
        d.remove_key(key_id),
        Err(ModelError::KeyInUse { .. })
    ));

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
fn flatten_and_plan() {
    let mut d = VaultData::default();
    let key = generate_ed25519("k").unwrap();
    let key_id = key.id;
    d.add_key(key).unwrap();
    let a = host("a", Some(key_id));
    let b = host("b", Some(key_id));
    d.add_host(a.clone()).unwrap();
    d.add_host(b.clone()).unwrap();

    let l = layout(
        "l",
        vec![
            tab("one", split(0.5, term(&a), split(0.5, term(&b), term(&a)))),
            tab("two", term(&b)),
        ],
    );
    assert_eq!(
        l.flatten(),
        vec![(0, a.id), (0, b.id), (0, a.id), (1, b.id)]
    );
    let plan = plan_open(&l, &d).unwrap();
    assert_eq!(
        plan,
        vec![
            OpenPlan {
                tab_idx: 0,
                host_id: a.id,
                key_id
            },
            OpenPlan {
                tab_idx: 0,
                host_id: b.id,
                key_id
            },
            OpenPlan {
                tab_idx: 0,
                host_id: a.id,
                key_id
            },
            OpenPlan {
                tab_idx: 1,
                host_id: b.id,
                key_id
            },
        ]
    );
    assert!(plan_open(&layout("empty", vec![]), &d).unwrap().is_empty());
}

#[test]
fn plan_errors_on_missing_refs() {
    let mut d = VaultData::default();
    let nokey = host("nokey", None);
    d.add_host(nokey.clone()).unwrap();

    let l = layout("l", vec![tab("t", term(&nokey))]);
    assert_eq!(
        plan_open(&l, &d),
        Err(PlanError::HostWithoutKey("nokey".into()))
    );

    let ghost = host("ghost", None);
    let l = layout("l", vec![tab("t", term(&ghost))]);
    assert_eq!(plan_open(&l, &d), Err(PlanError::UnknownHost(ghost.id)));

    let missing_key = Uuid::new_v4();
    let mut dangling = host("dangling", None);
    dangling.key_id = Some(missing_key);
    d.hosts.push(dangling.clone());
    let l = layout("l", vec![tab("t", term(&dangling))]);
    assert_eq!(
        plan_open(&l, &d),
        Err(PlanError::UnknownKey {
            host: "dangling".into(),
            key: missing_key
        })
    );
}
