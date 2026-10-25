use std::sync::Arc;

use russh::keys::ssh_key::LineEnding;
use russh::keys::{decode_secret_key, Algorithm, HashAlg, PrivateKey};
use thiserror::Error;
use uuid::Uuid;

use crate::model::{KeyEntry, Secret};

#[derive(Debug, Error)]
pub enum KeyError {
    #[error("key is encrypted; a passphrase is required")]
    PassphraseRequired,
    #[error("wrong key passphrase")]
    WrongPassphrase,
    #[error("not a readable private key: {0}")]
    Invalid(String),
    #[error("key generation failed: {0}")]
    Generate(String),
}

fn encode(name: &str, key: &PrivateKey) -> Result<KeyEntry, KeyError> {
    let private = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| KeyError::Invalid(e.to_string()))?;
    let public = key
        .public_key()
        .to_openssh()
        .map_err(|e| KeyError::Invalid(e.to_string()))?;
    Ok(KeyEntry {
        id: Uuid::new_v4(),
        name: name.to_string(),
        private_openssh: Secret::new(private.to_string()),
        public,
    })
}

pub fn generate_ed25519(name: &str) -> Result<KeyEntry, KeyError> {
    let mut key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .map_err(|e| KeyError::Generate(e.to_string()))?;
    key.set_comment(name);
    encode(name, &key)
}

pub fn import(name: &str, pem: &str, passphrase: Option<&str>) -> Result<KeyEntry, KeyError> {
    let passphrase = passphrase.filter(|p| !p.is_empty());
    let key = match decode_secret_key(pem, passphrase) {
        Ok(k) => k,
        Err(e) => {
            let encrypted = decode_secret_key(pem, None)
                .err()
                .is_some_and(|e| matches!(e, russh::keys::Error::KeyIsEncrypted));
            return Err(match (encrypted, passphrase) {
                (true, None) => KeyError::PassphraseRequired,
                (true, Some(_)) => KeyError::WrongPassphrase,
                (false, _) => KeyError::Invalid(e.to_string()),
            });
        }
    };
    encode(name, &key)
}

impl KeyEntry {
    pub fn public_line(&self) -> &str {
        &self.public
    }

    pub fn private_key(&self) -> Result<Arc<PrivateKey>, KeyError> {
        decode_secret_key(self.private_openssh.expose(), None)
            .map(Arc::new)
            .map_err(|e| KeyError::Invalid(e.to_string()))
    }

    pub fn fingerprint_sha256(&self) -> Result<String, KeyError> {
        Ok(self
            .private_key()?
            .public_key()
            .fingerprint(HashAlg::Sha256)
            .to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::ssh_key::private::KeypairData;

    fn encrypted_pem(passphrase: &str) -> (String, String) {
        let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
        let public = key.public_key().to_openssh().unwrap();
        let enc = key.encrypt(&mut rand::rng(), passphrase).unwrap();
        (enc.to_openssh(LineEnding::LF).unwrap().to_string(), public)
    }

    #[test]
    fn generate_roundtrip() {
        let entry = generate_ed25519("laptop").unwrap();
        assert!(entry.public_line().starts_with("ssh-ed25519 "));
        assert!(entry
            .private_openssh
            .expose()
            .starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));
        let key = entry.private_key().unwrap();
        assert!(matches!(key.key_data(), KeypairData::Ed25519(_)));
        assert_eq!(key.public_key().to_openssh().unwrap(), entry.public_line());
        assert!(entry.fingerprint_sha256().unwrap().starts_with("SHA256:"));
    }

    #[test]
    fn generated_keys_differ() {
        let a = generate_ed25519("a").unwrap();
        let b = generate_ed25519("b").unwrap();
        assert_ne!(a.public, b.public);
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn import_plain_roundtrip() {
        let original = generate_ed25519("orig").unwrap();
        let imported = import("copy", original.private_openssh.expose(), None).unwrap();
        assert_eq!(
            imported.public.split_whitespace().nth(1),
            original.public.split_whitespace().nth(1)
        );
        assert_eq!(imported.name, "copy");
    }

    #[test]
    fn import_encrypted_is_stored_decrypted() {
        let (pem, public) = encrypted_pem("hunter2");
        assert!(pem.contains("OPENSSH PRIVATE KEY"));
        let imported = import("enc", &pem, Some("hunter2")).unwrap();
        assert_eq!(
            imported.public.split_whitespace().nth(1),
            public.split_whitespace().nth(1)
        );
        assert!(!imported.private_key().unwrap().is_encrypted());
    }

    #[test]
    fn import_encrypted_errors() {
        let (pem, _) = encrypted_pem("hunter2");
        assert!(matches!(
            import("enc", &pem, None),
            Err(KeyError::PassphraseRequired)
        ));
        assert!(matches!(
            import("enc", &pem, Some("nope")),
            Err(KeyError::WrongPassphrase)
        ));
    }

    #[test]
    fn import_garbage() {
        assert!(matches!(
            import("x", "not a key", None),
            Err(KeyError::Invalid(_))
        ));
    }

    #[test]
    fn secret_debug_is_redacted() {
        let entry = generate_ed25519("k").unwrap();
        let dbg = format!("{entry:?}");
        assert!(!dbg.contains("BEGIN OPENSSH"));
        assert!(dbg.contains("Secret(***)"));
    }
}
