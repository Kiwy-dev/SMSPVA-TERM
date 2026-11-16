import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const execFileAsync = promisify(execFile);

const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_SYMBOLS = '!@#$%&*';
const PASSWORD_ALL = PASSWORD_LOWER + PASSWORD_UPPER + PASSWORD_DIGITS + PASSWORD_SYMBOLS;

export function generatePassword(length = 12) {
  const targetLen = Math.max(8, Number(length) || 12);
  const chars = [
    PASSWORD_LOWER[randomInt(PASSWORD_LOWER.length)],
    PASSWORD_UPPER[randomInt(PASSWORD_UPPER.length)],
    PASSWORD_DIGITS[randomInt(PASSWORD_DIGITS.length)],
    PASSWORD_SYMBOLS[randomInt(PASSWORD_SYMBOLS.length)],
  ];
  while (chars.length < targetLen) {
    chars.push(PASSWORD_ALL[randomInt(PASSWORD_ALL.length)]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function generateBirthdate(minYear = 1991, maxYear = 2004) {
  const year = randomInt(minYear, maxYear + 1);
  const month = randomInt(1, 13);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = randomInt(1, daysInMonth + 1);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

// --- Lector/escritor ZIP mínimo (sin dependencias externas) ---

function readZipEntries(buf) {
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('El archivo no es un .xlsx válido (ZIP inválido).');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error('Estructura ZIP corrupta en directorio central.');
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Encabezado local inválido para ${name}.`);
    }
    const lNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const rawData = buf.subarray(dataStart, dataStart + compressedSize);

    let content;
    if (method === 0) {
      content = Buffer.from(rawData);
    } else if (method === 8) {
      content = inflateRawSync(rawData);
    } else {
      throw new Error(`Método de compresión ZIP no soportado (${method}) en ${name}.`);
    }
    entries.set(name, content);
  }
  return entries;
}

function writeZipEntries(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const [name, dataBuf] of entries.entries()) {
    const nameBuf = Buffer.from(name, 'utf8');
    const uncompressed = Buffer.isBuffer(dataBuf) ? dataBuf : Buffer.from(dataBuf, 'utf8');
    const compressed = deflateRawSync(uncompressed);
    const crc = crc32(uncompressed) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x5421, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

// --- Utilidades XML / XLSX ---

function xmlEscape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(str) {
  return String(str ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function colToIndex(col) {
  let num = 0;
  for (const ch of col.toUpperCase()) {
    num = num * 26 + (ch.charCodeAt(0) - 64);
  }
  return num;
}

function indexToCol(num) {
  let n = num;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const items = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xmlText)) !== null) {
    const inner = m[1];
    const texts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(inner)) !== null) {
      texts.push(xmlUnescape(tm[1]));
    }
    items.push(texts.join(''));
  }
  return items;
}

function extractCellValue(cellXml, sharedStrings) {
  const tMatch = /\bt="([^"]+)"/.exec(cellXml);
  const type = tMatch ? tMatch[1] : '';
  if (type === 'inlineStr') {
    const tMatchInner = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(cellXml);
    return tMatchInner ? xmlUnescape(tMatchInner[1]).trim() : '';
  }
  const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellXml);
  if (!vMatch) return '';
  const raw = vMatch[1];
  if (type === 's') {
    const idx = Number(raw);
    return Number.isInteger(idx) && sharedStrings[idx] !== undefined ? String(sharedStrings[idx]).trim() : '';
  }
  return xmlUnescape(raw).trim();
}

function parseRows(sheetXml, sharedStrings) {
  const rows = new Map();
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(sheetXml)) !== null) {
    const rAttr = /\br="(\d+)"/.exec(rm[1]);
    if (!rAttr) continue;
    const rowNum = Number(rAttr[1]);
    const cells = new Map();
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[2])) !== null) {
      const refAttr = /\br="([A-Za-z]+\d+)"/.exec(cm[1]);
      if (!refAttr) continue;
      const col = refAttr[1].replace(/\d+$/, '').toUpperCase();
      const fullCell = cm[0];
      const value = extractCellValue(fullCell, sharedStrings);
      cells.set(col, { col, ref: refAttr[1], xml: fullCell, value });
    }
    rows.set(rowNum, { rowNum, attrs: rm[1], cells, fullXml: rm[0] });
  }
  return rows;
}

function buildCellXml({ ref, value, sharedIndex = null, styleId = null }) {
  const sAttr = styleId !== null ? ` s="${styleId}"` : '';
  if (sharedIndex !== null) {
    return `<c r="${ref}"${sAttr} t="s"><v>${sharedIndex}</v></c>`;
  }
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function updateRangeRef(refStr, targetRow, maxColIdx) {
  const m = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(String(refStr || '').trim());
  if (!m) return refStr;
  const startCol = m[1].toUpperCase();
  const startRow = Number(m[2]);
  const endColIdx = Math.max(colToIndex(m[3]), maxColIdx);
  const endRow = Math.max(Number(m[4]), targetRow);
  return `${startCol}${startRow}:${indexToCol(endColIdx)}${endRow}`;
}

async function writeFileAtomic(filePath, buffer) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, buffer);
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function createWorkbookFile(rawPath, { seedNames = [] } = {}) {
  const filePath = ensureXlsxExtension(rawPath);
  const entries = new Map();
  const names = Array.isArray(seedNames) ? seedNames.map((n) => String(n || '').trim()).filter(Boolean) : [];
  const hasNames = names.length > 0;
  const colCount = hasNames ? 5 : 4;
  const lastCol = hasNames ? 'E' : 'D';
  const lastRow = 1 + names.length;
  const fullRef = `A1:${lastCol}${lastRow}`;

  entries.set(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
        '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>' +
        '</Types>',
      'utf8',
    ),
  );

  entries.set(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
      'utf8',
    ),
  );

  entries.set(
    'xl/workbook.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>',
      'utf8',
    ),
  );

  entries.set(
    'xl/_rels/workbook.xml.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
        '</Relationships>',
      'utf8',
    ),
  );

  entries.set(
    'xl/styles.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '</styleSheet>',
      'utf8',
    ),
  );

  const ssItems = hasNames
    ? ['Correo', 'Contraseña', 'Red', 'Nombre', 'Fecha de nacimiento', ...names]
    : ['Correo', 'Contraseña', 'Red', 'Fecha de nacimiento'];
  entries.set(
    'xl/sharedStrings.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ssItems.length}" uniqueCount="${ssItems.length}">` +
        ssItems.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join('') +
        '</sst>',
      'utf8',
    ),
  );

  entries.set(
    'xl/worksheets/_rels/sheet1.xml.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>' +
        '</Relationships>',
      'utf8',
    ),
  );

  entries.set(
    'xl/tables/table1.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Cuentas" displayName="Cuentas" ref="${fullRef}" totalsRowShown="0">` +
        `<autoFilter ref="${fullRef}"/>` +
        `<tableColumns count="${colCount}">` +
        '<tableColumn id="1" name="Correo"/>' +
        '<tableColumn id="2" name="Contraseña"/>' +
        '<tableColumn id="3" name="Red"/>' +
        (hasNames
          ? '<tableColumn id="4" name="Nombre"/><tableColumn id="5" name="Fecha de nacimiento"/>'
          : '<tableColumn id="4" name="Fecha de nacimiento"/>') +
        '</tableColumns>' +
        '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>' +
        '</table>',
      'utf8',
    ),
  );

  const seedRowsXml = names
    .map(
      (_, i) =>
        `<row r="${i + 2}" spans="1:5"><c r="A${i + 2}"/><c r="B${i + 2}"/><c r="C${i + 2}"/><c r="D${i + 2}" t="s"><v>${5 + i}</v></c><c r="E${i + 2}"/></row>`,
    )
    .join('');

  entries.set(
    'xl/worksheets/sheet1.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<dimension ref="${fullRef}"/>` +
        '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="16"/>' +
        '<cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="18" customWidth="1"/>' +
        (hasNames
          ? '<col min="4" max="4" width="30" customWidth="1"/><col min="5" max="5" width="20" customWidth="1"/>'
          : '<col min="4" max="4" width="20" customWidth="1"/>') +
        '</cols>' +
        '<sheetData>' +
        `<row r="1" spans="1:${colCount}"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c><c r="C1" s="1" t="s"><v>2</v></c><c r="D1" s="1" t="s"><v>3</v></c>${hasNames ? '<c r="E1" s="1" t="s"><v>4</v></c>' : ''}</row>` +
        seedRowsXml +
        '</sheetData>' +
        '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' +
        '</worksheet>',
      'utf8',
    ),
  );

  await writeFileAtomic(filePath, writeZipEntries(entries));
  return filePath;
}

