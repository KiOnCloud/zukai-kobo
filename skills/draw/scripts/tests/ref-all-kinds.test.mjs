import { describe, it, expect } from 'vitest';
import { emit, bundle } from '../src/pipeline.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { relabelDrawio } from '../src/relabel.mjs';
import { checkDrawioStructure } from './drawio-structure.mjs';
import { loadFixture } from './helpers.mjs';

/**
 * The element of each kind that stands for a collapsed part of the main diagram, in the
 * `valid-ref-parts` fixture of that kind: where it is in the IR, its cell in draw.io, and the
 * label it carries.
 */
const CARRIERS = [
  { kind: 'sequence', path: '/messages/0/ref', cell: 'm1', label: 'loadOrders(request)', edge: true },
  { kind: 'state', path: '/states/2/ref', cell: 'paying', label: 'Paying' },
  { kind: 'architecture', path: '/components/1/ref', cell: 'api', label: 'Order API' },
  { kind: 'class', path: '/classes/0/ref', cell: 'order', label: 'Order' },
  { kind: 'er', path: '/entities/0/ref', cell: 'customer', label: 'CUSTOMER' },
];
const PART = 'order-sync-01-load';
const part = () => ({ id: PART, ir: { ...loadFixture('flowchart', 'valid-refund-check'), title: 'Load the orders of one shop' } });
const main = (kind) => ({ id: 'main', ir: loadFixture(kind, 'valid-ref-parts') });

