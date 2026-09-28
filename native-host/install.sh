#!/usr/bin/env bash
# Installs the MantisAI helper, which lets the Mantis Quick Standup extension
# chat through your locally installed Claude CLI (Chrome "native messaging").
#
#   bash install.sh <extension-id>     install, or add another extension id
#   bash install.sh --uninstall        remove the helper and its registrations
#
# The toolbar popup (Settings → MantisAI) offers this script as a download with
# the extension id and the helper already filled in. Linux and macOS only.
# Needs Node.js 18+ and Claude Code (`claude`), logged in.

set -euo pipefail

HOST_NAME="com.webmavens.mantis_ai"
EXT_ID="${1:-__EXTENSION_ID__}"

if [[ "$(uname)" == "Darwin" ]]; then
  DATA_DIR="$HOME/Library/Application Support/MantisAI"
  BROWSER_DIRS=(
    "$HOME/Library/Application Support/Google/Chrome"
    "$HOME/Library/Application Support/Google/Chrome Beta"
    "$HOME/Library/Application Support/Chromium"
    "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
    "$HOME/Library/Application Support/Microsoft Edge"
  )
else
  DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/mantis-ai"
  CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
  BROWSER_DIRS=(
    "$CONFIG/google-chrome"
    "$CONFIG/google-chrome-beta"
    "$CONFIG/chromium"
    "$CONFIG/BraveSoftware/Brave-Browser"
    "$CONFIG/microsoft-edge"
  )
fi

die() { echo "MantisAI: $*" >&2; exit 1; }

if [[ "$EXT_ID" == "--uninstall" ]]; then
  for dir in "${BROWSER_DIRS[@]}"; do rm -f "$dir/NativeMessagingHosts/$HOST_NAME.json"; done
  rm -rf "$DATA_DIR"
  echo "MantisAI helper removed. (Claude's own chat history is kept.)"
  exit 0
fi

[[ "$EXT_ID" =~ ^[a-p]{32}$ ]] || die "pass the extension id, e.g. bash install.sh abcdefghijklmnopabcdefghijklmnop (see chrome://extensions)."

NODE="$(command -v node || true)"
[[ -n "$NODE" ]] || die "Node.js 18 or newer is needed (https://nodejs.org)."
"$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || die "Node.js 18 or newer is needed; found $("$NODE" --version)."

CLAUDE="$(command -v claude || true)"
for guess in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do
  [[ -z "$CLAUDE" && -x "$guess" ]] && CLAUDE="$guess"
done
[[ -n "$CLAUDE" ]] || die "the Claude CLI (claude) was not found. Install Claude Code and log in first."

mkdir -p "$DATA_DIR/workspace"

# The helper sits next to this script in the repo; the popup's download carries it below the marker.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/mantis-ai-host.mjs" ]]; then
  cp "$SCRIPT_DIR/mantis-ai-host.mjs" "$DATA_DIR/mantis-ai-host.mjs"
elif grep -q '^__MANTIS_AI_HOST__$' "$0"; then
  sed '1,/^__MANTIS_AI_HOST__$/d' "$0" > "$DATA_DIR/mantis-ai-host.mjs"
else
  die "mantis-ai-host.mjs not found next to this script."
fi

# Chrome starts native hosts with a minimal environment, so pin node and claude.
WRAPPER="$DATA_DIR/mantis-ai-host"
cat > "$WRAPPER" <<EOF
#!/bin/sh
export PATH="$(dirname "$NODE"):$(dirname "$CLAUDE"):\$PATH"
export MANTIS_AI_CLAUDE="$CLAUDE"
export MANTIS_AI_HOME="$DATA_DIR"
exec "$NODE" "$DATA_DIR/mantis-ai-host.mjs" "\$@"
EOF
chmod 755 "$WRAPPER"

# Register with every installed Chromium-based browser (Chrome if none is found),
# keeping extension ids registered earlier (e.g. a dev build and the store build).
TARGETS=()
for dir in "${BROWSER_DIRS[@]}"; do [[ -d "$dir" ]] && TARGETS+=("$dir"); done
[[ ${#TARGETS[@]} -gt 0 ]] || TARGETS=("${BROWSER_DIRS[0]}")
for dir in "${TARGETS[@]}"; do
  (
    mkdir -p "$dir/NativeMessagingHosts"
    "$NODE" - "$dir/NativeMessagingHosts/$HOST_NAME.json" "$WRAPPER" "chrome-extension://$EXT_ID/" <<'EOF'
const fs = require('fs');
const [file, wrapper, origin] = process.argv.slice(2);
let origins = [];
try { origins = JSON.parse(fs.readFileSync(file, 'utf8')).allowed_origins || []; } catch {}
fs.writeFileSync(file, JSON.stringify({
  name: 'com.webmavens.mantis_ai',
  description: 'MantisAI: chat through the local Claude CLI',
  path: wrapper,
  type: 'stdio',
  allowed_origins: [...new Set([...origins, origin])],
}, null, 2) + '\n');
EOF
    echo "Registered for ${dir##*/}"
  )
done

echo "Claude CLI: $CLAUDE ($("$CLAUDE" --version 2>/dev/null || echo 'version unknown'))"
echo "MantisAI helper installed. In the extension popup, open Settings → MantisAI and click Check."
exit 0

# Anything below this line is the helper itself (added by the popup's download).
