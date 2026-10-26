use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::model::{ModelError, VaultData};

pub(crate) const MAGIC: &[u8; 8] = b"TVAULT\0\0";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const VERIFIER_LEN: usize = 32;
const KEY_LEN: usize = 32;
pub(crate) const HEADER_LEN: usize = 8 + 2 + 4 + 4 + 4 + SALT_LEN + VERIFIER_LEN + NONCE_LEN;
pub(crate) const TAG_LEN: usize = 16;
pub(crate) const FORMAT_VERSION: u16 = 1;
const MAX_M_COST_KIB: u32 = 1 << 20;
const MAX_T_COST: u32 = 100;
const MAX_P_COST: u32 = 16;
#[derive(Debug, Error)]
pub enum VaultError {
    #[error("wrong passphrase")]
    WrongPassphrase,
    #[error("vault file is corrupt: {0}")]
    Corrupt(&'static str),
    #[error("unsupported vault format version {0}")]
    UnsupportedVersion(u16),
    #[error("passphrase must not be empty")]
    EmptyPassphrase,
    #[error("a vault already exists at {0}")]
    AlreadyExists(PathBuf),
    #[error("invalid vault data: {0}")]
    Invalid(#[from] ModelError),
    #[error("invalid key derivation parameters")]
    BadKdfParams,
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            m_cost_kib: 64 * 1024,
            t_cost: 3,
            p_cost: 1,
        }
    }
}

impl KdfParams {
    fn validate(&self) -> Result<Params, VaultError> {
        if self.m_cost_kib > MAX_M_COST_KIB || self.t_cost > MAX_T_COST || self.p_cost > MAX_P_COST
        {
            return Err(VaultError::BadKdfParams);
        }
        Params::new(
            self.m_cost_kib,
            self.t_cost,
            self.p_cost,
            Some(KEY_LEN + VERIFIER_LEN),
        )
        .map_err(|_| VaultError::BadKdfParams)
    }
}

#[derive(Serialize)]
struct PayloadOut<'a> {
    version: u64,
    data: &'a VaultData,
}

#[derive(Deserialize)]
struct PayloadIn {
    version: u64,
    data: VaultData,
}

pub struct Vault {
    path: PathBuf,
    data: VaultData,
    version: u64,
    kdf: KdfParams,
    salt: [u8; SALT_LEN],
    key: Zeroizing<[u8; KEY_LEN]>,
    verifier: [u8; VERIFIER_LEN],
}

fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    rand::fill(&mut out[..]);
    out
}