describe('ref on the element that a sub-diagram details, for every kind', () => {
  it('is part of the schema for a message, a state, a component, a class and an entity', () => {
    for (const { kind } of CARRIERS) expect(validateIr(loadFixture(kind, 'valid-ref-parts')), kind).toEqual({ ok: true, errors: [] });
  });

  it('is still refused where no element stands for a part, and on a state that has no label to carry it', () => {
    const seq = loadFixture('sequence', 'valid-ref-parts');
    seq.participants[0].ref = PART;
    seq.blocks[0].ref = PART;
    expect(validateIr(seq).errors.map((e) => `${e.path} ${e.message}`)).toEqual(['/blocks/0 unknown property "ref"', '/participants/0 unknown property "ref"']);
    const state = loadFixture('state', 'valid-ref-parts');
    state.states[0].ref = PART;
    const r = validateIr(state);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([expect.objectContaining({ path: '/states/0/ref', message: 'state "start" is an initial state and cannot carry a ref' })]);
    const bad = loadFixture('class', 'valid-ref-parts');
    bad.classes[0].ref = 'Not A Slug';
    expect(validateIr(bad).errors[0].path).toBe('/classes/0/ref');
  });

  for (const c of CARRIERS) {
    describe(c.kind, () => {
      it('shows the title of the part and links to its page in a draw.io bundle', async () => {
        const r = await bundle([main(c.kind), part()], 'drawio', { title: 'Order sync' });
        expect(r.ok).toBe(true);
        const { problems, cells } = checkDrawioStructure(r.output);
        expect(problems).toEqual([]);
        const cell = cells.find((x) => x.id === `main:${c.cell}`);
        expect(cell.value.endsWith(`${c.label}<br>↳ Load the orders of one shop`), cell.value).toBe(true);
        expect(cell.link).toBe(`data:page/id,${PART}`);
        expect(cell[c.edge ? 'edge' : 'vertex']).toBe('1');
        expect(r.output).not.toContain(`↳ ${PART}`);
        expect(r.warnings.filter((w) => w.path === c.path)).toEqual([]);
        expect(r.warnings.filter((w) => String(w.message).startsWith('layout:'))).toEqual([]);
      });

      it('shows the title in the Markdown bundle, the slug in a single emit, and warns when the part is not bundled', async () => {
        const md = await bundle([main(c.kind), part()], 'mermaid', { title: 'Order sync' });
        expect(md.ok).toBe(true);
        expect(md.output).toContain(`${c.label}${c.kind === 'architecture' ? ' ' : '<br/>'}↳ Load the orders of one shop`);
        expect(md.warnings.filter((w) => w.path === c.path)).toEqual([]);
        for (const to of ['drawio', 'mermaid']) {
          const single = await emit(main(c.kind).ir, to, { diagramId: 'main' });
          expect(single.ok, to).toBe(true);
          expect(single.output, to).toContain(`↳ ${PART}`);
          expect(single.warnings.filter((w) => w.path === c.path), to).toEqual([]);
          const alone = await bundle([main(c.kind)], to);
          const w = alone.warnings.filter((x) => x.path === c.path);
          expect(w, to).toHaveLength(1);
          expect(w[0].message, to).toContain(`ref "${PART}" is not in this bundle`);
        }
      });
    });
  }

  it('gives a sequence message with a ref a taller row, so the title line stands above its own arrow', async () => {
    const withRef = loadFixture('sequence', 'valid-ref-parts');
    const plain = structuredClone(withRef);
    for (const m of plain.messages) delete m.ref;
    const y = async (ir) => {
      const { cells } = checkDrawioStructure((await emit(ir, 'drawio', { diagramId: 's' })).output);
      return (id) => Number(cells.find((c) => c.id === `s:${id}`).mxGeometry.Array.mxPoint[0].y);
    };
    const a = await y(withRef);
    const b = await y(plain);
    // m1 carries a ref: its arrow, and everything below it, moves down by one label line.
    expect(a('m1') - b('m1')).toBe(16);
    expect(a('m2') - b('m2')).toBe(16);
    // m3 (a self-message, drawn with two waypoints) carries the second ref.
    expect(a('m4') - b('m4')).toBe(32);
  });

  it('grows a class or entity header by one line for the title, and a composite state header too', async () => {
    const startSize = (xml, id) => Number(xml.match(new RegExp(`id="${id}"[^>]*>\\s*<mxCell style="[^"]*startSize=(\\d+)`))?.[1] ?? xml.match(new RegExp(`<mxCell id="${id}"[^>]*startSize=(\\d+)`))[1]);
    const cls = (await emit(loadFixture('class', 'valid-ref-parts'), 'drawio', { diagramId: 'c' })).output;
    expect(startSize(cls, 'c:order')).toBe(46);
    expect(startSize(cls, 'c:rule')).toBe(66);
    const er = (await emit(loadFixture('er', 'valid-ref-parts'), 'drawio', { diagramId: 'e' })).output;
    expect(startSize(er, 'e:customer')).toBe(46);
    expect(startSize(er, 'e:order')).toBe(26);
    const st = (await emit(loadFixture('state', 'valid-ref-parts'), 'drawio', { diagramId: 't' })).output;
    expect(startSize(st, 't:fulfil')).toBe(46);
  });

  it('grows those headers further when a long title wraps, so the text stays above the first row', async () => {
    const long = { id: PART, ir: { ...part().ir, title: 'Load, validate and reconcile the orders of one shop against the warehouse stock ledger' } };
    for (const [kind, id, twoLines] of [['class', 'order', 46], ['er', 'customer', 46], ['state', 'fulfil', 46]]) {
      const ir = structuredClone(loadFixture(kind, 'valid-ref-parts'));
      for (const el of ir.classes ?? ir.entities ?? ir.states) if (el.ref) el.ref = PART;
      const r = await bundle([{ id: 'main', ir }, long], 'drawio');
      const { problems, cells } = checkDrawioStructure(r.output);
      expect(problems).toEqual([]);
      const cell = cells.find((c) => c.id === `main:${id}`);
      const header = Number(cell.style.match(/startSize=(\d+)/)[1]);
      // The title line alone is about 88 characters: it cannot fit one line of a box this wide.
      expect(Number(cell.mxGeometry.width), kind).toBeLessThan(7 * 88);
      expect(header, kind).toBeGreaterThan(twoLines);
    }
  });

  it('names the ref, not the label, when the title of the part has characters architecture-beta cannot show', async () => {
    const odd = { id: PART, ir: { ...part().ir, title: 'Load [orders] {shop}' } };
    const r = await bundle([main('architecture'), odd], 'mermaid');
    expect(r.output).toContain('[Order API ↳ Load orders shop]');
    const w = r.warnings.filter((x) => String(x.message).includes('architecture-beta cannot show'));
    expect(w.map((x) => x.path)).toEqual(['/components/1/ref']);
    expect(w[0].message).toContain(`the title that ref "${PART}" shows on "api"`);
  });

  it('writes the ref on the same line where the profile has no line break (FigJam, architecture-beta)', async () => {
    const figjam = await emit(loadFixture('sequence', 'valid-ref-parts'), 'figjam');
    expect(figjam.output).toContain(`loadOrders(request) ↳ ${PART}`);
    const arch = await emit(loadFixture('architecture', 'valid-ref-parts'), 'mermaid');
    expect(arch.output).toContain('architecture-beta');
    expect(arch.output).toContain(`[Order API ↳ ${PART}]`);
  });

  it('relabel keeps the title line of a linked message and follows a new page title', async () => {
    const r = await bundle([main('sequence'), part()], 'drawio', { title: 'Order sync' });
    const out = relabelDrawio(r.output, { 'main:m1': 'tải đơn hàng (yêu cầu)', [`${PART}:title`]: 'Tải đơn hàng của một cửa hàng' });
    const { problems, cells } = checkDrawioStructure(out.output);
    expect(problems).toEqual([]);
    const cell = cells.find((x) => x.id === 'main:m1');
    expect(cell.value).toBe('tải đơn hàng (yêu cầu)<br>↳ Tải đơn hàng của một cửa hàng');
    expect(cell.link).toBe(`data:page/id,${PART}`);
  });
});
