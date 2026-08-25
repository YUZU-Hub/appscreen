#!/usr/bin/env bash
# One-command setup: build the server and register it with Claude Code.
#
#   ./setup.sh           # local (stdio) — recommended for Claude Code / Desktop
#   ./setup.sh docker    # build the image and register the HTTP server
#
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-local}"

have() { command -v "$1" >/dev/null 2>&1; }

if [ "$MODE" = "docker" ]; then
  echo "▸ Building Docker image and starting the HTTP server…"
  docker compose up -d --build
  URL="http://localhost:3000/mcp"
  if have claude; then
    claude mcp add --transport http appscreen "$URL" || true
    echo "✓ Registered 'appscreen' (HTTP) with Claude Code → $URL"
  else
    echo "Claude CLI not found. Register manually:"
    echo "  claude mcp add --transport http appscreen $URL"
  fi
  exit 0
fi

echo "▸ Installing dependencies and building…"
npm install   # the 'prepare' script compiles TypeScript into dist/

DIST="$(pwd)/dist/server.js"
if have claude; then
  claude mcp add appscreen -- node "$DIST" || true
  echo "✓ Registered 'appscreen' (stdio) with Claude Code."
  echo "  Try:  claude mcp list"
else
  echo "Claude CLI not found. Register manually:"
  echo "  claude mcp add appscreen -- node \"$DIST\""
  echo "Or for Claude Desktop, add to claude_desktop_config.json:"
  echo "  { \"mcpServers\": { \"appscreen\": { \"command\": \"node\", \"args\": [\"$DIST\"] } } }"
fi