fn derive(
    passphrase: &str,
    salt: &[u8; SALT_LEN],
    kdf: &KdfParams,
) -> Result<(Zeroizing<[u8; KEY_LEN]>, [u8; VERIFIER_LEN]), VaultError> {
    if passphrase.is_empty() {
        return Err(VaultError::EmptyPassphrase);
    }
    let params = kdf.validate()?;
    let mut out = Zeroizing::new([0u8; KEY_LEN + VERIFIER_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut out[..])
        .map_err(|_| VaultError::BadKdfParams)?;
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    key.copy_from_slice(&out[..KEY_LEN]);
    let mut verifier = [0u8; VERIFIER_LEN];
    verifier.copy_from_slice(&out[KEY_LEN..]);
    Ok((key, verifier))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    std::hint::black_box(diff) == 0
}

fn u32_at(buf: &[u8], at: usize) -> Result<u32, VaultError> {
    buf.get(at..at + 4)
        .and_then(|s| s.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or(VaultError::Corrupt("truncated header"))
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "vault path has no file name")
    })?;
    let suffix: [u8; 6] = random();
    let mut tmp_name = std::ffi::OsString::from(".");
    tmp_name.push(name);
    tmp_name.push(format!(
        ".tmp-{}",
        suffix
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    ));
    let tmp = dir.join(tmp_name);

    let result = (|| {
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        let mut file = opts.open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return result;
    }
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

impl Vault {
    pub fn create(path: impl AsRef<Path>, passphrase: &str) -> Result<Self, VaultError> {
        Self::create_with(path, passphrase, KdfParams::default())
    }

    pub fn create_with(
        path: impl AsRef<Path>,
        passphrase: &str,
        kdf: KdfParams,
    ) -> Result<Self, VaultError> {
        let path = path.as_ref().to_path_buf();
        if path.exists() {
            return Err(VaultError::AlreadyExists(path));
        }
        let salt = random();
        let (key, verifier) = derive(passphrase, &salt, &kdf)?;
        let mut vault = Self {
            path,
            data: VaultData::default(),
            version: 0,
            kdf,
            salt,
            key,
            verifier,
        };
        vault.save()?;
        Ok(vault)
    }

    pub fn open(path: impl AsRef<Path>, passphrase: &str) -> Result<Self, VaultError> {
        let path = path.as_ref().to_path_buf();
        let bytes = fs::read(&path)?;
        if bytes.len() < HEADER_LEN + TAG_LEN {
            return Err(VaultError::Corrupt("file too short"));
        }
        if &bytes[..8] != MAGIC {
            return Err(VaultError::Corrupt("bad magic"));
        }
        let version = u16::from_le_bytes([bytes[8], bytes[9]]);
        if version != FORMAT_VERSION {
            return Err(VaultError::UnsupportedVersion(version));
        }
        let kdf = KdfParams {
            m_cost_kib: u32_at(&bytes, 10)?,
            t_cost: u32_at(&bytes, 14)?,
            p_cost: u32_at(&bytes, 18)?,
        };
        let mut salt = [0u8; SALT_LEN];
        salt.copy_from_slice(&bytes[22..22 + SALT_LEN]);
        let mut stored_verifier = [0u8; VERIFIER_LEN];
        stored_verifier.copy_from_slice(&bytes[22 + SALT_LEN..22 + SALT_LEN + VERIFIER_LEN]);
        let mut nonce = [0u8; NONCE_LEN];
        nonce.copy_from_slice(&bytes[HEADER_LEN - NONCE_LEN..HEADER_LEN]);

        kdf.validate()
            .map_err(|_| VaultError::Corrupt("invalid kdf parameters"))?;
        let (key, verifier) = derive(passphrase, &salt, &kdf)?;
        if !constant_time_eq(&verifier, &stored_verifier) {
            return Err(VaultError::WrongPassphrase);
        }

        let cipher = XChaCha20Poly1305::new((&*key).into());
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    &XNonce::from(nonce),
                    Payload {
                        msg: &bytes[HEADER_LEN..],
                        aad: &bytes[..HEADER_LEN],
                    },
                )
                .map_err(|_| VaultError::Corrupt("authentication failed"))?,
        );
        let payload: PayloadIn = serde_json::from_slice(&plaintext)
            .map_err(|_| VaultError::Corrupt("malformed payload"))?;
        Ok(Self {
            path,
            data: payload.data,
            version: payload.version,
            kdf,
            salt,
            key,
            verifier,
        })
    }

    pub fn exists(path: impl AsRef<Path>) -> bool {
        path.as_ref().is_file()
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn data(&self) -> &VaultData {
        &self.data
    }

    pub fn data_mut(&mut self) -> &mut VaultData {
        &mut self.data
    }

    /// Applies `f` and saves. If `f` or the save fails, the in-memory data is restored so
    /// memory never gets ahead of what is on disk.
    pub fn update<T>(
        &mut self,
        f: impl FnOnce(&mut VaultData) -> Result<T, ModelError>,
    ) -> Result<T, VaultError> {
        let backup = self.data.clone();
        let outcome = f(&mut self.data)
            .map_err(VaultError::from)
            .and_then(|out| self.save().map(|()| out));
        if outcome.is_err() {
            self.data = backup;
        }
        outcome
    }

    pub fn save(&mut self) -> Result<(), VaultError> {
        self.data.validate()?;
        let next = self.version + 1;
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&PayloadOut {
                version: next,
                data: &self.data,
            })
            .map_err(|_| VaultError::Corrupt("unserializable payload"))?,
        );
        let nonce: [u8; NONCE_LEN] = random();

        let mut file = Vec::with_capacity(HEADER_LEN + plaintext.len() + TAG_LEN);
        file.extend_from_slice(MAGIC);
        file.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        file.extend_from_slice(&self.kdf.m_cost_kib.to_le_bytes());
        file.extend_from_slice(&self.kdf.t_cost.to_le_bytes());
        file.extend_from_slice(&self.kdf.p_cost.to_le_bytes());
        file.extend_from_slice(&self.salt);
        file.extend_from_slice(&self.verifier);
        file.extend_from_slice(&nonce);
        debug_assert_eq!(file.len(), HEADER_LEN);

        let cipher = XChaCha20Poly1305::new((&*self.key).into());
        let ciphertext = cipher
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: &plaintext,
                    aad: &file,
                },
            )
            .map_err(|_| VaultError::Corrupt("encryption failed"))?;
        file.extend_from_slice(&ciphertext);

        write_atomic(&self.path, &file)?;
        self.version = next;
        Ok(())
    }

    pub fn change_passphrase(&mut self, new_passphrase: &str) -> Result<(), VaultError> {
        let salt = random();
        let (key, verifier) = derive(new_passphrase, &salt, &self.kdf)?;
        let old = (
            std::mem::replace(&mut self.salt, salt),
            std::mem::replace(&mut self.key, key),
            std::mem::replace(&mut self.verifier, verifier),
        );
        if let Err(e) = self.save() {
            (self.salt, self.key, self.verifier) = old;
            return Err(e);
        }
        Ok(())
    }
}
