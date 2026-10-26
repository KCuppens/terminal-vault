use std::path::PathBuf;

use tempfile::TempDir;
use tvcore::backup::{
    backups_dir, create_backup, delete_vault, exports_dir, list_backups, restore_backup,
    write_export, BackupError,
};
use tvcore::{Host, KdfParams, Vault};
use uuid::Uuid;

const FAST: KdfParams = KdfParams {
    m_cost_kib: 8,
    t_cost: 1,
    p_cost: 1,
};

fn setup() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("vault.tv");
    (dir, path)
}

fn host(name: &str) -> Host {
    Host {
        id: Uuid::new_v4(),
        name: name.into(),
        addr: "10.0.0.1".into(),
        port: 22,
        user: "me".into(),
        key_id: None,
        tags: vec![],
        tmux_session: None,
    }
}

#[test]
fn backup_copies_the_file_into_the_backups_folder() {
    let (dir, path) = setup();
    Vault::create_with(&path, "pw", FAST).unwrap();
    let b = create_backup(&path).unwrap();
    assert_eq!(b.path.parent().unwrap(), dir.path().join("backups"));
    assert!(b.name.starts_with("vault-") && b.name.ends_with(".bak"));
    assert_eq!(b.name.len(), "vault-YYYYmmdd-HHMMSS.bak".len());
    assert_eq!(
        std::fs::read(&b.path).unwrap(),
        std::fs::read(&path).unwrap()
    );
    assert_eq!(b.bytes, std::fs::metadata(&path).unwrap().len());
    assert!(b.modified > 0);
}

#[test]
fn backups_in_one_second_do_not_overwrite_each_other() {
    let (_dir, path) = setup();
    Vault::create_with(&path, "pw", FAST).unwrap();
    let names: Vec<_> = (0..3).map(|_| create_backup(&path).unwrap().name).collect();
    let mut unique = names.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 3);
    assert_eq!(list_backups(&path).unwrap().len(), 3);
}

#[test]
fn backing_up_without_a_vault_fails() {
    let (_dir, path) = setup();
    assert!(matches!(create_backup(&path), Err(BackupError::NoVault)));
    assert!(list_backups(&path).unwrap().is_empty());
}

#[test]
fn list_is_newest_first_and_ignores_strangers() {
    let (_dir, path) = setup();
    Vault::create_with(&path, "pw", FAST).unwrap();
    let first = create_backup(&path).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(30));
    let second = create_backup(&path).unwrap();
    let folder = backups_dir(&path);
    std::fs::write(folder.join("notes.txt"), "x").unwrap();
    std::fs::create_dir(folder.join("vault-dir.bak")).unwrap();
    let names: Vec<_> = list_backups(&path)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert_eq!(names, [second.name, first.name]);
}

#[test]
fn restore_roundtrip_keeps_the_current_file_as_a_backup() {
    let (_dir, path) = setup();
    let mut v = Vault::create_with(&path, "pw", FAST).unwrap();
    v.update(|d| d.add_host(host("old"))).unwrap();
    let snapshot = create_backup(&path).unwrap();
    v.update(|d| d.add_host(host("new"))).unwrap();
    drop(v);
    let before = std::fs::read(&path).unwrap();

    restore_backup(&path, &snapshot.name).unwrap();

    let restored = Vault::open(&path, "pw").unwrap();
    let names: Vec<_> = restored
        .data()
        .hosts
        .iter()
        .map(|h| h.name.as_str())
        .collect();
    assert_eq!(names, ["old"]);
    let kept = list_backups(&path)
        .unwrap()
        .into_iter()
        .any(|b| std::fs::read(&b.path).unwrap() == before);
    assert!(kept, "the replaced file must survive as a backup");
}

#[test]
fn restore_rejects_bad_names() {
    let (dir, path) = setup();
    Vault::create_with(&path, "pw", FAST).unwrap();
    std::fs::write(dir.path().join("vault-evil.bak"), b"TVAULT\0\0whatever").unwrap();
    for name in [
        "../vault-evil.bak",
        "..\\vault-evil.bak",
        "sub/vault-a.bak",
        "vault.tv",
        "",
        "..",
        "vault-x.bak\0",
    ] {
        assert!(
            matches!(restore_backup(&path, name), Err(BackupError::InvalidName)),
            "{name:?}"
        );
    }
    assert!(matches!(
        restore_backup(&path, "vault-19700101-000000.bak"),
        Err(BackupError::NotFound(_))
    ));
}

#[test]
fn restore_rejects_files_that_are_not_vaults() {
    let (_dir, path) = setup();
    Vault::create_with(&path, "pw", FAST).unwrap();
    let before = std::fs::read(&path).unwrap();
    std::fs::create_dir_all(backups_dir(&path)).unwrap();
    std::fs::write(backups_dir(&path).join("vault-junk.bak"), "hello").unwrap();
    assert!(matches!(
        restore_backup(&path, "vault-junk.bak"),
        Err(BackupError::NotAVault(_))
    ));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(list_backups(&path).unwrap().len(), 1);
}

#[test]
fn restore_works_when_the_vault_file_is_gone() {
    let (_dir, path) = setup();
    Vault::create_with(&path, "pw", FAST).unwrap();
    let b = create_backup(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    restore_backup(&path, &b.name).unwrap();
    Vault::open(&path, "pw").unwrap();
}

#[test]
fn delete_removes_vault_and_backups_but_not_exports() {
    let (dir, path) = setup();
    Vault::create_with(&path, "pw", FAST).unwrap();
    create_backup(&path).unwrap();
    let export = write_export(&path, "hosts", ".json", b"[]").unwrap();
    delete_vault(&path).unwrap();
    assert!(!path.exists());
    assert!(!dir.path().join("backups").exists());
    assert!(export.exists());
    delete_vault(&path).unwrap();
}

#[test]
fn exports_land_in_the_exports_folder() {
    let (dir, path) = setup();
    let a = write_export(&path, "hosts", ".json", b"[1]").unwrap();
    let b = write_export(&path, "hosts", ".json", b"[2]").unwrap();
    assert_ne!(a, b);
    assert_eq!(a.parent().unwrap(), exports_dir(&path));
    assert_eq!(exports_dir(&path), dir.path().join("exports"));
    let name = a.file_name().unwrap().to_string_lossy().into_owned();
    assert!(
        name.starts_with("hosts-") && name.ends_with(".json"),
        "{name}"
    );
    assert_eq!(std::fs::read(&a).unwrap(), b"[1]");
}