function slugifyPart(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function buildHumanAlias(fullName, domain, existingEmails = new Set()) {
  const cleanDomain = String(domain || '').trim().replace(/^@/, '') || 'tudominio.com';
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .map(slugifyPart)
    .filter(Boolean);

  const taken = new Set([...existingEmails].map((e) => String(e).trim().toLowerCase()));

  if (parts.length === 0) {
    for (let i = 0; i < 30; i += 1) {
      const num = randomInt(100, 999);
      const suffix = Array.from({ length: 5 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[randomInt(36)]).join('');
      const candidate = `u${num}${suffix}@${cleanDomain}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `u${Date.now().toString(36)}@${cleanDomain}`;
  }

  const first = parts[0];
  const last1 = parts[1] || '';
  const last2 = parts[2] || '';

  for (let i = 0; i < 40; i += 1) {
    const num = randomInt(10, 99);
    const patterns = last1
      ? [
          `${first}.${last1}${num}`,
          `${first}${last1}${num}`,
          `${first[0]}${last1}${num}`,
          `${first}.${last2 || last1}${num}`,
          `${first}_${last1}${num}`,
        ]
      : [`${first}${num}`, `${first}.${num}`];
    const local = patterns[randomInt(patterns.length)];
    const candidate = `${local}@${cleanDomain}`;
    if (!taken.has(candidate)) return candidate;
  }

  const fallback = `${first}${last1 ? `.${last1}` : ''}${randomInt(1000, 9999)}@${cleanDomain}`;
  return fallback;
}

function detectColumns(headerRow) {
  let emailCol = 'A';
  let passCol = 'B';
  let netCol = 'C';
  let nameCol = null;
  let birthCol = null;
  if (!headerRow) return { emailCol, passCol, netCol, nameCol, birthCol };

  for (const [col, cell] of headerRow.cells.entries()) {
    const label = cell.value.toLowerCase();
    if (/correo|email|mail/.test(label)) emailCol = col;
    else if (/contrase|password|pass|clave/.test(label)) passCol = col;
    else if (/^red$|network|servicio|app|plataforma/.test(label)) netCol = col;
    else if (/nombre|name/.test(label)) nameCol = col;
    else if (/nacimiento|fecha|birth|dob|cumple/.test(label)) birthCol = col;
  }
  return { emailCol, passCol, netCol, nameCol, birthCol };
}

export async function appendAccountToWorkbook(filePath, { email = '', password, network = '', domain = '', birthdate = '' }) {
  if (!filePath || !existsSync(filePath)) {
    const err = new Error('El archivo Excel vinculado no existe.');
    err.code = 'EXCEL_NOT_FOUND';
    throw err;
  }

  const raw = await readFile(filePath);
  const entries = readZipEntries(raw);
  const sheetKey = entries.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : [...entries.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));

  if (!sheetKey) {
    throw new Error('No se encontró ninguna hoja de cálculo dentro del archivo .xlsx.');
  }

  const hasSharedStrings = entries.has('xl/sharedStrings.xml');
  let ssXml = hasSharedStrings ? entries.get('xl/sharedStrings.xml').toString('utf8') : '';
  const sharedStrings = parseSharedStrings(ssXml);

  let sheetXml = entries.get(sheetKey).toString('utf8');
  const rows = parseRows(sheetXml, sharedStrings);
  const { emailCol, passCol, netCol, nameCol, birthCol } = detectColumns(rows.get(1));

  // Buscar la primera fila >= 2 donde Correo, Contraseña y Red estén vacíos
  const sortedRowNums = [...rows.keys()].filter((n) => n >= 2).sort((a, b) => a - b);
  const existingEmails = new Set();
  for (const rNum of sortedRowNums) {
    const existing = rows.get(rNum)?.cells.get(emailCol)?.value;
    if (existing) existingEmails.add(existing);
  }

  let targetRowNum = null;
  for (const rNum of sortedRowNums) {
    const row = rows.get(rNum);
    const eVal = row.cells.get(emailCol)?.value || '';
    const pVal = row.cells.get(passCol)?.value || '';
    const nVal = row.cells.get(netCol)?.value || '';
    if (!eVal && !pVal && !nVal) {
      targetRowNum = rNum;
      break;
    }
  }

  const isNewRow = targetRowNum === null;
  if (isNewRow) {
    const maxExisting = sortedRowNums.length ? sortedRowNums[sortedRowNums.length - 1] : 1;
    targetRowNum = maxExisting + 1;
  }

  const rowName = nameCol ? (rows.get(targetRowNum)?.cells.get(nameCol)?.value || '') : '';
  const existingBirth = birthCol ? (rows.get(targetRowNum)?.cells.get(birthCol)?.value || '') : '';
  const finalBirthdate = existingBirth || String(birthdate || '').trim() || generateBirthdate();
  const finalEmail = String(email || '').trim() || buildHumanAlias(rowName, domain, existingEmails);

  const valuesByCol = new Map([
    [emailCol, finalEmail],
    [passCol, String(password || '').trim()],
    [netCol, String(network || '').trim()],
  ]);
  if (birthCol && !existingBirth) {
    valuesByCol.set(birthCol, finalBirthdate);
  }

  let sharedIdxByCol = new Map();
  if (hasSharedStrings) {
    const newSi = [];
    for (const [col, val] of valuesByCol.entries()) {
      const idx = sharedStrings.length + newSi.length;
      sharedIdxByCol.set(col, idx);
      newSi.push(`<si><t>${xmlEscape(val)}</t></si>`);
    }
    const newTotal = sharedStrings.length + newSi.length;
    ssXml = ssXml.replace(/count="\d+"/, `count="${newTotal}"`);
    ssXml = ssXml.replace(/uniqueCount="\d+"/, `uniqueCount="${newTotal}"`);
    ssXml = ssXml.replace('</sst>', `${newSi.join('')}</sst>`);
    entries.set('xl/sharedStrings.xml', Buffer.from(ssXml, 'utf8'));
  }

  const maxColIdx = Math.max(
    colToIndex(emailCol),
    colToIndex(passCol),
    colToIndex(netCol),
    birthCol ? colToIndex(birthCol) : 0,
    ...[...rows.values()].flatMap((r) => [...r.cells.keys()].map(colToIndex)),
  );

  if (isNewRow) {
    const sampleStyle = rows.get(2)?.cells.get(emailCol)?.xml.match(/\bs="(\d+)"/)?.[1] || null;
    const orderedCols = [...valuesByCol.keys()].sort((a, b) => colToIndex(a) - colToIndex(b));
    const cellsXml = orderedCols
      .map((col) =>
        buildCellXml({
          ref: `${col}${targetRowNum}`,
          value: valuesByCol.get(col),
          sharedIndex: hasSharedStrings ? sharedIdxByCol.get(col) : null,
          styleId: sampleStyle,
        }),
      )
      .join('');
    const newRowXml = `<row r="${targetRowNum}" spans="1:${maxColIdx}">${cellsXml}</row>`;
    sheetXml = sheetXml.replace('</sheetData>', `${newRowXml}</sheetData>`);
  } else {
    const existingRow = rows.get(targetRowNum);
    const updatedCells = new Map(existingRow.cells);
    const sampleStyle = existingRow.cells.get(emailCol)?.xml.match(/\bs="(\d+)"/)?.[1] || null;

    for (const [col, val] of valuesByCol.entries()) {
      const prevStyle = existingRow.cells.get(col)?.xml.match(/\bs="(\d+)"/)?.[1] || sampleStyle;
      updatedCells.set(col, {
        col,
        ref: `${col}${targetRowNum}`,
        xml: buildCellXml({
          ref: `${col}${targetRowNum}`,
          value: val,
          sharedIndex: hasSharedStrings ? sharedIdxByCol.get(col) : null,
          styleId: prevStyle,
        }),
      });
    }

    const orderedCellsXml = [...updatedCells.values()]
      .sort((a, b) => colToIndex(a.col) - colToIndex(b.col))
      .map((c) => c.xml)
      .join('');

    const updatedRowXml = `<row${existingRow.attrs}>${orderedCellsXml}</row>`;
    sheetXml = sheetXml.replace(existingRow.fullXml, updatedRowXml);
  }

  sheetXml = sheetXml.replace(/<dimension\s+ref="([^"]+)"\s*\/>/, (_, ref) => {
    return `<dimension ref="${updateRangeRef(ref, targetRowNum, maxColIdx)}"/>`;
  });
  entries.set(sheetKey, Buffer.from(sheetXml, 'utf8'));

  // Actualizar tabla Excel si existe (table1.xml)
  for (const key of entries.keys()) {
    if (/^xl\/tables\/table\d+\.xml$/.test(key)) {
      let tXml = entries.get(key).toString('utf8');
      tXml = tXml.replace(/<table([^>]*?)\bref="([^"]+)"/, (_, pre, ref) => {
        return `<table${pre}ref="${updateRangeRef(ref, targetRowNum, maxColIdx)}"`;
      });
      tXml = tXml.replace(/<autoFilter([^>]*?)\bref="([^"]+)"/, (_, pre, ref) => {
        return `<autoFilter${pre}ref="${updateRangeRef(ref, targetRowNum, maxColIdx)}"`;
      });
      entries.set(key, Buffer.from(tXml, 'utf8'));
    }
  }

  await writeFileAtomic(filePath, writeZipEntries(entries));

  return {
    rowNumber: targetRowNum,
    email: valuesByCol.get(emailCol),
    password: valuesByCol.get(passCol),
    network: valuesByCol.get(netCol),
    name: rowName,
    birthdate: finalBirthdate,
    filePath,
  };
}

export async function readWorkbookRows(filePath) {
  const raw = await readFile(filePath);
  const entries = readZipEntries(raw);
  const sheetKey = entries.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : [...entries.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  if (!sheetKey) return [];
  const ssXml = entries.has('xl/sharedStrings.xml') ? entries.get('xl/sharedStrings.xml').toString('utf8') : '';
  const sharedStrings = parseSharedStrings(ssXml);
  const sheetXml = entries.get(sheetKey).toString('utf8');
  const rows = parseRows(sheetXml, sharedStrings);
  const result = [];
  for (const rNum of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(rNum);
    const obj = { rowNumber: rNum };
    for (const [col, cell] of row.cells.entries()) {
      obj[col] = cell.value;
    }
    result.push(obj);
  }
  return result;
}

export function ensureXlsxExtension(rawPath) {
  const cleaned = String(rawPath || '').trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (!cleaned) throw new Error('Ruta de archivo Excel vacía.');
  const resolved = path.resolve(cleaned);
  return resolved.toLowerCase().endsWith('.xlsx') ? resolved : `${resolved}.xlsx`;
}

// --- Diálogos nativos multiplataforma (macOS y Windows) ---

export async function pickExcelFileDialog() {
  if (process.platform === 'darwin') {
    const script =
      'try\n' +
      '  set f to choose file of type {"org.openxmlformats.spreadsheetml.sheet"} with prompt "Selecciona tu archivo Excel (.xlsx)"\n' +
      '  return POSIX path of f\n' +
      'on error number -128\n' +
      '  return ""\n' +
      'end try';
    const { stdout } = await execFileAsync('osascript', ['-e', script]);
    const selected = stdout.trim();
    return selected ? { cancelled: false, filePath: selected } : { cancelled: true, filePath: '' };
  }

  if (process.platform === 'win32') {
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dlg = New-Object System.Windows.Forms.OpenFileDialog',
      '$dlg.Title = "Selecciona tu archivo Excel (.xlsx)"',
      '$dlg.Filter = "Archivos Excel (*.xlsx)|*.xlsx"',
      'if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.FileName }',
    ].join('; ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', psScript]);
    const selected = stdout.trim();
    return selected ? { cancelled: false, filePath: selected } : { cancelled: true, filePath: '' };
  }

  throw new Error('El selector gráfico nativo solo está disponible en macOS y Windows. Ingresa la ruta manualmente.');
}

export async function saveExcelFileDialog(defaultName = 'Cuentas.xlsx') {
  if (process.platform === 'darwin') {
    const safeName = String(defaultName || 'Cuentas.xlsx').replace(/"/g, '');
    const script =
      'try\n' +
      `  set f to choose file name with prompt "¿Dónde quieres guardar el nuevo Excel?" default name "${safeName}"\n` +
      '  return POSIX path of f\n' +
      'on error number -128\n' +
      '  return ""\n' +
      'end try';
    const { stdout } = await execFileAsync('osascript', ['-e', script]);
    const selected = stdout.trim();
    return selected ? { cancelled: false, filePath: ensureXlsxExtension(selected) } : { cancelled: true, filePath: '' };
  }

  if (process.platform === 'win32') {
    const safeName = String(defaultName || 'Cuentas.xlsx').replace(/'/g, '');
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dlg = New-Object System.Windows.Forms.SaveFileDialog',
      '$dlg.Title = "¿Dónde quieres guardar el nuevo Excel?"',
      '$dlg.Filter = "Archivos Excel (*.xlsx)|*.xlsx"',
      `$dlg.FileName = '${safeName}'`,
      'if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.FileName }',
    ].join('; ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', psScript]);
    const selected = stdout.trim();
    return selected ? { cancelled: false, filePath: ensureXlsxExtension(selected) } : { cancelled: true, filePath: '' };
  }

  throw new Error('El diálogo de guardado nativo solo está disponible en macOS y Windows. Ingresa la ruta manualmente.');
}
