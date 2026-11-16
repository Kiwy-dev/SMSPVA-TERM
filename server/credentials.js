// Rutas locales y manejo de archivos privados (credenciales .env y datos JSON).
// Nada está fijo a un usuario o máquina: todo se calcula desde el sistema
// operativo y puede sobrescribirse con variables de entorno.
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const APP_NAME = 'SMSPVA-TERM';

function fromEnv(name) {
  const value = String(process.env[name] || '').trim();
  return value ? path.resolve(value.replace(/^~(?=$|[\\/])/, os.homedir())) : '';
}

// Carpeta de credenciales compartida: ~/.credentials (o SMSPVA_CREDENTIALS_DIR).
export function defaultCredentialsDir() {
  return fromEnv('SMSPVA_CREDENTIALS_DIR') || path.join(os.homedir(), '.credentials');
}

// Carpeta de datos de la app según la convención de cada sistema (o SMSPVA_DATA_DIR).
export function defaultDataDir() {
  const override = fromEnv('SMSPVA_DATA_DIR');
  if (override) return override;
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_NAME);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_NAME);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), APP_NAME);
}

// Escribe un archivo legible solo por el usuario (600, carpeta 700).
// Escritura atómica: primero a un temporal y luego rename.
export async function writePrivateFile(filePath, content) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  if (process.platform !== 'win32') {
    await chmod(filePath, 0o600).catch(() => {});
  }
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
  if (!match) return null;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key: match[1], value };
}

// Lee una clave de un archivo .env. Devuelve '' si el archivo o la clave no existen.
export async function readEnvKey(filePath, key) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed && parsed.key === key) return parsed.value.trim();
  }
  return '';
}

// Guarda (o reemplaza) una clave en un .env conservando las demás líneas.
// Con valor vacío la elimina; si el archivo queda sin claves, lo borra.
export async function writeEnvKey(filePath, key, value) {
  const clean = String(value ?? '').replace(/[\r\n]/g, '').trim();
  let lines = [];
  try {
    lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const kept = lines.filter((line) => parseLine(line)?.key !== key);
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  if (clean) kept.push(`${key}=${clean}`);

  if (!kept.some((line) => parseLine(line))) {
    await unlink(filePath).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    return;
  }
  await writePrivateFile(filePath, `${kept.join('\n')}\n`);
}
