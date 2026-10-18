# ChangeShare for VS Code

This desktop extension adds guided commands to VS Code while the existing ChangeShare CLI continues to handle Git patches and LAN transfers.

## Use it

1. Run the ChangeShare installer from the main README. It installs the CLI and, when the `code` or `code-insiders` command is available, the VS Code extension too. You can also choose **Install ChangeShare** when prompted by the extension to install the CLI.
2. Open a Git project in VS Code and select the **ChangeShare** icon in the Activity Bar.
3. Use the sidebar lists:
   - **Working Changes** lists modified, added, deleted, and untracked files. Select one or more files and use **Share Selected**, or use **Share All**.
   - **Stashes** lists the project's stashes. Use the send action beside a stash to share it.
   - **Recent Commits** lists recent commits. Use the send action beside a commit to share its changes as uncommitted edits on the receiver.
   - **Actions** provides Receive Changes, Undo Last Transfer, LAN diagnostics, and project selection.
4. Choose whether to preview a send or receive, or run a receive dry run. Confirmations and sender selection appear in VS Code dialogs; command progress and patch details appear in the **ChangeShare** Output channel. Transfers do not require the integrated terminal or Command Palette.

The **Undo Last Transfer** command asks for confirmation before reversing the latest transfer. The status bar shows while a ChangeShare command is running in the background. Configure `changeshare.defaultPort` in VS Code settings if your LAN uses a different port.

Working Changes and Recent Commits use VS Code's Git extension events and a
short debounce. Stashes refresh from Git state events, with a 30-second fallback
check only while the Stashes view is visible because the public Git API has no
stash-list event. You can also run **ChangeShare: Refresh Lists** from the
Command Palette.

Transfers remain direct between computers on the same LAN. No ChangeShare server is involved. The extension currently targets Linux, matching the available CLI binaries.

## Develop locally

Open this folder in VS Code and press `F5` to launch an Extension Development
Host. This runs the extension in a separate VS Code window, so you can try
changes without replacing your installed copy.

To build an installable VSIX package, run:

```sh
npm run package
```

Install the generated `.vsix` with **Extensions: Install from VSIX...** in VS
Code. To install it from a terminal, use the exact filename printed by the
package command, for example:

```sh
code --install-extension changeshare-vscode-0.1.8.vsix
```

## Code map

- `extension.js` creates the sidebar views, handles commands and dialogs, and
  starts the ChangeShare CLI as a child process.
- `package.json` declares the extension name, activation events, commands,
  sidebar views, settings, and packaging script.
- `resources/changeshare.svg` is the Activity Bar icon.

The extension reads Git status, stashes, and commits for the sidebar. The CLI
does the actual patch creation, safety checks, LAN discovery, and transfer.

## Release distribution

The VS Code extension is distributed as a VSIX attached to the project's
GitHub Releases; it is not published to the Visual Studio Marketplace. The
root release workflow packages the extension and attaches it alongside the
CLI binaries. See the main [README](../README.md#publish-a-github-release) for
the release steps. Users can install both the CLI and extension with the
single `curl` command there.
