use std::fs;
use std::path::PathBuf;

use tempfile::TempDir;
use tvcore::keys::generate_ed25519;
use tvcore::{Host, KdfParams, Vault, VaultError};
use uuid::Uuid;

const FAST: KdfParams = KdfParams {
    m_cost_kib: 64,
    t_cost: 1,
    p_cost: 1,
};

fn vault_path() -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("vault.tv");
    (dir, path)
}

fn host(name: &str) -> Host {
    Host {
        id: Uuid::new_v4(),
        name: name.into(),
        addr: "example.com".into(),
        port: 22,
        user: "root".into(),
        key_id: None,
        tags: vec!["prod".into()],
        tmux_session: None,
    }
}

#[test]
fn roundtrip_with_default_kdf_params() {
    let (_dir, path) = vault_path();
    let mut v = Vault::create(&path, "correct horse").unwrap();
    let key = generate_ed25519("k", "k").unwrap();
    let key_id = key.id;
    let secret = key.private_openssh.expose().to_string();
    v.data_mut().add_key(key).unwrap();
    let mut h = host("web");
    h.key_id = Some(key_id);
    v.data_mut().add_host(h.clone()).unwrap();
    v.save().unwrap();

    let raw = fs::read(&path).unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("example.com"));
    assert!(!String::from_utf8_lossy(&raw).contains("OPENSSH"));

    let opened = Vault::open(&path, "correct horse").unwrap();
    assert_eq!(opened.data().hosts, vec![h]);
    assert_eq!(opened.data().keys[0].private_openssh.expose(), secret);
    assert_eq!(opened.version(), v.version());
}

#[test]
fn header_stores_default_params() {
    let (_dir, path) = vault_path();
    Vault::create_with(&path, "pw", FAST).unwrap();
    let raw = fs::read(&path).unwrap();
    assert_eq!(&raw[..6], b"TVAULT");
    assert_eq!(u16::from_le_bytes([raw[8], raw[9]]), 1);
    assert_eq!(u32::from_le_bytes(raw[10..14].try_into().unwrap()), 64);
    let d = KdfParams::default();
    assert_eq!((d.m_cost_kib, d.t_cost, d.p_cost), (65536, 3, 1));
}

#[test]
fn wrong_passphrase() {
    let (_dir, path) = vault_path();
    Vault::create_with(&path, "right", FAST).unwrap();
    assert!(matches!(
        Vault::open(&path, "wrong"),
        Err(VaultError::WrongPassphrase)
    ));
}

#[test]
fn empty_passphrase_rejected() {
    let (_dir, path) = vault_path();
    assert!(matches!(
        Vault::create_with(&path, "", FAST),
        Err(VaultError::EmptyPassphrase)
    ));
    assert!(!path.exists());
}

#[test]
fn create_refuses_to_overwrite() {
    let (_dir, path) = vault_path();
    Vault::create_with(&path, "pw", FAST).unwrap();
    assert!(matches!(
        Vault::create_with(&path, "other", FAST),
        Err(VaultError::AlreadyExists(_))
    ));
    Vault::open(&path, "pw").unwrap();
}

#[test]
fn corrupt_files() {
    let (_dir, path) = vault_path();
    Vault::create_with(&path, "pw", FAST).unwrap();
    let good = fs::read(&path).unwrap();

    fs::write(&path, b"short").unwrap();
    assert!(matches!(
        Vault::open(&path, "pw"),
        Err(VaultError::Corrupt(_))
    ));

    let mut bad_magic = good.clone();
    bad_magic[0] ^= 0xff;
    fs::write(&path, &bad_magic).unwrap();
    assert!(matches!(
        Vault::open(&path, "pw"),
        Err(VaultError::Corrupt(_))
    ));

    fs::write(&path, &good[..good.len() - 1]).unwrap();
    assert!(matches!(
        Vault::open(&path, "pw"),
        Err(VaultError::Corrupt(_))
    ));

    let mut huge_m = good.clone();
    huge_m[10..14].copy_from_slice(&u32::MAX.to_le_bytes());
    fs::write(&path, &huge_m).unwrap();
    assert!(matches!(
        Vault::open(&path, "pw"),
        Err(VaultError::Corrupt(_))
    ));
}

#[test]
fn unsupported_version() {
    let (_dir, path) = vault_path();
    Vault::create_with(&path, "pw", FAST).unwrap();
    let mut raw = fs::read(&path).unwrap();
    raw[8..10].copy_from_slice(&7u16.to_le_bytes());
    fs::write(&path, &raw).unwrap();
    assert!(matches!(
        Vault::open(&path, "pw"),
        Err(VaultError::UnsupportedVersion(7))
    ));
}

