import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkPortablePath,
  findCaseCollisions,
  findExternalRefs,
  findLocalRefs,
  findRootAbsoluteRefs,
  readPngSize,
  validateManifest,
} from '../scripts/check-dist.mjs';

const manifest = JSON.parse(readFileSync(new URL('../public/game.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

describe('public/game.json', () => {
  it('符合 Manifest Schema', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('遊戲 ID 固定為 shardwake，裝置只標 desktop', () => {
    expect(manifest.id).toBe('shardwake');
    expect(manifest.devices).toEqual(['desktop']);
  });

  it('版本與 package.json 一致', () => {
    expect(manifest.version).toBe(pkg.version);
  });
});

describe('validateManifest', () => {
  it('拒絕未知欄位、$schema 與缺少的必填欄位', () => {
    const { tags: _tags, ...rest } = manifest;
    const errors = validateManifest({ ...rest, $schema: 'x', extra: 1 });
    expect(errors).toContain('未知欄位：$schema');
    expect(errors).toContain('未知欄位：extra');
    expect(errors).toContain('缺少必填欄位：tags');
  });

  it('檢查 id、version、標籤與裝置', () => {
    const errors = validateManifest({
      ...manifest,
      id: 'Shardwake',
      version: 'v1.0.0',
      tags: ['一', '二', '三', '四', '五', '六', '七', '八', '九'],
      devices: ['desktop', 'tv'],
    });
    expect(errors.some((e) => e.startsWith('id '))).toBe(true);
    expect(errors.some((e) => e.startsWith('version '))).toBe(true);
    expect(errors.some((e) => e.includes('最多 8 個'))).toBe(true);
    expect(errors).toContain('devices 值不合法：tv');
  });

  it('接受預發布版本，拒絕超長欄位', () => {
    expect(validateManifest({ ...manifest, version: '1.2.3-beta.1' })).toEqual([]);
    expect(validateManifest({ ...manifest, name: 'x'.repeat(81) }).length).toBeGreaterThan(0);
    expect(validateManifest({ ...manifest, tags: ['x'.repeat(25)] }).length).toBeGreaterThan(0);
  });
});

describe('checkPortablePath', () => {
  it.each(['index.html', 'assets/index-abc.js', 'assets/three--x.js', 'a/b/c.png'])('接受 %s', (p) => {
    expect(checkPortablePath(p)).toEqual([]);
  });

  it.each([
    '/assets/a.js',
    '../a.js',
    'a\b.js',
    'c:/a.js',
    'a?.js',
    'a#.js',
    'a%20.js',
    'a\u0001.js',
    'CON',
    'aux.txt',
    'assets/com1.js',
    'name.',
    'name ',
  ])('拒絕 %j', (p) => {
    expect(checkPortablePath(p).length).toBeGreaterThan(0);
  });

  it('找出只差大小寫的重複檔名', () => {
    expect(findCaseCollisions(['a/B.js', 'a/b.js'])).toHaveLength(1);
    expect(findCaseCollisions(['a/b.js', 'a/c.js'])).toEqual([]);
  });
});

describe('資源引用', () => {
  it('找出根目錄絕對路徑但忽略相對路徑與協定相對網址', () => {
    expect(findRootAbsoluteRefs('<script src="/assets/a.js"></script>', 'html')).toEqual(['/assets/a.js']);
    expect(findRootAbsoluteRefs('<script src="./assets/a.js"></script>', 'html')).toEqual([]);
    expect(findRootAbsoluteRefs('import("/assets/b.js")', 'js')).toEqual(['/assets/b.js']);
    expect(findRootAbsoluteRefs('a{background:url(/img/x.png)}', 'css')).toEqual(['/img/x.png']);
    expect(findRootAbsoluteRefs('<link href="//cdn.example/x.css">', 'html')).toEqual([]);
  });

  it('找出外部網路資源與本地引用', () => {
    const html =
      '<link rel="stylesheet" href="https://fonts.example/x.css"><script type="module" src="./assets/a.js"></script>';
    expect(findExternalRefs(html)).toEqual(['https://fonts.example/x.css']);
    expect(findLocalRefs(html)).toEqual(['assets/a.js']);
  });
});

describe('readPngSize', () => {
  it('讀出封面 IHDR 尺寸為 800 × 500', () => {
    const buf = readFileSync(new URL('../public/cover.png', import.meta.url));
    expect(readPngSize(buf)).toEqual({ width: 800, height: 500 });
  });

  it('非 PNG 回傳 null', () => {
    expect(readPngSize(new Uint8Array(40))).toBeNull();
  });
});
