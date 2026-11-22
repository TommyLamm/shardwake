// 開發中的成品快速自檢（npm run check:dist）。
// 規則依平台「開發與發布標準」的「最小成品」與 Manifest Schema；
// 正式驗證在 M1-17 以平台 CLI（game:pack / game:validate）完成，這裡不取代它。
import { lstatSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LIMITS = Object.freeze({
  zipBytes: 512 * 1024 * 1024,
  unpackedBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 50_000,
  coverBytes: 5 * 1024 * 1024,
  coverWidth: 800,
  coverHeight: 500,
});

export const MANIFEST_REQUIRED = Object.freeze([
  'schemaVersion',
  'id',
  'name',
  'version',
  'description',
  'author',
  'entry',
  'cover',
  'tags',
  'instructions',
  'devices',
]);
export const MANIFEST_OPTIONAL = Object.freeze(['leaderboard', 'cloudSave']);
export const EXPECTED_GAME_ID = 'shardwake';

const ID_RE = /^[a-z][a-z0-9-]{1,47}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/;
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const COVER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/** 以字元（code point）計算長度，與 JSON Schema 的 maxLength 一致。 */
const charLength = (s) => [...s].length;

/**
 * 檢查一個成品內的相對路徑（以 / 分隔）是否符合平台的可攜路徑規則。
 * @param {string} p
 * @returns {string[]} 錯誤訊息；空陣列表示通過
 */
export function checkPortablePath(p) {
  const errors = [];
  if (typeof p !== 'string' || p.length === 0) return ['路徑為空'];
  if (p.startsWith('/')) errors.push(`不可為絕對路徑：${p}`);
  if (p.includes('\\')) errors.push(`不可含反斜線：${p}`);
  if (p.includes(':')) errors.push(`不可含冒號：${p}`);
  for (const ch of ['?', '#', '%']) if (p.includes(ch)) errors.push(`不可含「${ch}」：${p}`);
  if (CONTROL_RE.test(p)) errors.push(`不可含控制字元：${JSON.stringify(p)}`);
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg === '' && p !== '') {
      if (!p.startsWith('/')) errors.push(`不可有空的路徑段：${p}`);
      continue;
    }
    if (seg === '..' || seg === '.') errors.push(`不可含「${seg}」路徑段：${p}`);
    if (WINDOWS_RESERVED_RE.test(seg)) errors.push(`不可使用 Windows 保留檔名：${seg}`);
    if (/[ .]$/.test(seg) && seg !== '.' && seg !== '..') errors.push(`檔名不可以空白或句點結尾：${seg}`);
  }
  return errors;
}

/**
 * 找出只差大小寫的重複路徑。
 * @param {string[]} paths
 * @returns {string[]}
 */
export function findCaseCollisions(paths) {
  const seen = new Map();
  const errors = [];
  for (const p of paths) {
    const key = p.toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined && prev !== p) errors.push(`只差大小寫的重複檔名：${prev} 與 ${p}`);
    else seen.set(key, p);
  }
  return errors;
}

function checkString(m, key, { min = 1, max }, errors) {
  const v = m[key];
  if (typeof v !== 'string') return void errors.push(`${key} 必須是字串`);
  const len = charLength(v);
  if (len < min) errors.push(`${key} 不可為空`);
  if (len > max) errors.push(`${key} 長度 ${len} 超過上限 ${max}`);
}

/**
 * 依 Manifest Schema 檢查 game.json 內容（不含檔案存在性）。
 * @param {unknown} m
 * @returns {string[]}
 */
