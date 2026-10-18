#!/usr/bin/env bash
set -euo pipefail

REPO="AyushPandey510/changeshare"
INSTALL_DIR="${HOME}/.local/bin"
RELEASE_URL="https://github.com/${REPO}/releases/latest/download"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download changeshare." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) ASSET="changeshare-linux-x64" ;;
  aarch64|arm64) ASSET="changeshare-linux-arm64" ;;
  *) echo "Unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$INSTALL_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl --fail --location --show-error --progress-bar --retry 3 \
  "$RELEASE_URL/$ASSET" --output "$TMP_DIR/$ASSET"
install -m 755 "$TMP_DIR/$ASSET" "$INSTALL_DIR/changeshare"

VSCODE_CLI=""
if command -v code >/dev/null 2>&1; then
  VSCODE_CLI="$(command -v code)"
elif command -v code-insiders >/dev/null 2>&1; then
  VSCODE_CLI="$(command -v code-insiders)"
fi

if [ -n "$VSCODE_CLI" ]; then
  if curl --fail --location --show-error --progress-bar --retry 3 \
    "$RELEASE_URL/changeshare-vscode.vsix" --output "$TMP_DIR/changeshare-vscode.vsix"; then
    if "$VSCODE_CLI" --install-extension "$TMP_DIR/changeshare-vscode.vsix" --force; then
      echo "Installed the ChangeShare VS Code extension."
    else
      echo "Warning: the CLI was installed, but VS Code could not install the extension." >&2
    fi
  else
    echo "Warning: the CLI was installed, but the latest release has no VS Code extension asset." >&2
  fi
else
  echo "VS Code CLI not found; installed the ChangeShare CLI only. Install VS Code's 'code' command on PATH and rerun this installer to add the extension."
fi

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    RC_FILE=""
    if [ -n "${ZSH_VERSION:-}" ] || [ "${SHELL##*/}" = "zsh" ]; then
      RC_FILE="$HOME/.zshrc"
    elif [ -n "${BASH_VERSION:-}" ] || [ "${SHELL##*/}" = "bash" ]; then
      RC_FILE="$HOME/.bashrc"
    fi
    if [ -n "$RC_FILE" ]; then
      LINE='export PATH="$HOME/.local/bin:$PATH"'
      touch "$RC_FILE"
      grep -Fqx "$LINE" "$RC_FILE" || printf '\n%s\n' "$LINE" >> "$RC_FILE"
      echo "Added $INSTALL_DIR to PATH in $RC_FILE. Restart your terminal or run: source $RC_FILE"
    else
      echo "Add $INSTALL_DIR to your PATH to run 'changeshare' without its full path." >&2
    fi
    ;;
esac

echo "Installed changeshare to $INSTALL_DIR/changeshare"
"$INSTALL_DIR/changeshare" --version
