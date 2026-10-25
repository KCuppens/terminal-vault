# Terminal Vault

A local-only SSH client with an encrypted host and key vault and multi-pane terminals. A desktop app (Windows first, Android later) built with Tauri 2, a Rust core and a React + xterm.js frontend. There is no cloud, no account and no telemetry; the only network traffic is the SSH connections you open.

## Features

- Encrypted vault holding hosts, SSH keys, saved layouts and pinned host keys.
- Generate ed25519 keys or import OpenSSH private keys (encrypted ones are decrypted on import and re-stored inside the vault).
- Tabs with horizontal/vertical split panes, draggable dividers, GPU-rendered terminals (WebGL with canvas fallback).
- Saved layouts: one click opens every pane of a layout in parallel.
- Keyboard shortcuts: `Ctrl+Shift+T` new tab, `Ctrl+Shift+D` split, `Ctrl+Shift+W` close pane.

## Security model

- **Vault file**: magic + format version + Argon2id parameters (stored, default m=64 MiB, t=3, p=1) + 16-byte salt + 24-byte nonce + XChaCha20-Poly1305 ciphertext of the JSON vault data. The header is authenticated as associated data, so any change to the file, parameters included, fails decryption. A fresh nonce is used on every save.
- **Wrong passphrase vs. damaged file** are told apart: Argon2id outputs an encryption key and a separate verifier; a wrong passphrase fails the verifier, while a corrupt or tampered file fails authentication.
- **Atomic saves**: written to a temp file in the same directory, fsynced, then renamed over the vault, with `0600` permissions on Unix. A failed save leaves the previous vault intact. A monotonically increasing version counter is stored in the encrypted payload (a hook for future sync).
- **Keys never leave Rust**: private keys exist only inside the encrypted vault and in Rust memory while unlocked; the frontend only ever receives the public key and fingerprint. Secrets are zeroized on drop.
- **Host keys**: trust on first use. A new key prompts with its SHA-256 fingerprint and is pinned on acceptance. A changed key is refused unless you explicitly accept that exact fingerprint in a separate, clearly marked prompt.
- **Authentication**: public key only. Keepalive every 15 s.
- **Tauri surface**: the capability file allows only the app's own commands and event listening; no fs, shell or http plugins are installed. The CSP allows scripts from the app bundle only.
- **Where the vault lives**: `vault.tv` in the app data directory (on Windows `%APPDATA%\dev.kcuppens.terminalvault\`). There is no passphrase recovery; keep a backup of the file and remember the passphrase.

## Layout

```
crates/core   tvcore: vault, data model, keys, russh session manager, layout planning (no Tauri dependency)
src-tauri     thin Tauri 2 shell exposing tvcore as commands/events
src           React + TypeScript frontend (xterm.js), with a swappable IPC layer
```

All logic lives in `tvcore` and is tested without a GUI. `src/ipc` has a Tauri implementation and an in-memory mock; opening the frontend in a plain browser (or under vitest) uses the mock.

## Build and run

Requirements: Rust (stable), Node 24+. On Windows the WebView2 runtime ships with Windows 11 and is installed by the installer on Windows 10.

```
npm ci
npm test                  # frontend unit tests
cargo test -p tvcore      # core tests (needs /usr/sbin/sshd for the session tests on Unix; skipped with a message otherwise)
npm run tauri dev         # run the desktop app
npm run tauri build       # produce the installer in src-tauri/target/release/bundle/
```

`npm run dev` starts only the frontend with the mock IPC for UI work in a browser.

Releases are built by `.github/workflows/build-windows.yml` on `v*` tags or manual dispatch (Windows runner, NSIS installer uploaded as an artifact). Pushes and pull requests run core and frontend tests on Ubuntu.

## Limitations

- Milestone 1: Windows desktop target only; the Android build is not set up yet.
- No sync or backup; the vault is a single local file that is rewritten in full on every save.
- Public-key auth only: no passwords, no SSH agent, no agent forwarding, no SFTP or port forwarding.
- No UI yet for editing or removing pinned host keys, deleting keys, or changing the vault passphrase (the core supports passphrase change).
- Passphrases and imported private keys pass through the webview as plain strings on their way to Rust and are not zeroized there.
- The frontend has logic tests only (pane tree, layout plans, base64, IPC mock); there are no DOM component tests.
- The Tauri shell has no automated tests. It is type-checked and linted for the Windows target (`cargo xwin clippy`) and built by the release workflow, but its runtime behaviour has not been exercised yet.
