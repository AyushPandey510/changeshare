# ChangeShare usage guide

This guide covers the options and decisions that do not fit in the quick
start. For the short install and first transfer, see the [main README](../README.md).

## Choose the source changes

```text
changeshare send [paths...] [--stash [ref] | --commit <ref>] [options]
```

| Option | Purpose |
| --- | --- |
| `paths...` | Send only the selected files or directories. |
| `--stash [ref]` | Send the newest stash, or a chosen ref such as `stash@{2}`. The stash is not dropped. |
| `--commit <ref>` | Send the changes in a commit compared with its parent. The receiver gets uncommitted edits. |
| `--preview` | Print the outgoing patch before sending. |
| `--yes` | Skip the ordinary send confirmation. Secret findings still require a separate confirmation. |
| `--port <n>` | Choose the listening port. Default: `8765`. If it is busy, the sender tries the next port. |
| `--expires <minutes>` | Set how long the sender waits. Default: `10`; allowed range: `1` to `1440`. |
| `--include-ignored` | Include Git-ignored files and bypass the filename denylist. Review carefully. |

Without a source option, `send` includes tracked edits, deletions, and untracked
files that Git does not ignore. Preparing the patch uses a temporary index, so
it does not stage or unstage your work.

## Review the patch

Before sending, ChangeShare displays changed file names, line counts, patch
size, and any likely secret findings. Use `--preview` to print the complete
patch. The sender must confirm before the listener starts. `--yes` skips that
ordinary confirmation, but it does not skip secret review or approval of an
incoming receiver.

To configure blocked filename patterns, create `.changeshare.json` at the root
of the Git repository:

```json
{
  "denylist": [".env*", "*.pem", "*.key", "id_rsa*", "credentials*.json"]
}
```

See [Security and privacy](SECURITY.md) for the default patterns and scanner
limits.

## Receive and apply

```text
changeshare receive <code> [--host <ip>] [--port <n>] [options]
```

| Option | Purpose |
| --- | --- |
| `--host <ip>` | Connect to the sender's private or link-local IPv4 address instead of using discovery. |
| `--port <n>` | Port for a direct `--host` connection. Use the sender's listening port. |
| `--preview` | Print the incoming patch before the apply prompt. |
| `--dry-run` | Ask Git to check whether the patch applies, then exit without applying it. |
| `--3way` | Use Git's three-way apply mode. |
| `--yes` | Skip the ordinary apply confirmation. It does not skip the local-changes decision. |

When automatic discovery is available, the receiver uses the port announced by
the sender. If you connect with `--host`, the receiver's `--port` must match the
sender's selected port.

### Receiver has local changes?

ChangeShare checks the receiver's working tree before connecting. If it already
has edits, the receiver is asked whether to continue with those edits saved in
a Git stash. This decision is still shown with `--yes`. The stash is retained
after the transfer; inspect it and run `git stash pop` when you are ready to
restore the saved work.

After download, the receiver reviews the file list, sender identity, and
optional patch preview. The transfer is applied only after confirmation.

### When a patch conflicts

Git checks the patch before applying it. If the repositories have different
base commits, ChangeShare warns the receiver and offers a three-way apply. If a
normal patch check fails, choose one of these options:

1. **Three-way apply** to let Git use the common history.
2. **Apply clean hunks and write `.rej` files** for hunks Git cannot place.
3. **Abort** and leave the incoming patch unapplied.

A three-way apply may leave conflict markers. ChangeShare prints the affected
files and clears the unmerged index entries so they can be resolved with normal
editor and Git commands. Edit the files to remove the markers, then run:

```sh
git add -- <resolved-files>
git restore --staged -- <resolved-files>
```

The second command leaves the resolved edits in the working tree as uncommitted
changes. If you want to discard the transfer instead, use `changeshare undo`
before editing the conflicted files.

Reject mode puts unapplied hunks in `<file>.rej` files. Review those files and
the changes that were applied. The latest transfer can be reversed with the
same undo command.

### Undo a transfer

```sh
changeshare undo
```

ChangeShare records a reverse patch under `.git/changeshare` after applying a
transfer. `undo` applies the latest reverse patch and removes that undo record.
Undo only works while the affected files still match the state produced by the
transfer; later edits can make the reverse patch fail to apply. Undo does not
automatically restore the receiver's pre-transfer stash. Review that stash and
pop it separately.

## VS Code

The extension adds four sidebar views:

- **Working Changes:** changed file list; select files to share a subset.
- **Stashes:** share a stash from the project.
- **Recent Commits:** share a commit's changes as uncommitted edits.
- **Actions:** receive, undo, run LAN diagnostics, or choose a project.

The extension delegates transfers to the CLI and maps its prompts to VS Code
dialogs. Progress and patch details appear in **Output → ChangeShare**. VS Code's
Git extension events refresh the relevant visible lists after a short debounce.
Stashes also have a 30-second fallback check while the Stashes view is visible,
because the public Git API has no stash-list event. Configure
`changeshare.defaultPort` in VS Code settings if needed.

The extension and released CLI currently target Linux.
See the [extension guide](../vscode-extension/README.md) for development and
packaging.

## Diagnostics

```sh
changeshare doctor
```

The doctor command checks Git and Node versions, repository detection, whether
the default port is available, detected LAN addresses, Avahi, and common
firewall configuration.

To test device-to-device reachability, run this on one computer:

```sh
changeshare doctor --listen
```

Then run this on the other computer, replacing the IP address:

```sh
changeshare doctor --peer 192.168.1.20
```

The connectivity check uses port `8766`, independently of the transfer port.

## Troubleshooting

<details>
<summary>Automatic discovery cannot find the sender</summary>

Confirm both computers are on the same LAN and Avahi/mDNS discovery is
available. Otherwise, use the sender's private or link-local IPv4 address with
`--host`. If using a non-default port, pass it to the sender and receiver.

</details>

<details>
<summary>The computers cannot connect</summary>

Run `changeshare doctor --listen` on one computer and
`changeshare doctor --peer <ip>` on the other. Check Wi-Fi client isolation
and local firewall rules. With UFW, allow the sender port (default `8765`):

```sh
sudo ufw allow 8765/tcp
```

Use the sender's selected port if it differs. On a managed computer, ask your
network administrator before changing firewall rules.

</details>

<details>
<summary>The patch does not apply cleanly</summary>

Use `--dry-run` to inspect compatibility first. Review a three-way apply if
the code bases differ. If conflicts remain, resolve the markers and keep the
result as uncommitted edits, or abort and ask the sender for a patch based on a
closer commit.

</details>

<details>
<summary>The VS Code command or extension is missing</summary>

Open a Git project and select the ChangeShare Activity Bar icon. Confirm that
the CLI is installed and `~/.local/bin` is on `PATH`. If the extension is
installed but a list is stale, use **ChangeShare: Refresh Lists** in the
Command Palette. Check **Output → ChangeShare** for command details.

</details>
