#!/usr/bin/env bash
set -euo pipefail

REPO="AyushPandey510/changeshare"
INSTALL_DIR="${HOME}/.local/bin"
RELEASE_URL="https://github.com/${REPO}/releases/latest/download"

echo "ChangeShare installer"
echo "Checking required commands..."
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download changeshare." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "Git is required to use changeshare. Install Git, then rerun this installer." >&2
  exit 1
fi
if ! command -v gzip >/dev/null 2>&1; then
  echo "gzip is required to unpack the ChangeShare CLI. Install gzip, then rerun this installer." >&2
  exit 1
fi
echo "Found curl and Git."

ARCH="$(uname -m)"
echo "Detecting Linux architecture: $ARCH"
case "$ARCH" in
  x86_64|amd64) ASSET="changeshare-linux-x64" ;;
  aarch64|arm64) ASSET="changeshare-linux-arm64" ;;
  *) echo "Unsupported CPU architecture: $ARCH" >&2; exit 1 ;;
esac
echo "Selected release binary: $ASSET"

echo "Preparing install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading the ChangeShare CLI..."
if curl --fail --location --show-error --progress-bar --retry 3 \
  "$RELEASE_URL/$ASSET.gz" --output "$TMP_DIR/$ASSET.gz"; then
  echo "Unpacking the compressed CLI..."
  gzip -t "$TMP_DIR/$ASSET.gz"
  gzip -dc "$TMP_DIR/$ASSET.gz" > "$TMP_DIR/$ASSET"
else
  # Older releases published only the uncompressed asset. Keep those
  # releases installable while new tags gain the smaller compressed asset.
  echo "Compressed asset unavailable; trying the legacy CLI download..."
  curl --fail --location --show-error --progress-bar --retry 3 \
    "$RELEASE_URL/$ASSET" --output "$TMP_DIR/$ASSET"
fi
echo "Installing the CLI to $INSTALL_DIR/changeshare..."
install -m 755 "$TMP_DIR/$ASSET" "$INSTALL_DIR/changeshare"
echo "CLI installed."

VSCODE_CLI=""
if command -v code >/dev/null 2>&1; then
  VSCODE_CLI="$(command -v code)"
elif command -v code-insiders >/dev/null 2>&1; then
  VSCODE_CLI="$(command -v code-insiders)"
fi

if [ -n "$VSCODE_CLI" ]; then
  echo "Found VS Code command: $VSCODE_CLI"
  echo "Downloading the ChangeShare VS Code extension..."
  if curl --fail --location --show-error --progress-bar --retry 3 \
    "$RELEASE_URL/changeshare-vscode.vsix" --output "$TMP_DIR/changeshare-vscode.vsix"; then
    echo "Installing the VS Code extension..."
    if "$VSCODE_CLI" --install-extension "$TMP_DIR/changeshare-vscode.vsix" --force; then
      echo "Installed the ChangeShare VS Code extension."
    else
      echo "Warning: the CLI was installed, but VS Code could not install the extension." >&2
    fi
  else
    echo "Warning: the CLI was installed, but the latest release has no VS Code extension asset." >&2
  fi
else
  echo "VS Code command not found; skipping extension installation."
  echo "VS Code CLI not found; installed the ChangeShare CLI only. Install VS Code's 'code' command on PATH and rerun this installer to add the extension."
fi

echo "Checking whether $INSTALL_DIR is on PATH..."
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) echo "$INSTALL_DIR is already on PATH." ;;
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

echo "Verifying the ChangeShare CLI installation..."
"$INSTALL_DIR/changeshare" --version
echo "Setup complete."
