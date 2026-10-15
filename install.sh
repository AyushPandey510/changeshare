#!/usr/bin/env bash
set -euo pipefail

REPO="ayushpandey-ops/changeshare"
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
