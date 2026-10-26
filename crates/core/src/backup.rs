use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use thiserror::Error;

use crate::vault::{write_atomic, KdfParams, FORMAT_VERSION, HEADER_LEN, MAGIC, TAG_LEN};

const BACKUP_PREFIX: &str = "vault-";
const BACKUP_SUFFIX: &str = ".bak";

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("invalid backup name")]
    InvalidName,
    #[error("backup \"{0}\" does not exist")]
    NotFound(String),
    #[error("backup \"{0}\" is not a vault file")]
    NotAVault(String),
    #[error("the vault file does not exist")]
    NoVault,
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BackupInfo {
    pub name: String,
    pub path: PathBuf,
    /// Unix milliseconds.
    pub modified: u64,
    pub bytes: u64,
}

fn sibling_dir(vault_path: &Path, name: &str) -> PathBuf {
    vault_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .join(name)
}

pub fn backups_dir(vault_path: &Path) -> PathBuf {
    sibling_dir(vault_path, "backups")
}

pub fn exports_dir(vault_path: &Path) -> PathBuf {
    sibling_dir(vault_path, "exports")
}

/// `YYYYmmdd-HHMMSS` in UTC.
pub fn timestamp(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn info_for(path: PathBuf) -> io::Result<BackupInfo> {
    let meta = fs::metadata(&path)?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(BackupInfo {
        name,
        path,
        modified,
        bytes: meta.len(),
    })
}

fn is_backup_name(name: &str) -> bool {
    name.starts_with(BACKUP_PREFIX)
        && name.ends_with(BACKUP_SUFFIX)
        && !name.contains(['/', '\\', '\0'])
        && name != ".."
}

/// Copies the vault file to `<dir>/backups/vault-YYYYmmdd-HHMMSS.bak`. A second backup in the
/// same second gets a `-2`, `-3`, ... suffix instead of overwriting the first.
pub fn create_backup(vault_path: &Path) -> Result<BackupInfo, BackupError> {
    let bytes = match fs::read(vault_path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Err(BackupError::NoVault),
        Err(e) => return Err(e.into()),
    };
    let dir = backups_dir(vault_path);
    fs::create_dir_all(&dir)?;
    let stamp = timestamp(now_secs());
    let mut n = 1u32;
    let mut file_path = dir.join(format!("{BACKUP_PREFIX}{stamp}{BACKUP_SUFFIX}"));
    while file_path.exists() {
        n += 1;
        file_path = dir.join(format!("{BACKUP_PREFIX}{stamp}-{n}{BACKUP_SUFFIX}"));
    }
    write_atomic(&file_path, &bytes)?;
    Ok(info_for(file_path)?)
}

/// Newest first. Empty when there is no backups folder.
pub fn list_backups(vault_path: &Path) -> Result<Vec<BackupInfo>, BackupError> {
    let entries = match fs::read_dir(backups_dir(vault_path)) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_backup_name(&name) && entry.file_type()?.is_file() {
            out.push(info_for(entry.path())?);
        }
    }
    out.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(out)
}

/// Replaces the vault file with the named backup. The current file is first kept as its own
/// backup, so a restore can be undone.
pub fn restore_backup(vault_path: &Path, name: &str) -> Result<(), BackupError> {
    if !is_backup_name(name) {
        return Err(BackupError::InvalidName);
    }
    let source = backups_dir(vault_path).join(name);
    let bytes = match fs::read(&source) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Err(BackupError::NotFound(name.to_string()))
        }
        Err(e) => return Err(e.into()),
    };
    if bytes.len() < HEADER_LEN + TAG_LEN || !bytes.starts_with(MAGIC) {
        return Err(BackupError::NotAVault(name.to_string()));
    }
    let version = u16::from_le_bytes([bytes[8], bytes[9]]);
    if version != FORMAT_VERSION {
        return Err(BackupError::NotAVault(name.to_string()));
    }
    let kdf = KdfParams {
        m_cost_kib: u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]),
        t_cost: u32::from_le_bytes([bytes[14], bytes[15], bytes[16], bytes[17]]),
        p_cost: u32::from_le_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]),
    };
    if kdf.validate().is_err() {
        return Err(BackupError::NotAVault(name.to_string()));
    }
    match create_backup(vault_path) {
        Ok(_) | Err(BackupError::NoVault) => {}
        Err(e) => return Err(e),
    }
    write_atomic(vault_path, &bytes)?;
    Ok(())
}

/// Removes the vault file and the backups folder. Exports are left alone.
pub fn delete_vault(vault_path: &Path) -> io::Result<()> {
    for result in [
        fs::remove_file(vault_path),
        fs::remove_dir_all(backups_dir(vault_path)),
    ] {
        match result {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
    }
    Ok(())
}

/// Writes `bytes` to `<dir>/exports/<prefix>-<timestamp><ext>` and returns the path.
pub fn write_export(
    vault_path: &Path,
    prefix: &str,
    ext: &str,
    bytes: &[u8],
) -> io::Result<PathBuf> {
    let dir = exports_dir(vault_path);
    fs::create_dir_all(&dir)?;
    let stamp = timestamp(now_secs());
    let mut path = dir.join(format!("{prefix}-{stamp}{ext}"));
    let mut n = 1u32;
    while path.exists() {
        n += 1;
        path = dir.join(format!("{prefix}-{stamp}-{n}{ext}"));
    }
    write_atomic(&path, bytes)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_are_utc_civil_time() {
        assert_eq!(timestamp(0), "19700101-000000");
        assert_eq!(timestamp(951_782_400 + 86_399), "20000229-235959");
        assert_eq!(timestamp(1_761_350_400), "20251025-000000");
    }
}
