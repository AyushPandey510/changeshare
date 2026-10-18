# Security and privacy

ChangeShare is designed for a direct, short-lived handoff between computers on
a trusted local network. This page explains what it protects, what information
is visible, and where its limits are. For everyday commands, see the
[usage guide](USAGE.md).

## What is sent?

The encrypted transfer bundle contains:

- The Git patch, compressed before encryption.
- Changed file names and statuses, added/removed line counts, and the sender's
  base commit ID.
- The sender's Git name, OS username, and hostname.

The receiver uses the base commit to identify when its repository differs from
the sender's. Sender identity is shown before applying. These details are sent
inside the encrypted envelope and are not added to the patch or undo record.

For automatic discovery, the sender advertises a random service name and its
Git name on the local network so a receiver can choose the right computer. The
short share code is not sent as an HTTP field.

## How the transfer is protected

1. The sender creates a short-lived HTTP listener bound to a private or
   link-local IPv4 interface. It tries the next port if the requested one is in
   use.
2. Bonjour/mDNS advertises the sender for discovery. A receiver can connect
   directly with `--host` instead.
3. The sender must approve the receiver. Both sides use CPace with the
   one-time code to establish a session key.
4. The patch bundle is compressed and encrypted with AES-256-GCM using a
   derived session key. A code-authenticated handshake proves the peers know
   the code without sending the code itself.
5. The sender allows one successful delivery, expires after the configured
   interval, and shuts down after delivery or expiry. Three failed code checks
   also close the session.

ChangeShare has no cloud service or telemetry. The network transfer is direct
between the two computers. Local firewalls and network policy still control
which devices can connect.

## File and secret checks

The default filename denylist is:

```text
.env*  *.pem  *.key  id_rsa*
```

Set a repository-specific `denylist` in `.changeshare.json` to add or replace
the patterns. ChangeShare also scans added patch lines for common private-key,
AWS access key, GitHub token, generic secret assignment, and high-entropy
credential patterns. It hides the suspected secret value when displaying a
finding.

These are heuristics, not a complete secret detector. They may miss a secret or
flag ordinary text. Review the patch yourself. A secret finding requires an
explicit confirmation even when `--yes` is used.

`--include-ignored` tells Git to include ignored files and bypasses the filename
denylist. It does not disable the added-line secret scan; findings still need
explicit confirmation. Inspect the file list and preview before sharing.

## Patch and receiver safeguards

- Git is started with an argument array, not a shell command string.
- Working-tree patches use a temporary Git index, leaving the sender's real
  staging area unchanged.
- The receiver validates the bundle and checks incoming patch paths before
  asking Git to apply it.
- Git checks whether the patch applies. The receiver can preview, run a dry
  run, choose a conflict mode, or abort.
- Existing receiver work can be saved in a Git stash before the incoming patch
  is applied. That stash is retained for manual review and restoration.
- An undo patch is stored under `.git/changeshare` with restrictive local file
  permissions. It is not sent to the peer.

These safeguards reduce common mistakes; they do not replace backups, code
review, or repository access controls.

## Limits and threat model

Use ChangeShare on a network where you trust the connected devices. CPace
protects the short code from being sent directly, and AES-GCM protects the
bundle in transit, but ChangeShare does not protect a computer that is already
compromised or an authorized receiver who copies the files after applying
them. The sender's Git name is advertised locally for discovery.

The CPace dependency is pre-1.0 and documents that it has not had an independent
audit. A dependency check is not a cryptographic audit. Review its threat model
before using ChangeShare for sensitive work.

The receiver caps decompressed patches at 150 MiB. The sender warns when a
patch exceeds 100 MiB. The released CLI and extension currently target Linux
x64 and ARM64.
