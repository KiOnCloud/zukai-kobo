import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeStencils, arcToCubics, shapeGeometry, libraryStencils, wantedStencils, packStencils, unpackStencils, PATH_UNIT } from '../tools/generate-stencil-paths.mjs';
import { stencilTable } from '../src/figjam-native.mjs';
import { scriptsDir } from './helpers.mjs';

const catalog = JSON.parse(readFileSync(join(scriptsDir, 'src', 'aws-icons.json'), 'utf8'));
const file = JSON.parse(readFileSync(join(scriptsDir, 'src', 'stencil-paths.json'), 'utf8'));
/** The data file as the emitter reads it: its table of stencils unpacked. */
const data = { ...file, stencils: stencilTable() };

/**
 * One small library as draw.io's stencil bundle holds it (`electrical/plc_ladder.xml` at tag
 * v32.6.10): six shapes with lines, arcs, an ellipse and both ways to paint a path.
 */
const SAMPLE = 'vVK9TtxAEP7W9v1AiBACKaLjBQ4peYX0ySMki2/PXrHeXa33OJMioqJDKdKlScQDJBU1NNRQ0EODRMflCZzxHSeCOchFEbG8M9/OfPPNjLRAkAD4QOc9nY8A+w4GBA2GgHyIiEVoRUCDNVmL3aKyjXk8Dyq4OLKz4HIJZflE2v/WZ7nVZnNsnj2jxMIfuzzGnrX3Cl5EAYsmg6zOuHK5+n9Xe4J1RpIlLs7Ci+P2+VlYDiPs/CSpexHy5Ib7Ea73o6ODcOeyfXgQ/siqKyVOd8OT3ZDs8PMcgU+HjensGo8AvXUC3/aaX/eaZO9HQA7kT37LjGJjKtlphHGS0NGXBeCqhdPFR2/VtaqrvmnU8f93BXnKrciheSaQFYnjNl0XSsTeyZirdavid4p3u8JhxATPLSWxxZ3kG0ogxWujPadQ7p3ZFAPZ9SmkToWTHgPERmsqkEbnFSYSl9oTAZYYmfCkXGAbpu/RM04kzvR1F5aTSma2BJTU4kb7tusb49cmfSe9SLISucN52/e279de1kncxVDcJaJDqNNTPIEr4LaRD4Sw40DR4YXMO854Xo0/VfhVXXiDx5s3KwilpM0FelKp+vwPzVUn1PV/AQ==';
const SAMPLE_BUNDLE = `(function() {\nvar f = Object.create(null);\nf['other.xml'] = 'AAAA';\nf['electrical/plc_ladder.xml'] = '${SAMPLE}';\n\nvar l = 1;\n})();\n`;

const numbers = (path) => path.split(' ').filter((t) => !Number.isNaN(Number(t))).map(Number);

describe('stencil decoder', () => {
  it('reads a library of the bundle back into its shapes', () => {
    const root = decodeStencils(SAMPLE);
    expect(root.name).toBe('shapes');
    expect(root.attrs).toEqual({ name: 'mxgraph.electrical.plc_ladder' });
    expect(root.children.map((s) => s.attrs.name)).toEqual(['Contact', 'Not Contact', 'Not Output 1', 'Not Output 2', 'Output 1', 'Output 2']);
    const shape = root.children[2];
    expect(shape.attrs).toEqual({ aspect: 'variable', h: '50', name: 'Not Output 1', strokewidth: 'inherit', w: '100' });
    // Coordinates are running sums in the file; they come back as the values of the stencil.
    const path = shape.children.find((c) => c.name === 'foreground').children[0];
    expect(path.children.map((c) => c.name)).toEqual(['move', 'arc', 'move', 'line', 'move', 'line', 'move', 'arc', 'move', 'line']);
    expect(path.children[0].attrs).toEqual({ x: '35', y: '0' });
    expect(path.children[1].attrs).toEqual({ 'large-arc-flag': '0', rx: '50', ry: '50', 'sweep-flag': '0', x: '35', 'x-axis-rotation': '0', y: '50' });
    expect(path.children[9].attrs).toEqual({ x: '70', y: '0' });
    // A constraint is not a drawing: its x and y are fractions, kept apart from the path coordinates.
    expect(shape.children[0].children.map((c) => c.attrs)).toEqual([{ name: 'in', perimeter: '0', x: '0', y: '0.5' }, { name: 'out', perimeter: '0', x: '1', y: '0.5' }]);
  });

  it('finds a library in the text of the bundle by its file name and names shapes as draw.io registers them', () => {
    const shapes = libraryStencils(SAMPLE_BUNDLE, 'electrical/plc_ladder.xml');
    expect([...shapes.keys()]).toEqual(['mxgraph.electrical.plc_ladder.contact', 'mxgraph.electrical.plc_ladder.not_contact', 'mxgraph.electrical.plc_ladder.not_output_1', 'mxgraph.electrical.plc_ladder.not_output_2', 'mxgraph.electrical.plc_ladder.output_1', 'mxgraph.electrical.plc_ladder.output_2']);
    expect(() => libraryStencils(SAMPLE_BUNDLE, 'missing.xml')).toThrow(/no stencil library "missing.xml"/);
  });
});

