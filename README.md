# Terminal Vault

A local-only SSH client with an encrypted host and key vault and multi-pane terminals. A desktop app (Windows first, Android later) built with Tauri 2, a Rust core and a React + xterm.js frontend. There is no cloud, no account and no telemetry; the only network traffic is the SSH connections you open.

## Features

- Encrypted vault holding hosts, SSH keys, saved layouts and pinned host keys.
- Generate ed25519 keys or import OpenSSH private keys (encrypted ones are decrypted on import and re-stored inside the vault).
- Tabs with horizontal/vertical split panes, draggable dividers, GPU-rendered terminals (WebGL with canvas fallback).
- Saved layouts: one click opens every pane of a layout in parallel.
- Keyboard shortcuts: `Ctrl+Shift+T` new tab, `Ctrl+Shift+D` split, `Ctrl+Shift+W` close pane.
- tmux: a host can name a default tmux session that every terminal on it attaches to. The "tmux" button on a host lists the sessions running on the server so you can attach to one, create a new one, or open a plain shell. Each pane gets its own tmux window (a grouped session), so panes do not mirror each other. If tmux is not installed on the server, a notice is printed and a plain shell starts. Session names are limited to letters, digits, `_` and `-` (up to 64). A session picked from the "tmux" button applies to that pane only and is not stored in saved layouts; reopened layouts use the host default.
  Limits: the picker lists only sessions you created by name, not the per-pane grouped sessions. A pane that loses its connection leaves its tmux window behind in the session; reconnecting opens a new window rather than reclaiming the old one, so close stale windows with `tmux kill-window` when needed.
- Vault management: change the passphrase, back up and restore the vault, delete it. A backup is taken automatically before a passphrase change or restore.
- Settings: auto-lock after idle time, lock on minimize, clipboard clearing for copied public keys, terminal font, size, scrollback, cursor style, bell, theme and UI scale.
- Hosts: export to JSON and import from `~/.ssh/config` (Host entries with HostName, User, Port; wildcard entries are skipped).
- Keys: add a comment when generating, see the key type, and remove a key (refused while hosts use it).
- Custom title bar with window controls.

## Security model

- **Vault file**: magic + format version + Argon2id parameters (stored, default m=64 MiB, t=3, p=1) + 16-byte salt + 24-byte nonce + XChaCha20-Poly1305 ciphertext of the JSON vault data. The header is authenticated as associated data, so any change to the file, parameters included, fails decryption. A fresh nonce is used on every save.
- **Wrong passphrase vs. damaged file** are told apart: Argon2id outputs an encryption key and a separate verifier; a wrong passphrase fails the verifier, while a corrupt or tampered file fails authentication.
- **Atomic saves**: written to a temp file in the same directory, fsynced, then renamed over the vault, with `0600` permissions on Unix. A failed save leaves the previous vault intact. A monotonically increasing version counter is stored in the encrypted payload (a hook for future sync).
- **Keys never leave Rust**: private keys exist only inside the encrypted vault and in Rust memory while unlocked; the frontend only ever receives the public key and fingerprint. Secrets are zeroized on drop.
- **Host keys**: trust on first use. A new key prompts with its SHA-256 fingerprint and is pinned on acceptance. A changed key is refused unless you explicitly accept that exact fingerprint in a separate, clearly marked prompt.
- **Authentication**: public key only. Keepalive every 15 s.
- **Tauri surface**: the capability file allows only the app's own commands and event listening; no fs, shell or http plugins are installed. The CSP allows scripts from the app bundle only.
- **Where the vault lives**: `vault.tv` in the app data directory (on Windows `%APPDATA%\dev.kcuppens.terminalvault\`). There is no passphrase recovery; keep a backup of the file and remember the passphrase.
- **Settings**: `settings.json` sits next to the vault file. It is plain JSON with no secrets (auto-lock minutes, clipboard clear time, terminal font, scrollback, cursor, bell, theme, UI scale), so it can be read while the vault is locked. Rust rejects out-of-range values.
- **Backups and exports**: backups are encrypted copies of the vault file in `backups/` next to it. Host exports are plain JSON in `exports/` (names, addresses, users and tags only; no keys). The app shows the resulting path with a Copy action. Restoring a backup or deleting the vault closes all sessions and locks the app.
- **Unlock throttling**: after 3 wrong passphrases in a row, unlock attempts are delayed (5, 10, 20, 40, then 60 seconds) until a correct one. Wrong passphrases and damaged files give different messages.

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
- Backups are plain file copies made on request (and before a passphrase change or restore); there is no sync.
- Public-key auth only: no passwords, no SSH agent, no agent forwarding, no SFTP or port forwarding.
- No UI for editing or removing pinned host keys beyond the "forget" action.
- Passphrases and imported private keys pass through the webview as plain strings on their way to Rust and are not zeroized there.
- The frontend has logic tests only (pane tree, layout plans, base64, IPC mock); there are no DOM component tests.
- The Tauri shell has no automated tests. It is type-checked and linted for the Windows target (`cargo xwin clippy`) and built by the release workflow, but its runtime behaviour has not been exercised yet.
