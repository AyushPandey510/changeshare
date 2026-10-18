# changeshare

`changeshare` shares uncommitted Git changes directly between Linux machines on a private LAN. The sender creates a binary-safe patch from a temporary Git index; the receiver applies it as uncommitted edits.

## Requirements

- Linux
- Node.js 22 or later
- Git 2.30 or later
- Machines must allow device-to-device traffic on the LAN
- `avahi-daemon` is recommended for discovery; `--host` works without it

Node 22 is required by the selected CPace package. This is newer than the Node 18 floor in the draft FSD.

## Install without cloning the repository

Run this command on Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/AyushPandey510/changeshare/main/install.sh | bash
```

The installer detects x64 or ARM64 and installs the matching CLI binary to `~/.local/bin/changeshare`. If the VS Code `code` or `code-insiders` command is on PATH, it also downloads and installs the ChangeShare VS Code extension from the same GitHub release. If it updates your shell configuration, open a new terminal (or run the `source` command it prints). Then run `changeshare --version`. Git remains required. Colleagues do not need to clone the repository.

### Publish a GitHub release

The installer downloads the CLI and VS Code extension from the latest GitHub release. To create a release, make sure the extension version in `vscode-extension/package.json` is updated, then push a new, unused version tag from the commit you want to release:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

Replace `vX.Y.Z` with the next version tag. The GitHub Actions release workflow builds the Linux CLI binaries, packages `changeshare-vscode.vsix`, and attaches those files and `install.sh` to the release. Wait for the workflow to finish and confirm the assets appear on the GitHub Releases page. Then run the install command above; VS Code's `code` or `code-insiders` command must be on `PATH` for the extension to install automatically.

## Quick start

```sh
# Sender, from the Git repository
changeshare send

