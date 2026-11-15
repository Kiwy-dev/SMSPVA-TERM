#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Falta Node.js 22 o posterior. Instala Node.js desde https://nodejs.org/ o con Homebrew (brew install node)."
  read -r -p "Presiona Enter para cerrar..."
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Se requiere Node.js >= 22 (detectado: $("$NODE_BIN" -v))."
  read -r -p "Presiona Enter para cerrar..."
  exit 1
fi

cd "$ROOT"

if [ ! -d "$ROOT/node_modules" ]; then
  echo "Instalando dependencias (npm install)..."
  npm install
fi

if [ ! -d "$ROOT/ui-dist" ]; then
  echo "Compilando interfaz (npm run build:ui)..."
  npm run build:ui
fi

if [ "${1:-}" = "--check-only" ]; then
  echo "Node.js $("$NODE_BIN" -v) listo."
  exit 0
fi

pkill -f "$ROOT/server/server.js" 2>/dev/null || true
exec "$NODE_BIN" "$ROOT/server/server.js"
