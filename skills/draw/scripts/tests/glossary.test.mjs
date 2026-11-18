import { describe, it, expect } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalText, sameText, containsText, entryIdOf, readGlossary, writeGlossary, addEntries, setStatus, glossaryErrors, serialize, readRun, pairsOf, checkGlossary, ensureZukaiDir } from '../src/glossary.mjs';
import { fixturesDir } from './helpers.mjs';

const fixtureProject = join(fixturesDir, 'glossary', 'project');
const fixtureRun = join(fixtureProject, 'diagrams', '20261109_login-flow');
const emptyRoot = () => mkdtempSync(join(tmpdir(), 'zukai-glossary-'));
const copyProject = () => {
  const root = emptyRoot();
  cpSync(fixtureProject, root, { recursive: true });
  return root;
};

describe('comparison', () => {
  it.each([
    ['Office', 'office', true],
    ['  Stock   check ', 'stock check', true],
    ['văn phòng', 'van phong', false],
    ['ＯＦＦＩＣＥ', 'office', true],
    ['ｵﾌｨｽ', 'オフィス', true],
  ])('sameText(%j, %j) is %s', (label, term, expected) => {
    expect(sameText(label, term)).toBe(expected);
  });

  it.each([
    ['Back-office system', 'office', true],
    ['Offices', 'office', false],
    ['The office portal', 'office', true],
    ['Mở văn phòng mới', 'văn phòng', true],
    ['văn phòngX', 'văn phòng', false],
    ['バックオフィスシステム', 'オフィス', true],
    ['ﾊﾞｯｸｵﾌｨｽ', 'オフィス', true],
    ['在庫確認の結果', '在庫確認', true],
  ])('containsText(%j, %j) is %s', (label, term, expected) => {
    expect(containsText(label, term)).toBe(expected);
  });

  it('normalises NFKC, case and white space and keeps diacritics', () => {
    expect(normalText(' Văn\tPhòng ')).toBe('văn phòng');
  });

  it('gives an entry an id from its normalised terms, whatever the order of the languages', () => {
    expect(entryIdOf({ vi: 'Văn phòng', en: 'Office' })).toBe(entryIdOf({ en: 'office', vi: 'văn phòng' }));
    expect(entryIdOf({ en: 'office' })).toMatch(/^g-[0-9a-f]{8}$/);
  });
});

describe('the file', () => {
  it('reads the fixture and gives a missing file as an empty glossary', () => {
    const read = readGlossary(fixtureProject);
    expect(read).toMatchObject({ ok: true, exists: true });
    expect(read.rev).toMatch(/^[0-9a-f]{64}$/);
    expect(readGlossary(emptyRoot())).toMatchObject({ ok: true, exists: false, rev: null, glossary: { schemaVersion: 1, entries: [] } });
  });

  it('refuses a file that does not match the schema, with paths and hints', () => {
    const root = emptyRoot();
    ensureZukaiDir(root);
    writeFileSync(join(root, '.zukai', 'glossary.json'), JSON.stringify({ schemaVersion: 1, entries: [{ id: 'g-1', terms: { english: 'x' }, status: 'maybe' }] }));
    const read = readGlossary(root);
    expect(read.ok).toBe(false);
    expect(read.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['/entries/0/id', '/entries/0/terms', '/entries/0/status']));
    expect(read.errors.every((e) => e.hint)).toBe(true);
  });

  it.each([
    ['a token pattern', { en: 'key AKIAABCDEFGHIJKLMNOP' }],
    ['a mail address', { en: 'mail jane.doe@acme.co.jp' }],
    ['a line break', { en: 'two\nlines' }],
    ['a direction mark', { en: 'office‮' }],
    ['81 characters', { en: 'x'.repeat(81) }],
  ])('refuses a term that holds %s, and leaves the file unchanged', (_, terms) => {
    const root = copyProject();
    const before = readFileSync(join(root, '.zukai', 'glossary.json'), 'utf8');
    const result = addEntries(root, [{ terms }]);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(readFileSync(join(root, '.zukai', 'glossary.json'), 'utf8')).toBe(before);
  });

  it('takes a term of 80 characters and refuses a note of 281', () => {
    expect(glossaryErrors({ schemaVersion: 1, entries: [{ id: 'g-00000000', terms: { en: 'x'.repeat(80) }, status: 'suggested' }] })).toEqual([]);
    expect(glossaryErrors({ schemaVersion: 1, entries: [{ id: 'g-00000000', terms: { en: 'x' }, note: 'n'.repeat(281), status: 'suggested' }] })[0]).toMatchObject({ path: '/entries/0/note', hint: 'at most 280 characters' });
  });

  it('writes sorted two-space JSON with LF and a final newline', () => {
    const text = serialize({ schemaVersion: 1, entries: [{ status: 'confirmed', terms: { vi: 'b', en: 'a' }, id: 'g-ffffffff' }, { id: 'g-00000000', terms: { en: 'c' }, status: 'suggested' }] });
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toMatch(/\r/);
    const parsed = JSON.parse(text);
    expect(parsed.entries.map((e) => e.id)).toEqual(['g-00000000', 'g-ffffffff']);
    expect(Object.keys(parsed.entries[1])).toEqual(['id', 'terms', 'status']);
    expect(Object.keys(parsed.entries[1].terms)).toEqual(['en', 'vi']);
    // The fixture was written by the same function.
    expect(readFileSync(join(fixtureProject, '.zukai', 'glossary.json'), 'utf8')).toBe(serialize(readGlossary(fixtureProject).glossary));
  });

  it('creates .zukai/ with a .gitignore for the console state and the lock', () => {
    const root = emptyRoot();
    addEntries(root, [{ terms: { en: 'office', vi: 'văn phòng' } }]);
    expect(readFileSync(join(root, '.zukai', '.gitignore'), 'utf8')).toBe('labs/\nglossary.lock\n');
    expect(existsSync(join(root, '.zukai', 'glossary.lock'))).toBe(false);
  });
});

