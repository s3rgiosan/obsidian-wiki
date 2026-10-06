#!/usr/bin/env bash
# Register brain_fill_host.py as a Chrome native messaging host.
#
# Everything the host needs is staged under ~/.obsidian-wiki/brain-fill/ rather
# than run from the repo checkout. That is not tidiness: on macOS ~/Documents is
# TCC-protected (mode 700 + ACL), and a Chrome-launched host inherits Chrome's
# TCC context, so it cannot traverse into a checkout living there. Chrome
# reports that as the same opaque "Native host has exited" you get from a crash.
#
# The staged copy also fixes two smaller versions of the same problem: the host
# gets a private, current copy of the pure-stdlib obsidian_wiki package (the
# system-wide installs can be older and lack context-pack), and it gets the
# caller's PATH baked in, because Chrome hands its children a minimal PATH that
# does not include ~/.local/bin where claude and codex usually live.
set -euo pipefail

HOST_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HOST_SRC_DIR/../../.." && pwd)"
EXT_DIR="$(cd "$HOST_SRC_DIR/.." && pwd)"
HOST_NAME="com.obsidian_wiki.brain_fill"
# The unpacked build has a stable ID courtesy of the fixed `key` in
# manifest.json. A Web Store listing is assigned a different one, so allow
# it to be passed in:  install.sh <extension-id>
EXT_ID="${1:-$(cat "$HOST_SRC_DIR/extension_id.txt")}"

STAGE_DIR="$HOME/.obsidian-wiki/brain-fill"
LIB_DIR="$STAGE_DIR/lib"
LAUNCHER="$STAGE_DIR/run-host.sh"

case "$(uname -s)" in
  Darwin)
    TARGETS=(
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
      "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    ) ;;
  Linux)
    TARGETS=(
      "$HOME/.config/google-chrome/NativeMessagingHosts"
      "$HOME/.config/chromium/NativeMessagingHosts"
    ) ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1 ;;
esac

# ── stage the host and its library ──────────────────────────────────────────
mkdir -p "$LIB_DIR"
cp "$HOST_SRC_DIR/brain_fill_host.py" "$STAGE_DIR/brain_fill_host.py"
chmod +x "$STAGE_DIR/brain_fill_host.py"

PYTHON_BIN="$(command -v python3)"

# Two ways to get here: a git checkout (stage a copy of the package, so the
# host keeps working even if the checkout later moves into a TCC-protected
# folder), or an installed wheel that already contains this file, in which case
# the package is importable and needs no staging.
if [ -d "$REPO_DIR/obsidian_wiki" ]; then
  rm -rf "$LIB_DIR/obsidian_wiki"
  cp -R "$REPO_DIR/obsidian_wiki" "$LIB_DIR/obsidian_wiki"
  find "$LIB_DIR/obsidian_wiki" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
  PY_PATH="$LIB_DIR"
  echo "staged obsidian_wiki package -> $LIB_DIR/obsidian_wiki"
elif "$PYTHON_BIN" -c 'import obsidian_wiki' 2>/dev/null; then
  PY_PATH=""
  echo "using installed obsidian_wiki package"
else
  echo "error: no obsidian_wiki package found (no checkout, not importable)" >&2
  exit 1
fi

# Verify context-pack support before Chrome finds out the hard way.
if ! PYTHONPATH="$PY_PATH" "$PYTHON_BIN" -m obsidian_wiki --help 2>/dev/null | grep -q context-pack; then
  echo "error: this obsidian_wiki does not support context-pack; upgrade it" >&2
  exit 1
fi

# ── launcher ────────────────────────────────────────────────────────────────
# Chrome execs this directly with no shell profile, so the interpreter, the
# library path and the PATH all have to be absolute and baked in now.
#
# USER/LOGNAME matter more than they look: Claude Code keeps its OAuth
# credentials in the macOS login Keychain and needs those to resolve them.
# Without them it fails with "Not logged in · Please run /login" even though
# the user is perfectly well logged in.
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
${PY_PATH:+export PYTHONPATH="$PY_PATH\${PYTHONPATH:+:\$PYTHONPATH}"}
export PATH="$PATH"
export HOME="\${HOME:-$HOME}"
export USER="\${USER:-$(id -un)}"
export LOGNAME="\${LOGNAME:-$(id -un)}"
export SHELL="\${SHELL:-$SHELL}"
exec "$PYTHON_BIN" "$STAGE_DIR/brain_fill_host.py" "\$@"
EOF
chmod +x "$LAUNCHER"

# ── register ────────────────────────────────────────────────────────────────
MANIFEST="$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "Obsidian Wiki Brain Fill native host",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF
)"

INSTALLED=0
for TARGET in "${TARGETS[@]}"; do
  [ -d "$(dirname "$TARGET")" ] || continue
  mkdir -p "$TARGET"
  printf '%s\n' "$MANIFEST" > "$TARGET/$HOST_NAME.json"
  echo "registered: $TARGET/$HOST_NAME.json"
  INSTALLED=1
done

if [ "$INSTALLED" -eq 0 ]; then
  echo "No Chromium-family browser profile found." >&2
  exit 1
fi

echo
echo "Host staged at: $LAUNCHER"
echo "Extension ID:   $EXT_ID"
echo
echo "Load as unpacked extension: $EXT_DIR"
echo "Re-run after changing brain_fill_host.py or the obsidian_wiki package."
