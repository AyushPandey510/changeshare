# ChangeShare for VS Code

This desktop extension adds guided commands to VS Code while the existing ChangeShare CLI continues to handle Git patches and LAN transfers.

## Use it

1. Run the ChangeShare installer from the main README. It installs the CLI and, when the `code` or `code-insiders` command is available, the VS Code extension too. You can also choose **Install ChangeShare** when prompted by the extension to install the CLI.
2. Open a Git project in VS Code.
3. Open the Command Palette (`Ctrl+Shift+P`) and choose one of:
   - **ChangeShare: Share Changes** — share current changes or choose a stash.
   - **ChangeShare: Receive Changes** — enter the sender's code.
   - **ChangeShare: Undo Last Transfer** — undo the latest received transfer.
   - **ChangeShare: Check LAN Connection** — run the CLI diagnostics.
4. Choose whether to preview a send or receive, or run a receive dry run. Follow the prompts in the integrated terminal. It shows sender approval, file review, secret checks, apply confirmation, and any Git conflict details.

The **Undo Last Transfer** command asks for confirmation before reversing the latest transfer. The status bar shows when a ChangeShare terminal is open. Configure `changeshare.defaultPort` in VS Code settings if your LAN uses a different port.

Transfers remain direct between computers on the same LAN. No ChangeShare server is involved. The extension currently targets Linux, matching the available CLI binaries.

## Develop locally

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Run `npm run package` to create a `.vsix` package. Install it with **Extensions: Install from VSIX...** or `code --install-extension changeshare-vscode-0.1.0.vsix`.

## Release distribution

The VS Code extension is distributed as a VSIX attached to the project's GitHub Releases; it is not published to the Visual Studio Marketplace. The root release workflow packages the extension and attaches it alongside the CLI binaries. See the main [README](../README.md#publish-a-github-release) for the release steps. Users can install both the CLI and extension with the single `curl` command there.
