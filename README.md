# Terminal Vault

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build Status](https://github.com/KCuppens/terminal-vault/actions/workflows/build-windows.yml/badge.svg)](https://github.com/KCuppens/terminal-vault/actions)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20(soon)%20%7C%20macOS%20(soon)-informational)](#platforms)

> An open-source, local-first, zero-telemetry SSH client, key vault, and multi-pane terminal built with Tauri 2, Rust (`russh`), and React (`xterm.js`). A privacy-focused Termius alternative.

---

## Highlights

- **Encrypted Local Vault**: Hosts, private SSH keys, pinned fingerprints, and layouts are encrypted with **Argon2id** (64 MiB, 3 iterations) and **XChaCha20-Poly1305**. Keys never leave the local Rust core.
- **Termius Alternative Without Cloud**: No accounts, no subscriptions, no sync servers, no tracking, and zero telemetry. All connections run directly from your device.
- **Deep tmux Integration**: Attach to existing remote tmux sessions or launch a dedicated grouped window per pane. If tmux is missing on the remote host, it falls back cleanly to a standard shell.
- **Multi-Pane Workspace**: Split horizontally and vertically, drag dividers, switch between tabs, and restore complete multi-host grid layouts in one click.
- **Hardware-Accelerated Terminal**: Powered by `xterm.js` with WebGL rendering and canvas fallback for smooth high-throughput output.
- **Strict Host Key Verification**: Trust-On-First-Use (TOFU) with SHA-256 fingerprint pinning and clear warnings on changed server keys.
- **Import from OpenSSH**: Import hosts directly from `~/.ssh/config` and import existing private keys.

---

## Comparison: Terminal Vault vs. Termius

| Feature | Terminal Vault | Termius |
| :--- | :--- | :--- |
| **Storage & Sync** | 100% Local encrypted file (`vault.tv`) | Proprietary Cloud |
| **Account Required** | No | Yes |
| **Telemetry & Analytics** | None | Yes |
| **Encryption Standard** | Argon2id + XChaCha20-Poly1305 | AES-256 |
| **Pricing / License** | 100% Free & Open Source (MIT) | Freemium ($10–$30/mo) |
| **tmux Session Linking** | Built-in session picker & window grouping | Manual command / Paid add-on |
| **Host Key Pinning** | Enforced TOFU with explicit prompts | Standard |

---

## Security Architecture

1. **Vault Cryptography**:
   - Derived key + independent verifier via Argon2id ($m=64\text{ MiB}, t=3, p=1$).
   - Authenticated encryption using XChaCha20-Poly1305 with random 24-byte nonces.
   - Header authentication guarantees tampered files cannot be decrypted.
   - Differentiates incorrect passphrases from corrupt data.
2. **Key Security**:
   - Private keys remain exclusively in Rust memory while unlocked and are zeroized on drop.
   - The frontend layer only receives key names, public keys, and fingerprints.
3. **Sandbox & Surface**:
   - Tauri capability controls lock down the frontend surface: no direct filesystem, shell, or HTTP plugin exposure.
   - CSP permits local script execution from the application bundle only.
4. **Brute-Force Protection**:
   - Rate limiting and incremental unlock throttling kick in after consecutive failed passphrase attempts.

---

## Getting Started

### Installation (Windows)

Download the latest installer from the [Releases](https://github.com/KCuppens/terminal-vault/releases) page:

1. Download `Terminal.Vault_0.1.0_x64-setup.exe`.
2. Run the installer (SmartScreen notice may appear for unsigned binaries).
3. Set a master passphrase to initialize your local encrypted vault.

---

## Development & Building

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ or v24)
- [Rust](https://rustup.rs/) (stable toolchain)
- Tauri 2 CLI dependencies

### Setup

```bash
# Clone the repository
git clone https://github.com/KCuppens/terminal-vault.git
cd terminal-vault

# Install frontend dependencies
npm install

# Run frontend tests
npm test

# Run Rust core tests
cargo test -p tvcore

# Build application for Windows
npm run tauri build
```

---

## Project Structure

```
terminal-vault/
├── crates/core/        # tvcore: Pure Rust SSH engine (russh), vault crypto, layout logic
├── src-tauri/          # Tauri 2 native shell and secure IPC command handlers
└── src/                # React 18 + TypeScript frontend, xterm.js terminals, themes
```

---

## Contributing

Contributions, bug reports, and suggestions are welcome! Please read [SECURITY.md](SECURITY.md) before reporting security-related issues.

---

## License

This project is licensed under the [MIT License](LICENSE).
