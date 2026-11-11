import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotRun, listRevisions, restoreRun } from '../src/revisions.mjs';
import { loadFixture } from './helpers.mjs';

const flow = loadFixture('flowchart', 'valid');
const seq = loadFixture('sequence', 'valid');
const text = (ir) => JSON.stringify(ir, null, 2) + '\n';

let run;
beforeEach(() => {
  run = mkdtempSync(join(tmpdir(), 'zukai-rev-'));
  mkdirSync(join(run, 'source'));
  mkdirSync(join(run, 'drawio'));
  writeFileSync(join(run, 'source', 'main.ir.json'), text(flow));
  writeFileSync(join(run, 'source', 'login.ir.json'), text(seq));
});

const history = () => readdirSync(join(run, 'history')).filter((n) => !n.startsWith('.')).sort();

describe('snapshotRun', () => {
  it('copies every IR of the run into a numbered revision with its record', () => {
    const r = snapshotRun(run, { request: 'add a step', bundle: { title: 'Shop', canvas: ['main'], gap: 120 }, now: new Date('2026-11-11T00:00:00Z') });
    expect(r).toMatchObject({ ok: true, rev: 'r001', files: ['login.ir.json', 'main.ir.json'], removed: [] });
    expect(readFileSync(join(run, 'history', 'r001', 'source', 'main.ir.json'), 'utf8')).toBe(text(flow));
    expect(JSON.parse(readFileSync(join(run, 'history', 'r001', 'revision.json'), 'utf8'))).toEqual({
      rev: 'r001', number: 1, createdAt: '2026-11-11T00:00:00.000Z', request: 'add a step', files: ['login.ir.json', 'main.ir.json'], extras: [], bundle: { title: 'Shop', canvas: ['main'], gap: 120 },
    });
  });

  it('keeps only the newest revisions', () => {
    for (let i = 0; i < 6; i++) snapshotRun(run, { request: `change ${i}` });
    expect(history()).toEqual(['r002', 'r003', 'r004', 'r005', 'r006']);
    const r = snapshotRun(run, { keep: 2 });
    expect(r.removed).toEqual(['r002', 'r003', 'r004', 'r005']);
    expect(history()).toEqual(['r006', 'r007']);
  });

  it('saves a hand-edited output under extras/ and refuses files outside the run', () => {
    writeFileSync(join(run, 'drawio', 'main.drawio'), '<mxfile/>');
    const r = snapshotRun(run, { extras: ['drawio/main.drawio'] });
    expect(r.extras).toEqual(['drawio/main.drawio']);
    expect(readFileSync(join(run, 'history', 'r001', 'extras', 'drawio', 'main.drawio'), 'utf8')).toBe('<mxfile/>');
    expect(snapshotRun(run, { extras: ['../elsewhere.drawio'] })).toMatchObject({ ok: false, code: 1 });
    expect(snapshotRun(run, { extras: ['drawio/missing.drawio'] })).toMatchObject({ ok: false, code: 1 });
  });

  it('drops a half-written revision left by an interrupted run', () => {
    mkdirSync(join(run, 'history', '.r001.tmp-999', 'source'), { recursive: true });
    expect(snapshotRun(run).rev).toBe('r001');
    expect(readdirSync(join(run, 'history'))).toEqual(['r001']);
  });

  it('rejects a folder without source/ and a keep below 1', () => {
    expect(snapshotRun(mkdtempSync(join(tmpdir(), 'zukai-norun-')))).toMatchObject({ ok: false, code: 1 });
    expect(snapshotRun(run, { keep: 0 })).toMatchObject({ ok: false, code: 1 });
  });
});

describe('listRevisions', () => {
  it('lists newest first with the request that made each one', () => {
    snapshotRun(run, { request: 'first' });
    snapshotRun(run, { request: 'second' });
    const r = listRevisions(run);
    expect(r.revisions.map((x) => [x.rev, x.request])).toEqual([['r002', 'second'], ['r001', 'first']]);
  });
});

describe('restoreRun', () => {
  it('puts a smaller set back, removing the extra IR and its outputs, after a snapshot of the current state', () => {
    snapshotRun(run, { request: 'two diagrams', bundle: { title: 'Shop' } });
    writeFileSync(join(run, 'source', 'part.ir.json'), text(flow));
    writeFileSync(join(run, 'drawio', 'part.drawio'), '<mxfile/>');
    mkdirSync(join(run, 'mermaid'));
    writeFileSync(join(run, 'mermaid', 'part.mmd'), 'flowchart TD');
    const changed = { ...flow, title: 'Changed' };
    writeFileSync(join(run, 'source', 'main.ir.json'), text(changed));

    const r = restoreRun(run, 'r001');
    expect(r).toMatchObject({ ok: true, restored: 'r001', snapshot: 'r002', removedDiagrams: ['part'], bundle: { title: 'Shop' } });
    expect(readdirSync(join(run, 'source')).sort()).toEqual(['login.ir.json', 'main.ir.json']);
    expect(readFileSync(join(run, 'source', 'main.ir.json'), 'utf8')).toBe(text(flow));
    expect(existsSync(join(run, 'drawio', 'part.drawio'))).toBe(false);
    expect(existsSync(join(run, 'mermaid', 'part.mmd'))).toBe(false);
    expect(listRevisions(run).revisions[0].request).toBe('undo to r001');

    // The undo is undoable: restoring the snapshot gives back the three files as they were.
    restoreRun(run, 'r002');
    expect(readdirSync(join(run, 'source')).sort()).toEqual(['login.ir.json', 'main.ir.json', 'part.ir.json']);
    expect(readFileSync(join(run, 'source', 'main.ir.json'), 'utf8')).toBe(text(changed));
  });

  it('restores the oldest kept revision even when the snapshot rotates it away', () => {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(run, 'source', 'main.ir.json'), text({ ...flow, title: `v${i}` }));
      snapshotRun(run);
    }
    writeFileSync(join(run, 'source', 'main.ir.json'), text({ ...flow, title: 'current' }));
    const r = restoreRun(run, 'r001');
    expect(r).toMatchObject({ ok: true, snapshot: 'r006', removedRevisions: ['r001'] });
    expect(JSON.parse(readFileSync(join(run, 'source', 'main.ir.json'), 'utf8')).title).toBe('v0');
  });

  it('refuses an unknown revision and one whose IR no longer validates, leaving source/ alone', () => {
    expect(restoreRun(run, 'r009')).toMatchObject({ ok: false, code: 1 });
    snapshotRun(run);
    writeFileSync(join(run, 'history', 'r001', 'source', 'main.ir.json'), '{"kind":"flowchart"}');
    const before = readFileSync(join(run, 'source', 'main.ir.json'), 'utf8');
    expect(restoreRun(run, 'r001')).toMatchObject({ ok: false, code: 2 });
    expect(readFileSync(join(run, 'source', 'main.ir.json'), 'utf8')).toBe(before);
    expect(history()).toEqual(['r001']);
  });
});