describe('stencil geometry', () => {
  it('writes what a shape paints as paths of M, L, C and Z in tenths of a unit', () => {
    const shapes = libraryStencils(SAMPLE_BUNDLE, 'electrical/plc_ladder.xml');
    expect(shapeGeometry(shapes.get('mxgraph.electrical.plc_ladder.contact'))).toEqual({ w: 100, h: 50, paint: [['s', 'M 0 250 L 300 250 M 1000 250 L 700 250 M 300 0 L 300 500 M 700 0 L 700 500']] });
    // An ellipse of the background is filled and stroked; the lines after it are only stroked.
    const coil = shapeGeometry(shapes.get('mxgraph.electrical.plc_ladder.output_2'));
    expect(coil.paint.map((p) => p[0])).toEqual(['b', 's']);
    expect(coil.paint[0][1]).toBe('M 250 250 C 250 112 362 0 500 0 C 638 0 750 112 750 250 C 750 388 638 500 500 500 C 362 500 250 388 250 250 Z');
    // The arc of a bracket becomes one curve that bulges to the side the arc bulges to.
    const bracket = shapeGeometry(shapes.get('mxgraph.electrical.plc_ladder.output_1')).paint[0][1];
    expect(bracket.startsWith('M 350 0 C 261 155 261 345 350 500 ')).toBe(true);
    expect(bracket).not.toMatch(/[AaQHV]/);
  });

  it('keeps the colours a shape names itself, a style key by its default', () => {
    const el = (name, attrs = {}, children = []) => ({ name, attrs, children });
    const square = (x) => el('path', {}, [el('move', { x, y: 0 }), el('line', { x: x + 4, y: 0 }), el('line', { x: x + 4, y: 4 }), el('close')]);
    const shape = el('shape', { w: '20', h: '10', aspect: 'fixed', strokewidth: '2' }, [el('foreground', {}, [
      square(0), el('fill'), square(5), el('fill'),
      el('save'), el('fillcolor', { color: 'fillColor2', default: '#FFCB2B' }), square(10), el('fill'), el('restore'),
      el('strokecolor', { color: 'none' }), el('rect', { x: 15, y: 0, w: 4, h: 4 }), el('fillstroke'),
    ])]);
    expect(shapeGeometry(shape)).toEqual({ w: 20, h: 10, a: 1, s: 2, paint: [
      // Two fills in the colour of the cell are one path.
      ['f', 'M 0 0 L 40 0 L 40 40 Z M 50 0 L 90 0 L 90 40 Z'],
      ['f', 'M 100 0 L 140 0 L 140 40 Z', 'ffcb2b', ''],
      ['b', 'M 150 0 L 190 0 L 190 40 L 150 40 Z', '', 'none'],
    ] });
  });

  it('closes every part of a filled path, so that a hole left open in the stencil stays a hole', () => {
    const el = (name, attrs = {}, children = []) => ({ name, attrs, children });
    const open = el('path', {}, [el('move', { x: 0, y: 0 }), el('line', { x: 9, y: 0 }), el('line', { x: 9, y: 9 }), el('move', { x: 2, y: 2 }), el('line', { x: 2, y: 5 }), el('line', { x: 5, y: 5 })]);
    const filled = el('shape', { w: '9', h: '9' }, [el('foreground', {}, [open, el('fill')])]);
    expect(shapeGeometry(filled).paint).toEqual([['f', 'M 0 0 L 90 0 L 90 90 Z M 20 20 L 20 50 L 50 50 Z']]);
    // A line that is only stroked stays open.
    const stroked = el('shape', { w: '9', h: '9' }, [el('foreground', {}, [open, el('stroke')])]);
    expect(shapeGeometry(stroked).paint).toEqual([['s', 'M 0 0 L 90 0 L 90 90 M 20 20 L 20 50 L 50 50']]);
    // The rings of the load balancer icon are such open parts in draw.io's library.
    const rings = data.stencils['mxgraph.aws4.elastic_load_balancing'].paint[0][1];
    expect(rings.split(' M ').every((part) => part.endsWith(' Z'))).toBe(true);
    for (const g of Object.values(data.stencils)) for (const [mode, path] of g.paint) if (mode === 'f') expect(path.split(' M ').every((part) => part.endsWith('Z'))).toBe(true);
  });

  it('turns an arc into curves that stay on the ellipse and end where the arc ends', () => {
    // Three quarters of a circle of radius 10 around (10, 10), clockwise on the screen from its top.
    const curves = arcToCubics(10, 0, 10, 10, 0, true, true, 0, 10);
    expect(curves.length).toBe(3);
    expect(curves.at(-1).slice(4)).toEqual([0, 10]);
    const bezier = ([x0, y0], [x1, y1, x2, y2, x3, y3], t) => {
      const u = 1 - t;
      return [u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3, u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3];
    };
    let from = [10, 0];
    for (const c of curves) {
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const [x, y] = bezier(from, c, t);
        expect(Math.abs(Math.hypot(x - 10, y - 10) - 10)).toBeLessThan(0.01);
      }
      from = c.slice(4);
    }
    // The first quarter runs to the right: clockwise.
    expect(curves[0].slice(4).map((v) => Math.round(v))).toEqual([20, 10]);
    // The other way round and the short way: one quarter, through the left.
    const short = arcToCubics(10, 0, 10, 10, 0, false, false, 0, 10);
    expect(short.length).toBe(1);
    expect(bezier([10, 0], short[0], 0.5).map((v) => Math.round(v * 10) / 10)).toEqual([2.9, 2.9]);
    // An ellipse turned a quarter has its long axis upright.
    const turned = arcToCubics(0, -20, 20, 10, 90, false, true, 0, 20);
    expect(Math.round(bezier([0, -20], turned[0], 1)[0])).toBe(10);
    // Radii too small for the distance are scaled up to a half circle instead of failing.
    const far = arcToCubics(0, 0, 1, 1, 0, false, true, 10, 0);
    expect(far.at(-1).slice(4)).toEqual([10, 0]);
    expect(far.flat().every(Number.isFinite)).toBe(true);
  });
});

