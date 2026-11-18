import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { listRuns, runDetail, diagramDetail, runDoc, changesSince, filePath, runPath, revisionNames } from '../src/labs-runs.mjs';
import { labsProject } from './labs-project.mjs';

const p = labsProject();

describe('labs runs', () => {
  it('lists every run folder under diagrams/, newest first, and nothing else', () => {
    const runs = listRuns(p.root);
    expect(runs.map((r) => r.run)).toEqual([p.runs.board, p.runs.lifecycle, p.runs.checkout, p.runs.login]);
  });

  it('describes a run with parts, a business view, pictures, revisions and a sources record', () => {
    const run = listRuns(p.root).find((r) => r.run === p.runs.checkout);
    expect(run).toMatchObject({ date: '2026-11-10', title: 'Checkout', origin: 'scout', targets: ['drawio', 'svg'], revisions: 2, scouted: true });
    expect(run.diagrams.map((d) => [d.id, d.audience])).toEqual([['checkout', 'technical'], ['checkout-business', 'business'], ['checkout-01-pay', 'technical']]);
  });

  it('lists a language variant as a variant, not as further diagrams', () => {
    const run = listRuns(p.root).find((r) => r.run === p.runs.login);
    expect(run.diagrams.map((d) => d.id)).toEqual(['login-flow']);
    expect(run.variants).toEqual([{ lang: 'ja', kinds: ['translated-irs'] }, { lang: 'vi', kinds: ['label-map'] }]);
  });

  it('tells a Mermaid run and a FigJam run by their files', () => {
    const runs = listRuns(p.root);
    expect(runs.find((r) => r.run === p.runs.lifecycle).targets).toEqual(['mermaid']);
    expect(runs.find((r) => r.run === p.runs.board)).toMatchObject({ targets: ['figjam'], origin: 'recook' });
  });

  it('gives the files, the revisions with the undo and redo targets, and the stale result of a run', () => {
    const d = runDetail(p.root, p.runs.checkout);
    expect(d.files.map((f) => f.name)).toEqual(['checkout.drawio', 'drafts/a/changes.diff.drawio', 'source/checkout-01-pay.ir.json', 'source/checkout-business.ir.json', 'source/checkout.ir.json', 'source/checkout.sources.json', 'svg/checkout.drawio.svg']);
    expect(d.revisions.map((r) => r.rev)).toEqual(['r002', 'r001']);
    expect(d).toMatchObject({ undo: 'r002', redo: null, stale: { stale: true } });
    expect(runDetail(p.root, p.runs.login).stale).toBeNull();
  });

  it('gives one diagram with its rev, labels and warnings', () => {
    const d = diagramDetail(p.root, p.runs.checkout, 'checkout');
    expect(d.rev).toMatch(/^[0-9a-f]{64}$/);
    expect(d.errors).toEqual([]);
    expect(d.labels[0]).toMatchObject({ path: '/title', text: 'Checkout' });
    expect(diagramDetail(p.root, p.runs.checkout, '../checkout')).toBeUndefined();
  });

  it('builds the description tables in memory and the changes since a revision', async () => {
    const doc = await runDoc(p.root, p.runs.checkout, 'vi');
    expect(doc.ok).toBe(true);
    expect(doc.markdown).toContain('lang=vi');
    expect(await runDoc(p.root, p.runs.checkout, 'fr')).toBeUndefined();
    expect(changesSince(p.root, p.runs.checkout, 'r001').diagrams[0].changed[0]).toMatchObject({ id: 'start', fields: ['label'] });
    expect(revisionNames(p.root, p.runs.checkout)).toEqual(['r002', 'r001']);
    expect(changesSince(p.root, p.runs.checkout, 'r999')).toBeUndefined();
  });

  it('finds a file only by a name of the listing whose real path lies inside the run', () => {
    expect(filePath(p.root, p.runs.checkout, 'svg/checkout.drawio.svg')).toBe(join(runPath(p.root, p.runs.checkout), 'svg', 'checkout.drawio.svg'));
    for (const name of ['source/leak.txt', '../20261109_login-flow/source/login-flow.ir.json', '/etc/hosts', 'history/r001/revision.json', 'svg/../checkout.drawio', '']) {
      expect(filePath(p.root, p.runs.checkout, name)).toBeUndefined();
    }
    expect(runPath(p.root, '20261113_link')).toBeUndefined();
    expect(runPath(p.root, '..')).toBeUndefined();
  });
});

describe('links inside a run', () => {
  it('lists no IR file that is a link, and the glossary check reads none', async () => {
    const { writeFileSync, symlinkSync, mkdtempSync: md } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { readRun } = await import('../src/glossary.mjs');
    const q = labsProject();
    const outside = join(md(join(tmpdir(), 'zukai-outside-')), 'secret.ir.json');
    writeFileSync(outside, JSON.stringify({ schemaVersion: 1, kind: 'flowchart', title: 'OUTSIDE', nodes: [], edges: [] }));
    try { symlinkSync(outside, join(q.root, 'diagrams', q.runs.checkout, 'source', 'linked.ir.json')); } catch { return; }
    expect(diagramDetail(q.root, q.runs.checkout, 'linked')).toBeUndefined();
    expect(listRuns(q.root).find((r) => r.run === q.runs.checkout).diagrams.map((d) => d.id)).not.toContain('linked');
    expect(readRun(join(q.root, 'diagrams', q.runs.checkout)).originals.map((o) => o.id)).not.toContain('linked');
  });
});