export function validateManifest(m) {
  const errors = [];
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return ['game.json 必須是 JSON 物件'];
  const allowed = new Set([...MANIFEST_REQUIRED, ...MANIFEST_OPTIONAL]);
  for (const key of Object.keys(m)) if (!allowed.has(key)) errors.push(`未知欄位：${key}`);
  for (const key of MANIFEST_REQUIRED) if (!(key in m)) errors.push(`缺少必填欄位：${key}`);

  if ('schemaVersion' in m && m.schemaVersion !== 1 && m.schemaVersion !== 2)
    errors.push('schemaVersion 必須是 1 或 2');
  if ('cloudSave' in m && m.schemaVersion !== 2) errors.push('cloudSave 需要 schemaVersion 2');
  if ('id' in m) {
    if (typeof m.id !== 'string' || !ID_RE.test(m.id))
      errors.push('id 必須以小寫英文字母開頭，只含小寫字母、數字、連字號，長度 2–48');
    else if (m.id !== EXPECTED_GAME_ID) errors.push(`id 必須固定為 ${EXPECTED_GAME_ID}，目前是 ${m.id}`);
  }
  if ('version' in m) {
    if (typeof m.version !== 'string' || !VERSION_RE.test(m.version) || m.version.length > 64)
      errors.push('version 格式須為 1.2.3 或 1.2.3-beta.1（不含 v 前綴，≤ 64 字元）');
  }
  if ('name' in m) checkString(m, 'name', { max: 80 }, errors);
  if ('author' in m) checkString(m, 'author', { max: 100 }, errors);
  if ('description' in m) checkString(m, 'description', { max: 2000 }, errors);
  if ('instructions' in m) checkString(m, 'instructions', { max: 2000 }, errors);
  for (const key of ['entry', 'cover']) {
    if (!(key in m)) continue;
    checkString(m, key, { max: 240 }, errors);
    if (typeof m[key] === 'string') for (const e of checkPortablePath(m[key])) errors.push(`${key}：${e}`);
  }
  if (typeof m.entry === 'string' && !/\.html?$/i.test(m.entry)) errors.push('entry 必須是 HTML 檔');
  if (typeof m.cover === 'string' && !COVER_EXTENSIONS.some((ext) => m.cover.toLowerCase().endsWith(ext)))
    errors.push('cover 必須是 PNG、JPEG、WebP 或 GIF');
  if ('tags' in m) {
    if (!Array.isArray(m.tags)) errors.push('tags 必須是陣列');
    else {
      if (m.tags.length > 8) errors.push(`tags 最多 8 個，目前 ${m.tags.length} 個`);
      m.tags.forEach((t, i) => {
        if (typeof t !== 'string' || charLength(t) < 1 || charLength(t) > 24)
          errors.push(`tags[${i}] 必須是 1–24 字元的字串`);
      });
    }
  }
  if ('devices' in m) {
    if (!Array.isArray(m.devices) || m.devices.length < 1 || m.devices.length > 2)
      errors.push('devices 必須是 1–2 個元素的陣列');
    else {
      for (const d of m.devices) if (d !== 'desktop' && d !== 'mobile') errors.push(`devices 值不合法：${d}`);
      if (new Set(m.devices).size !== m.devices.length) errors.push('devices 不可重複');
    }
  }
  return errors;
}

/**
 * 讀取 PNG 的 IHDR 尺寸；不是 PNG 時回傳 null。
 * @param {Uint8Array} buf
 * @returns {{ width: number, height: number } | null}
 */
export function readPngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 33 || sig.some((b, i) => buf[i] !== b)) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const type = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
  if (type !== 'IHDR') return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * 找出 HTML／JS／CSS 文字中的根目錄絕對路徑（例如 "/assets/x.js"）。
 * 只抓明確的資源引用樣式，避免誤判一般字串。
 * @param {string} text
 * @param {'html' | 'js' | 'css'} kind
 * @returns {string[]}
 */
