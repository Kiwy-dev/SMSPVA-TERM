#!/bin/bash
# Genera SMSPVA.app (lanzador de macOS) en la raíz del proyecto.
# Uso: bash packaging/build-app.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
APP="$ROOT/SMSPVA.app"
ICON_SRC="$HERE/smspva-icon.png"
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json" 2>/dev/null || echo 0.0.0)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# --- Icono (.icns) a partir del PNG ---
ICONSET="$(mktemp -d)/smspva.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/smspva.icns"
rm -rf "$(dirname "$ICONSET")"

# --- Info.plist ---
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>SMSPVA</string>
  <key>CFBundleDisplayName</key><string>SMSPVA</string>
  <key>CFBundleIdentifier</key><string>dev.kiwy.smspva-term</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>SMSPVA</string>
  <key>CFBundleIconFile</key><string>smspva</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# --- Ejecutable: arranca el servidor del proyecto que contiene la .app ---
cat > "$APP/Contents/MacOS/SMSPVA" <<'LAUNCHER'
#!/bin/bash
set -uo pipefail

# La carpeta del proyecto es la que contiene SMSPVA.app (sin rutas fijas).
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(dirname "$BUNDLE")"
LOG_DIR="$HOME/Library/Logs"
LOG="$LOG_DIR/SMSPVA-TERM.log"
mkdir -p "$LOG_DIR"

alerta() {
  osascript -e "display alert \"SMSPVA\" message \"$1\" as critical" >/dev/null 2>&1
}

# Las apps abiertas desde Finder no heredan el PATH de la terminal:
# se busca Node en las rutas de Homebrew y luego en el shell de login (nvm, fnm, etc.).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$("${SHELL:-/bin/zsh}" -lic 'command -v node' 2>/dev/null | tail -n 1 || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  alerta "Falta Node.js 22 o posterior. Instálalo desde nodejs.org o con: brew install node"
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  alerta "Se requiere Node.js 22 o posterior (detectado: $("$NODE_BIN" -v))."
  exit 1
fi

if [ ! -f "$ROOT/server/server.js" ]; then
  alerta "No encuentro server/server.js junto a SMSPVA.app. Deja la app dentro de la carpeta del proyecto."
  exit 1
fi

cd "$ROOT"
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') inicio ($("$NODE_BIN" -v)) ==="
  if [ ! -d node_modules ]; then
    echo "Instalando dependencias..."
    npm install || { alerta "Falló npm install. Revisa $LOG"; exit 1; }
  fi
  if [ ! -d ui-dist ]; then
    echo "Compilando interfaz..."
    npm run build:ui || { alerta "Falló la compilación de la interfaz. Revisa $LOG"; exit 1; }
  fi
} >>"$LOG" 2>&1 || exit 1

# Cierra una instancia previa de este mismo proyecto antes de abrir otra.
pkill -f "$ROOT/server/server.js" 2>/dev/null || true

# El servidor abre la ventana. Al salir de la app desde el Dock, macOS manda
# SIGTERM y el servidor limpia su sesión.
exec "$NODE_BIN" "$ROOT/server/server.js" >>"$LOG" 2>&1
LAUNCHER
chmod +x "$APP/Contents/MacOS/SMSPVA"

# Firma local (ad hoc) para que Gatekeeper no la marque como dañada.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "Listo: $APP"