describe('the store', () => {
  it('refuses a write whose expected rev no longer matches, and changes nothing', () => {
    const root = copyProject();
    const { rev } = readGlossary(root);
    expect(setStatus(root, 'g-7e0b7e28', 'confirmed', { expectedRev: rev })).toMatchObject({ ok: true, written: true });
    const before = readFileSync(join(root, '.zukai', 'glossary.json'), 'utf8');
    expect(setStatus(root, 'g-7e0b7e28', 'rejected', { expectedRev: rev })).toMatchObject({ ok: false, code: 'conflict' });
    expect(readFileSync(join(root, '.zukai', 'glossary.json'), 'utf8')).toBe(before);
  });

  it('waits for a live lock and gives up after five seconds without writing', () => {
    const root = copyProject();
    writeFileSync(join(root, '.zukai', 'glossary.lock'), 'someone\n');
    const started = Date.now();
    expect(addEntries(root, [{ terms: { en: 'desk' } }])).toMatchObject({ ok: false, code: 'locked' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
  }, 10_000);

  it('takes over a lock older than 30 seconds', () => {
    const root = copyProject();
    const lock = join(root, '.zukai', 'glossary.lock');
    writeFileSync(lock, 'gone\n');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(addEntries(root, [{ terms: { en: 'desk' } }])).toMatchObject({ ok: true, written: true });
    expect(existsSync(lock)).toBe(false);
  });

  it('writes nothing when the change returns no glossary', () => {
    const root = copyProject();
    expect(writeGlossary(root, () => ({ note: 'nothing' }))).toMatchObject({ ok: true, written: false, note: 'nothing' });
  });
});

describe('add and set', () => {
  it('adds suggestions, skips what is there with its status, and reports a conflict with a confirmed entry', () => {
    const root = copyProject();
    const result = addEntries(root, [
      { terms: { en: 'desk', vi: 'bàn làm việc' } },
      { terms: { en: 'Sign in', ja: 'ログオン' } },
      { terms: { en: 'office', vi: 'cơ quan' } },
      { terms: { ja: 'オフィス' } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.added).toEqual([entryIdOf({ en: 'desk', vi: 'bàn làm việc' })]);
    expect(result.skipped.map((s) => [s.id, s.status])).toEqual([['g-e68e003a', 'rejected'], ['g-1da217c3', 'confirmed']]);
    expect(result.conflicts).toEqual([{ terms: { en: 'office', vi: 'cơ quan' }, with: { id: 'g-1da217c3', terms: { en: 'office', ja: 'オフィス', vi: 'văn phòng' } } }]);
    const entry = readGlossary(root).glossary.entries.find((e) => e.id === result.added[0]);
    expect(entry.status).toBe('suggested');
  });

  it('sets a status and reports an unknown id', () => {
    const root = copyProject();
    expect(setStatus(root, 'g-7e0b7e28', 'rejected')).toMatchObject({ ok: true, written: true, status: 'rejected' });
    expect(setStatus(root, 'g-00000000', 'rejected')).toMatchObject({ ok: true, missing: true });
  });
});

describe('pairs', () => {
  it('pairs the labels of a translated IR by path and only the keys of a map that name one label', () => {
    const { pairs, unpaired } = pairsOf(readRun(fixtureRun));
    const ir = pairs.filter((p) => p.from === 'ir');
    expect(ir).toHaveLength(7);
    expect(ir.find((p) => p.path === '/nodes/3/label')).toEqual({ run: '20261109_login-flow', diagram: 'login-flow', path: '/nodes/3/label', lang: 'ja', source: 'Stock check', translated: '在庫チェック', from: 'ir' });
    expect(pairs.filter((p) => p.from === 'map').map((p) => [p.path, p.source, p.translated])).toEqual([['/nodes/1/label', 'Office', 'Cơ quan'], ['/nodes/3/label', 'Stock check', 'Kiểm kho']]);
    expect(unpaired).toEqual({ title: 1, unknown: 1 });
  });

  it('counts rows, the canvas, a transition and a bare id that two pages share, and strips the brackets of a condition', () => {
    const run = {
      run: 'r',
      originals: [
        { id: 'a', ir: { schemaVersion: 1, kind: 'state', title: 'A', states: [{ id: 's', label: 'Open' }], transitions: [{ id: 't', from: 's', to: 's', event: 'go' }] } },
        { id: 'b', ir: { schemaVersion: 1, kind: 'usecase', title: 'B', actors: [{ id: 's', label: 'Clerk' }], useCases: [{ id: 'u', label: 'Lend' }, { id: 'v', label: 'Fine' }], boundaries: [], relations: [{ id: 'x', kind: 'extend', from: 'v', to: 'u', condition: 'book late' }] } },
      ],
      variants: [],
      maps: [{ lang: 'vi', map: { 'canvas:title': 'x', 'a:t': 'đi', s: 'y', 'b:x': '[sách trễ]', 'e:row-0': 'z' } }],
    };
    const { pairs, unpaired } = pairsOf(run);
    expect(unpaired).toEqual({ canvas: 1, transition: 1, 'bare-id-on-several-pages': 1, row: 1 });
    expect(pairs).toEqual([{ run: 'r', diagram: 'b', path: '/relations/0/condition', lang: 'vi', source: 'book late', translated: 'sách trễ', from: 'map' }]);
  });
});

describe('check', () => {
  const report = (root, mutate) => {
    const run = readRun(join(root, 'diagrams', '20261109_login-flow'));
    mutate?.(run);
    return checkGlossary(readGlossary(root).glossary, [run]);
  };

  it('blocks on a translated IR that does not carry the confirmed term, and warns only for the older map', () => {
    const r = report(fixtureProject);
    expect(r.blocking).toBe(1);
    expect(r.findings.filter((f) => f.level === 'blocking')).toEqual([expect.objectContaining({ kind: 'translation-mismatch', path: '/nodes/3/label', lang: 'ja', text: '在庫チェック', expected: '在庫確認', from: 'ir' })]);
    expect(r.findings.filter((f) => f.from === 'map').every((f) => f.level === 'warning')).toBe(true);
    expect(r.findings.filter((f) => f.from === 'map')).toHaveLength(2);
  });

  it('passes once the translated IR is fixed', () => {
    const r = report(fixtureProject, (run) => { run.variants[0].ir.nodes[3].label = '在庫確認'; });
    expect(r.blocking).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('warns, never blocks, for a term inside a longer label', () => {
    const r = report(fixtureProject, (run) => { run.variants[0].ir.nodes[2].label = 'バックエンド'; });
    expect(r.findings.filter((f) => f.path === '/nodes/2/label')).toEqual([expect.objectContaining({ level: 'warning', kind: 'translation-mismatch', source: 'Back-office system' })]);
  });

  it('blocks a label equal to an avoided term and warns for one that contains it', () => {
    const r = report(fixtureProject, (run) => {
      run.variants.push({ lang: 'vi', id: 'login-flow', ir: { ...structuredClone(run.originals[0].ir), meta: { lang: 'vi' } } });
      run.variants[1].ir.nodes[1].label = 'Cơ quan';
      run.variants[1].ir.nodes[0].label = 'Mở cổng cơ quan';
    });
    const avoided = r.findings.filter((f) => f.kind === 'avoided-term');
    expect(avoided.map((f) => [f.path, f.level])).toEqual([['/nodes/0/label', 'warning'], ['/nodes/1/label', 'blocking']]);
  });

  it('applies no suggested or rejected entry', () => {
    const root = copyProject();
    addEntries(root, [{ terms: { en: 'signed in', ja: '署名済み' } }]);
    const before = report(fixtureProject).findings;
    expect(report(root).findings).toEqual(before);
  });
});
