#!/usr/bin/env bash
set -euo pipefail

REPO="AyushPandey510/changeshare"
INSTALL_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/lib/changeshare"
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
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or later is required. Install Node.js, then rerun this installer." >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "Node.js 22 or later is required; found $(node --version). Upgrade Node.js, then rerun this installer." >&2
  exit 1
fi
if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required to unpack the ChangeShare CLI package." >&2
  exit 1
fi
echo "Found curl and Git."
echo "Found Node.js $(node --version)."

echo "Preparing install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

download_asset() {
  local url="$1"
  local destination="$2"
  local attempt=1
  local curl_status
  local http_status

  if [ ! -e "$destination" ]; then
    : > "$destination"
  fi

  while [ "$attempt" -le 5 ]; do
    if http_status="$(curl --fail --location --show-error --progress-bar \
      --http1.1 --connect-timeout 15 --continue-at - \
      --output "$destination" --write-out '%{http_code}' "$url")"; then
      return 0
    else
      curl_status=$?
    fi

    # An HTTP error is definitive for this URL. Network errors are retried
    # below, preserving the partial file for the next range request.
    if [ "$curl_status" -eq 22 ]; then
      echo "Release asset request failed with HTTP ${http_status:-unknown}." >&2
      return "$curl_status"
    fi

    if [ "$attempt" -eq 5 ]; then
      echo "Download failed after $attempt attempts (curl $curl_status, HTTP ${http_status:-unknown})." >&2
      return "$curl_status"
    fi

    attempt=$((attempt + 1))
    echo "Download interrupted; retrying from the last byte (attempt $attempt of 5)..." >&2
    sleep "$attempt"
  done
}

echo "Downloading the ChangeShare CLI..."
PACKAGE_DIR="$TMP_DIR/changeshare"
mkdir -p "$PACKAGE_DIR"
download_asset "$RELEASE_URL/changeshare-node.tar.gz" "$TMP_DIR/changeshare-node.tar.gz"
tar -xzf "$TMP_DIR/changeshare-node.tar.gz" -C "$PACKAGE_DIR"
echo "Installing the CLI package to $APP_DIR..."
mkdir -p "$APP_DIR"
cp -a "$PACKAGE_DIR/." "$APP_DIR/"
cat > "$INSTALL_DIR/changeshare" <<'WRAPPER'
#!/usr/bin/env bash
exec node "${HOME}/.local/lib/changeshare/dist/cli.js" "$@"
WRAPPER
chmod 755 "$INSTALL_DIR/changeshare"
echo "Installed the changeshare command at $INSTALL_DIR/changeshare."

VSCODE_CLI=""
if command -v code >/dev/null 2>&1; then
  VSCODE_CLI="$(command -v code)"
elif command -v code-insiders >/dev/null 2>&1; then
  VSCODE_CLI="$(command -v code-insiders)"
fi

if [ -n "$VSCODE_CLI" ]; then
  echo "Found VS Code command: $VSCODE_CLI"
  echo "Downloading the ChangeShare VS Code extension..."
  if download_asset "$RELEASE_URL/changeshare-vscode.vsix" "$TMP_DIR/changeshare-vscode.vsix"; then
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