# Receiver, from its copy of the repository
changeshare receive blue-tiger-42
```

The sender approves each receiver. When multiple senders are discovered, the receiver lists their Git names, hostnames, and addresses so you can choose the right machine. The receiver reviews the file list and confirms before applying. The share code still authenticates the transfer. If mDNS discovery does not find the sender, use the LAN address shown on the sender:

```sh
changeshare receive blue-tiger-42 --host 192.168.1.20
```

## VS Code extension

The `vscode-extension/` folder contains a desktop extension that adds Share, Receive, Undo, and LAN diagnostics commands while keeping this CLI as the transfer engine. See [the extension guide](vscode-extension/README.md) for local development and packaging. The extension currently targets Linux, matching the available release binaries.

## Commands

```text
changeshare send [paths...] [--stash [stash@{n}] | --commit <ref>] [--preview] [--yes] [--port n] [--expires min] [--include-ignored]
changeshare receive <code> [--host ip] [--port n] [--yes] [--3way] [--dry-run] [--preview]
changeshare undo
changeshare doctor [--listen | --peer ip]
```

`send` includes tracked edits, deletions, and untracked nonignored files. Paths restrict the transfer. `--preview` displays the patch before sending. On `receive`, `--preview` displays the received patch before the apply prompt. `--stash` sends the latest stash or the selected ref. `--commit <ref>` sends a commit's changes, which the receiver applies as uncommitted edits. `--yes` skips the ordinary send/apply prompts; secret findings still require explicit confirmation and sender approval is always required.

The default secret-file denylist is `.env*`, `*.pem`, `*.key`, and `id_rsa*`. Configure it in a repository-local `.changeshare.json`:

```json
{
  "denylist": [".env*", "*.pem", "*.key", "id_rsa*", "credentials*.json"]
}
```

`--include-ignored` includes Git-ignored files and overrides the denylist. Review the preview and secret findings carefully when using it.

## Transfer and privacy

- A temporary server binds to a private or link-local IPv4 interface only. It tries the next port when the requested port is occupied and closes after delivery, expiry, or cancellation.
- The receiver authenticates with CPace using the share code. The patch is gzip-compressed and encrypted with AES-256-GCM using a derived session key. The code is never sent over HTTP.
- Sender Git name is advertised on the local network for sender selection. The sender's Git name, OS username, and hostname are also sent inside the encrypted live transfer envelope and shown to the receiver at the apply prompt. They are not part of the patch or undo data.
- There is no telemetry or cloud service. Discovery and peer traffic stay on the LAN.
- Discovery advertises a random service name instead of a plain hash of the short code. A public hash of a short code would allow offline guessing and defeat the PAKE's protection.
- The PAKE dependency is pre-1.0 and documents that it has not had an independent audit. Review its threat model before using this tool for sensitive transfers; the dependency check alone is not a cryptographic audit.

## Applying, conflicts, and undo

The receiver checks the patch before applying it. A differing base commit prompts for a three-way apply. On conflicts, choose a three-way apply, apply clean hunks and leave `.rej` files, or abort. A three-way conflict leaves conflict markers in the affected files and prints the file list. Resolve the markers, run `git add -- <files>`, then `git restore --staged -- <files>` to keep the resolved result as uncommitted edits. To discard the transfer before editing, run `changeshare undo`. `--dry-run` checks without applying. A dirty receiver tree can be stashed before transfer; the stash is retained so it can be restored after undo or review. `changeshare undo` applies a reverse patch stored under `.git/changeshare`.

## Troubleshooting

- Run `changeshare doctor` for Git, Node, Avahi, firewall, port, and LAN checks.
- If automatic discovery fails, use `changeshare receive <code> --host <sender-lan-ip>`.
- For UFW, allow the selected sender port with `sudo ufw allow 8765/tcp` (replace 8765 if configured otherwise).
- Check that the Wi-Fi does not use client isolation. `changeshare doctor --listen` on one machine and `changeshare doctor --peer <ip>` on another checks peer connectivity.
- If the peer connection fails, the office network may block device-to-device traffic; ask IT to allow LAN peer connections.

## Development

### Build and run from source

You need Node.js 22 or later and Git 2.30 or later. From the repository root:

```sh
npm install
npm run build
node dist/cli.js --help
```

The TypeScript source is in `src/`. The build writes JavaScript and type
declarations to `dist/`. For example, after building, run `node dist/cli.js
send` from inside a Git project to start a share.

### Where to find things

| File | What it does |
| --- | --- |
| `src/cli.ts` | Reads command-line arguments and coordinates sending, receiving, undo, and diagnostics. |
| `src/git.ts` | Reads changes from Git, creates and applies patches, and stores undo data. |
| `src/safety.ts` | Loads the secret-file denylist, checks added lines for likely secrets, and creates share codes. |
| `src/transfer.ts` | Discovers peers on the LAN and sends or receives encrypted patch bundles. |
| `vscode-extension/extension.js` | Builds the ChangeShare sidebar and passes user actions to the CLI. |
| `.github/workflows/release.yml` | Builds Linux binaries and the VS Code package for tagged releases. |

### How a transfer works

1. The sender asks Git for the selected changes. For working-tree changes it
   uses a temporary Git index, so preparing a transfer does not stage files.
2. ChangeShare checks the file list and added patch lines, then asks the sender
   to review and approve the transfer.
3. The sender starts a short-lived server on a private LAN address and shows a
   one-time share code. The receiver discovers that server or connects with
   `--host`.
4. Both computers use the code to establish an encrypted session. The sender
   must approve the receiver, and the receiver reviews the patch before it is
   applied.
5. ChangeShare saves a reverse patch under `.git/changeshare`, which lets the
   receiver undo the transfer with `changeshare undo`.

For a deeper explanation of the code, see [the architecture guide](docs/ARCHITECTURE.md).

### VS Code extension

Open `vscode-extension/` in VS Code and press `F5` to launch an Extension
Development Host. The extension shells out to Git for sidebar data and runs the
ChangeShare CLI for transfers. To package a local VSIX, run `npm run package`
from `vscode-extension/`.

### Code style

Use two spaces for indentation and keep one statement per line. Add comments
when code relies on a Git or network detail that is not obvious from the code
itself; prefer explaining the reason for a step over repeating what the next
line already says.

Run `npm run build` after changing TypeScript to catch type and compiler errors.
```sh
npm run build
```