describe('stencil data file', () => {
  it('holds a stencil for every name the emitters can write, from the tag of the icon catalog', () => {
    expect(data.source.tag).toBe(catalog.source.tag);
    expect(data.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.unit).toBe(PATH_UNIT);
    // The table is packed in the file; what the emitter opens is what the generator packed.
    expect(typeof file.stencils).toBe('string');
    expect(unpackStencils(file.stencils)).toEqual(data.stencils);
    expect(unpackStencils(packStencils({ a: { w: 1, h: 2, paint: [['f', 'M 0 0 Z']] } }))).toEqual({ a: { w: 1, h: 2, paint: [['f', 'M 0 0 Z']] } });
    expect(file.count).toBe(Object.keys(data.stencils).length);
    const wanted = wantedStencils(catalog);
    expect(wanted).toContain('mxgraph.aws4.cloudfront');
    expect(wanted).toContain('mxgraph.aws4.group_vpc2');
    expect(wanted).toContain('mxgraph.gcp2.firebase');
    expect(wanted).toContain('mxgraph.networks.monitor');
    expect(Object.keys(data.stencils).sort()).toEqual(wanted);
  });

  it('holds only what a Figma vector takes, inside the box of each stencil', () => {
    for (const [name, g] of Object.entries(data.stencils)) {
      expect(g.paint.length, name).toBeGreaterThan(0);
      for (const [mode, path, fill, stroke] of g.paint) {
        expect(['f', 's', 'b'], name).toContain(mode);
        expect(path, name).toMatch(/^M -?\d+ -?\d+( (M|L)( -?\d+){2}| Q( -?\d+){4}| C( -?\d+){6}| Z)+$/);
        for (const colour of [fill, stroke]) if (colour) expect(colour, name).toMatch(/^([0-9a-f]{6}|none)$/);
        const all = numbers(path).map((v) => v * data.unit);
        // A control point may lie a little outside; nothing lies far outside.
        expect(Math.min(...all), name).toBeGreaterThan(-2);
        expect(Math.max(...all.filter((_, i) => i % 2 === 0)), name).toBeLessThan(g.w + 2);
        expect(Math.max(...all.filter((_, i) => i % 2 === 1)), name).toBeLessThan(g.h + 2);
      }
    }
    // An AWS icon keeps its proportions; a product logo takes the box of its cell.
    expect(data.stencils['mxgraph.aws4.lambda'].a).toBe(1);
    expect(data.stencils['mxgraph.gcp2.firebase'].a).toBeUndefined();
    expect(data.stencils['mxgraph.gcp2.firebase'].paint.map((p) => p[2])).toEqual(['ffcb2b', 'ffa40c', 'f5820b']);
  });
});