#[test]
fn tampered_ciphertext_is_detected() {
    let (_dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    v.data_mut().add_host(host("web")).unwrap();
    v.save().unwrap();
    let good = fs::read(&path).unwrap();
    for idx in [
        good.len() - 1,
        good.len() / 2 + 40,
        8 + 2 + 12 + 16 + 32 + 3,
    ] {
        let mut raw = good.clone();
        raw[idx] ^= 0x01;
        fs::write(&path, &raw).unwrap();
        let err = Vault::open(&path, "pw").err().unwrap();
        assert!(
            matches!(err, VaultError::Corrupt(_) | VaultError::WrongPassphrase),
            "byte {idx}: {err:?}"
        );
    }
    let mut raw = good;
    let last = raw.len() - 1;
    raw[last] ^= 0x01;
    fs::write(&path, &raw).unwrap();
    assert!(matches!(
        Vault::open(&path, "pw"),
        Err(VaultError::Corrupt(_))
    ));
}

#[test]
fn version_increments_and_persists() {
    let (_dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    assert_eq!(v.version(), 1);
    v.save().unwrap();
    v.save().unwrap();
    assert_eq!(v.version(), 3);
    assert_eq!(Vault::open(&path, "pw").unwrap().version(), 3);
}

#[test]
fn every_save_uses_a_fresh_nonce() {
    let (_dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    let nonce = |raw: &[u8]| raw[22 + 16 + 32..22 + 16 + 32 + 24].to_vec();
    let a = nonce(&fs::read(&path).unwrap());
    v.save().unwrap();
    let b = nonce(&fs::read(&path).unwrap());
    assert_ne!(a, b);
}

#[test]
fn invalid_data_is_not_saved() {
    let (_dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    let before = fs::read(&path).unwrap();
    v.data_mut().hosts.push(host("dup"));
    v.data_mut().hosts.push(host("dup"));
    assert!(matches!(v.save(), Err(VaultError::Invalid(_))));
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(v.version(), 1);
}

#[test]
fn change_passphrase() {
    let (_dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "old", FAST).unwrap();
    v.data_mut().add_host(host("web")).unwrap();
    v.save().unwrap();
    v.change_passphrase("new").unwrap();
    assert!(matches!(
        Vault::open(&path, "old"),
        Err(VaultError::WrongPassphrase)
    ));
    let opened = Vault::open(&path, "new").unwrap();
    assert_eq!(opened.data().hosts.len(), 1);
    assert_eq!(opened.version(), 3);
    assert!(matches!(
        v.change_passphrase(""),
        Err(VaultError::EmptyPassphrase)
    ));
    Vault::open(&path, "new").unwrap();
}

#[cfg(unix)]
#[test]
fn file_permissions_are_0600() {
    use std::os::unix::fs::PermissionsExt;
    let (_dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    v.save().unwrap();
    let mode = fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[cfg(unix)]
#[test]
fn failed_save_leaves_old_file_valid() {
    use std::os::unix::fs::PermissionsExt;
    let (dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    v.data_mut().add_host(host("web")).unwrap();
    v.save().unwrap();
    let before = fs::read(&path).unwrap();

    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).unwrap();
    let writable_anyway = fs::File::create(dir.path().join("probe")).is_ok();
    if writable_anyway {
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        eprintln!("skipping read-only dir assertion: directory writable (running as root?)");
        return;
    }
    v.data_mut().add_host(host("db")).unwrap();
    let version = v.version();
    let result = v.save();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();

    assert!(matches!(result, Err(VaultError::Io(_))));
    assert_eq!(v.version(), version);
    assert_eq!(fs::read(&path).unwrap(), before);
    let opened = Vault::open(&path, "pw").unwrap();
    assert_eq!(opened.data().hosts.len(), 1);
    let leftovers: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name())
        .collect();
    assert_eq!(leftovers.len(), 1, "{leftovers:?}");
}

/// Runs `f` with `dir` read-only. `None` when the directory stays writable (running as root).
#[cfg(unix)]
fn with_read_only_dir<R>(dir: &std::path::Path, f: impl FnOnce() -> R) -> Option<R> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o500)).unwrap();
    let probe = dir.join("probe");
    if fs::File::create(&probe).is_ok() {
        fs::remove_file(probe).unwrap();
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).unwrap();
        eprintln!("skipping read-only dir assertion: directory writable (running as root?)");
        return None;
    }
    let out = f();
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).unwrap();
    Some(out)
}

#[cfg(unix)]
#[test]
fn failed_change_passphrase_keeps_old_passphrase() {
    let (dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "old", FAST).unwrap();
    let result = with_read_only_dir(dir.path(), || v.change_passphrase("new"));
    let Some(result) = result else { return };
    assert!(matches!(result, Err(VaultError::Io(_))));
    Vault::open(&path, "old").unwrap();
    assert!(matches!(
        Vault::open(&path, "new"),
        Err(VaultError::WrongPassphrase)
    ));
    v.save().unwrap();
    Vault::open(&path, "old").unwrap();
}

#[test]
fn update_rolls_back_when_the_change_is_invalid() {
    let (_dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    v.update(|d| d.add_host(host("web"))).unwrap();
    let version = v.version();
    assert!(v.update(|d| d.add_host(host("web"))).is_err());
    assert_eq!(v.data().hosts.len(), 1);
    assert_eq!(v.version(), version);
}

#[cfg(unix)]
#[test]
fn update_rolls_back_when_the_save_fails() {
    let (dir, path) = vault_path();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    v.update(|d| d.add_host(host("web"))).unwrap();
    let result = with_read_only_dir(dir.path(), || v.update(|d| d.add_host(host("db"))));
    let Some(result) = result else { return };
    assert!(matches!(result, Err(VaultError::Io(_))));
    assert_eq!(v.data().hosts.len(), 1);
    assert_eq!(Vault::open(&path, "pw").unwrap().data().hosts.len(), 1);
}
