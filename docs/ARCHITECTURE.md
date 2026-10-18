# ChangeShare code guide

This guide explains how the main parts of ChangeShare fit together. You do not
need to understand every Git or networking detail to make a small change. Start
with the CLI command you want to change, then follow the calls into the helper
module responsible for that work.

## Project layout

```text
src/
  cli.ts       command parsing and user interaction
  git.ts       Git operations and patch creation/application
  safety.ts    denylist, secret scan, and share-code helpers
  transfer.ts  LAN discovery and encrypted network transfer
vscode-extension/
  extension.js  VS Code views, commands, and CLI integration
```

The CLI is the transfer engine. The VS Code extension is a user interface for
that engine; it does not implement its own patch or network protocol.

## A send, step by step

1. `src/cli.ts` handles `changeshare send`. It finds the repository root and
   reads options such as paths, stash reference, preview mode, and port.
2. The CLI calls one of the change readers in `src/git.ts`:
   - `workingChanges` reads uncommitted work and untracked files.
   - `stashChanges` reads a stash without removing it.
   - `commitChanges` creates a patch from a commit and its parent.
3. `src/safety.ts` checks the selected file names and added patch lines. The
   checks are intentionally visible to the user so they can review findings.
4. `src/transfer.ts` advertises a temporary sender on the LAN, waits for an
   approved receiver, encrypts the bundle, and closes the server after one use
   or expiry.

## A receive, step by step

1. The CLI calls `pullShare` in `src/transfer.ts`. It discovers a sender (or
   uses the address supplied through `--host`) and authenticates with the
   one-time code.
2. The receiver validates the downloaded bundle and decompresses the patch.
3. The CLI shows the file list and asks before applying the patch. Git checks
   whether the patch applies cleanly; if the sender's base commit differs, a
   three-way apply may be needed.
4. Before applying, ChangeShare can save the receiver's existing work in a Git
   stash. After a successful apply, `makeUndo` stores a reverse patch in the
   repository's `.git/changeshare` directory.

## Important implementation details

### Git changes do not stage files

`workingChanges` creates a temporary Git index, initializes it from `HEAD`,
and adds the working tree to that temporary index. Git then creates a binary
patch from the temporary index. The real index, which represents the user's
staging area, is not modified. The temporary directory is removed in a
`finally` block even when Git reports an error.

### Paths and patches are treated as data

Git is launched with `execFile`, which accepts an argument array and does not
interpret file names as shell commands. Paths from an incoming patch are
checked before Git applies it. Git commands that return lists use NUL
separators where possible so spaces and tabs in file names remain intact.

### The extension delegates transfers to the CLI

`vscode-extension/extension.js` owns the sidebar trees and VS Code dialogs. It
starts the CLI as a child process and maps CLI prompts to VS Code prompts. The
extension subscribes to VS Code's Git extension API and debounces repository
state, commit, and checkout events before refreshing relevant visible views.
The Stashes view uses a 30-second fallback poll while visible because the public
Git API does not expose a stash-list event.

## Making a change

- Change command behavior in `src/cli.ts`.
- Change how Git reads, applies, or reverses patches in `src/git.ts`.
- Change secret warnings or denylist behavior in `src/safety.ts`.
- Change discovery, authentication, encryption, or network messages in
  `src/transfer.ts`.
- Change sidebar layout and VS Code interactions in
  `vscode-extension/extension.js`.
- Update the user guide when a command, option, prompt, or visible workflow
  changes.

Build TypeScript after editing `src/` with `npm run build` from the repository
root. To try the extension in VS Code, open `vscode-extension/` and press
`F5`.
