# ChangeShare for VS Code

This desktop extension adds guided commands to VS Code while the existing ChangeShare CLI continues to handle Git patches and LAN transfers.

## Use it

1. Install the ChangeShare CLI, or choose **Install ChangeShare** when prompted by the extension.
2. Open a Git project in VS Code.
3. Open the Command Palette (`Ctrl+Shift+P`) and choose one of:
   - **ChangeShare: Share Changes** — share current changes or choose a stash.
   - **ChangeShare: Receive Changes** — enter the sender's code.
   - **ChangeShare: Undo Last Transfer** — undo the latest received transfer.
   - **ChangeShare: Check LAN Connection** — run the CLI diagnostics.
4. Follow the prompts in the integrated terminal. It shows the sender approval, file review, secret checks, apply confirmation, and any Git conflict details.

Transfers remain direct between computers on the same LAN. No ChangeShare server is involved. The extension currently targets Linux, matching the available CLI binaries.

## Develop locally

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Run `npm run package` to create a `.vsix` package. Install it with **Extensions: Install from VSIX...** or `code --install-extension changeshare-vscode-0.1.0.vsix`.

## Publish

Create a publisher in the Visual Studio Marketplace, set the matching publisher ID in `package.json`, then package and publish with Microsoft's `vsce` tool. Marketplace publishing credentials must be kept outside the repository.
