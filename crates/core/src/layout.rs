use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

use crate::model::{Layout, VaultData};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenPlan {
    pub tab_idx: usize,
    pub host_id: Uuid,
    pub key_id: Uuid,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PlanError {
    #[error("layout references unknown host {0}")]
    UnknownHost(Uuid),
    #[error("host \"{0}\" has no key assigned")]
    HostWithoutKey(String),
    #[error("host \"{host}\" references unknown key {key}")]
    UnknownKey { host: String, key: Uuid },
}

impl Layout {
    pub fn flatten(&self) -> Vec<(usize, Uuid)> {
        let mut out = Vec::new();
        for (idx, tab) in self.tabs.iter().enumerate() {
            let mut ids = Vec::new();
            tab.root.host_ids(&mut ids);
            out.extend(ids.into_iter().map(|id| (idx, id)));
        }
        out
    }
}

pub fn plan_open(layout: &Layout, vault: &VaultData) -> Result<Vec<OpenPlan>, PlanError> {
    layout
        .flatten()
        .into_iter()
        .map(|(tab_idx, host_id)| {
            let host = vault.host(host_id).ok_or(PlanError::UnknownHost(host_id))?;
            let key_id = host
                .key_id
                .ok_or_else(|| PlanError::HostWithoutKey(host.name.clone()))?;
            if vault.key(key_id).is_none() {
                return Err(PlanError::UnknownKey {
                    host: host.name.clone(),
                    key: key_id,
                });
            }
            Ok(OpenPlan {
                tab_idx,
                host_id,
                key_id,
            })
        })
        .collect()
}