export function findRootAbsoluteRefs(text, kind) {
  const hits = new Set();
  const patterns = [/["'`(]\s*(\/(?:assets|src|public|node_modules)\/[^"'`)\s]*)/g];
  if (kind === 'html') patterns.push(/\b(?:src|href|content)\s*=\s*["'](\/(?!\/)[^"']*)["']/gi);
  if (kind === 'css') patterns.push(/url\(\s*["']?(\/(?!\/)[^"')]*)/gi);
  for (const re of patterns) for (const match of text.matchAll(re)) hits.add(match[1]);
  return [...hits];
}

/**
 * 找出 index.html 中載入的外部網路資源（CDN、網路字型等）。
 * @param {string} html
 * @returns {string[]}
 */
export function findExternalRefs(html) {
  const hits = new Set();
  const re = /<(?:script|link|img|source|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi;
  for (const match of html.matchAll(re)) hits.add(match[1]);
  return [...hits];
}

/** 列出 index.html 引用的相對資源（不含 data:、hash 與外部網址）。 */
export function findLocalRefs(html) {
  const refs = new Set();
  const re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(re)) {
    const ref = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue;
    refs.add(ref.replace(/^\.\//, '').split(/[?#]/)[0]);
  }
  return [...refs].filter(Boolean);
}

function walk(root, rel = '', out = { files: [], symlinks: [], dirs: [] }) {
  for (const name of readdirSync(join(root, rel))) {
    const relPath = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(root, relPath));
    if (st.isSymbolicLink()) out.symlinks.push(relPath);
    else if (st.isDirectory()) {
      out.dirs.push(relPath);
      walk(root, relPath, out);
    } else out.files.push({ path: relPath, size: st.size });
  }
  return out;
}

/**
 * 檢查整個成品目錄。
 * @param {string} distDir
 * @param {{ expectedVersion?: string }} [options]
 * @returns {{ errors: string[], warnings: string[], summary: Record<string, unknown> }}
 */
export function checkDist(distDir, options = {}) {
  const errors = [];
  const warnings = [];
  if (!existsSync(distDir)) return { errors: [`找不到成品目錄 ${distDir}，請先執行 npm run build`], warnings, summary: {} };

  const { files, symlinks, dirs } = walk(distDir);
  const paths = files.map((f) => f.path);
  const pathSet = new Set(paths);

  // 根目錄結構。
  for (const name of ['game.json', 'index.html', 'cover.png'])
    if (!pathSet.has(name)) errors.push(`成品根目錄缺少 ${name}（可能多包了一層目錄）`);
  const rootEntries = readdirSync(distDir);
  if (rootEntries.length === 1 && dirs.includes(rootEntries[0]))
    errors.push(`成品只有單一子目錄 ${rootEntries[0]}，不可多包一層`);

  // 路徑規則。
  for (const s of symlinks) errors.push(`不可包含符號連結：${s}`);
  for (const p of [...paths, ...dirs]) errors.push(...checkPortablePath(p));
  errors.push(...findCaseCollisions([...paths, ...dirs]));

  // 大小與數量。
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const entries = files.length + dirs.length;
  if (totalBytes > LIMITS.unpackedBytes) errors.push(`解壓後大小 ${totalBytes} bytes 超過 2 GiB`);
  else if (totalBytes > LIMITS.zipBytes) warnings.push(`成品 ${totalBytes} bytes 已超過 512 MiB，ZIP 可能超過上限`);
  if (entries > LIMITS.maxEntries) errors.push(`檔案與目錄數 ${entries} 超過 ${LIMITS.maxEntries}`);

  // game.json。
  let manifest = null;
  if (pathSet.has('game.json')) {
    try {
      manifest = JSON.parse(readFileSync(join(distDir, 'game.json'), 'utf8'));
    } catch (err) {
      errors.push(`game.json 不是合法 JSON：${err.message}`);
    }
  }
  if (manifest) {
    errors.push(...validateManifest(manifest).map((e) => `game.json：${e}`));
    for (const key of ['entry', 'cover'])
      if (typeof manifest[key] === 'string' && !pathSet.has(manifest[key]))
        errors.push(`game.json：${key} 指向的檔案不存在：${manifest[key]}`);
    if (options.expectedVersion && manifest.version !== options.expectedVersion)
      errors.push(`game.json 的 version（${manifest.version}）與 package.json（${options.expectedVersion}）不一致`);
  }

  // 封面。
  if (pathSet.has('cover.png')) {
    const buf = readFileSync(join(distDir, 'cover.png'));
    if (buf.length > LIMITS.coverBytes) errors.push(`cover.png 大小 ${buf.length} bytes 超過 5 MiB`);
    const size = readPngSize(buf);
    if (!size) errors.push('cover.png 不是有效的 PNG');
    else if (size.width !== LIMITS.coverWidth || size.height !== LIMITS.coverHeight)
      errors.push(`cover.png 尺寸 ${size.width} × ${size.height}，應為 ${LIMITS.coverWidth} × ${LIMITS.coverHeight}`);
  }

  // 入口與資源路徑。
  if (pathSet.has('index.html')) {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    for (const ref of findRootAbsoluteRefs(html, 'html')) errors.push(`index.html 含根目錄絕對路徑：${ref}`);
    for (const ref of findExternalRefs(html)) errors.push(`index.html 載入外部資源：${ref}`);
    for (const ref of findLocalRefs(html))
      if (!pathSet.has(decodeURI(ref))) errors.push(`index.html 引用的檔案不存在：${ref}`);
  }
  for (const f of files) {
    const kind = f.path.endsWith('.css') ? 'css' : /\.(?:m?js)$/.test(f.path) ? 'js' : null;
    if (!kind) continue;
    const text = readFileSync(join(distDir, f.path), 'utf8');
    for (const ref of findRootAbsoluteRefs(text, kind)) errors.push(`${f.path} 含根目錄絕對路徑：${ref}`);
  }

  return {
    errors,
    warnings,
    summary: { files: files.length, dirs: dirs.length, totalBytes, version: manifest?.version },
  };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = resolve(root, process.argv[2] ?? 'dist');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const { errors, warnings, summary } = checkDist(distDir, { expectedVersion: pkg.version });
  for (const w of warnings) console.warn(`警告：${w}`);
  if (errors.length) {
    console.error(`check:dist 失敗（${errors.length} 項）：`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }
  const mib = (summary.totalBytes / 1024 / 1024).toFixed(2);
  console.log(`check:dist 通過：${summary.files} 個檔案、${summary.dirs} 個目錄、${mib} MiB，版本 ${summary.version}`);
  console.log('（快速自檢；正式驗證於 M1-17 以平台 game:validate 執行）');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
