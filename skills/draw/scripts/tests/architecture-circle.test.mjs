/**
 * A circle of connections in an architecture diagram: a topic that pushes back to the service
 * that publishes to it. The connection listed last closes the circle and is the one drawn
 * against the flow; everything listed before it keeps the direction of the diagram, and a
 * system outside the frames keeps its side. One sample per cloud, held to the measures of the
 * other cloud samples.
 */
import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { closingEdges, measureLabelBelow } from '../src/layout-graph.mjs';
import { checkDrawioStructure, absoluteBounds, edgePaths } from './drawio-structure.mjs';
import { loadFixture } from './helpers.mjs';

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const segmentBox = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
const DIRECTIONS = ['LR', 'TB', 'RL', 'BT'];

async function drawn(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'a' });
  expect(r.ok).toBe(true);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  const abs = absoluteBounds(cells);
  const figures = ir.components.filter((c) => c.icon).map((c) => {
    const cell = cells.find((x) => x.id === `a:${c.id}`);
    const figure = abs.get(cell.id);
    const wrap = Number(cell.style.match(/labelWidth=(\d+)/)[1]);
    return { id: c.id, figure, label: { x: figure.x + figure.width / 2 - wrap / 2, y: figure.y + figure.height, width: wrap, height: measureLabelBelow(c.label).height } };
  });
  return { r, cells, abs, figures, paths: edgePaths(cells, abs) };
}

/** How far along the flow the middle of a box lies: larger is later, whatever the direction. */
const along = (box, direction) => {
  const v = direction === 'LR' || direction === 'RL' ? box.x + box.width / 2 : box.y + box.height / 2;
  return direction === 'RL' || direction === 'BT' ? -v : v;
};

const SAMPLES = [
  { name: 'valid-gcp-topic-circle', flow: ['scheduler', 'invoice-api', 'invoice-events', 'invoice-worker'], back: 'c-topic-api', outside: 'payment-api', caller: 'invoice-worker', first: 'scheduler' },
  { name: 'valid-aws-topic-circle', flow: ['gateway', 'order-api', 'order-events', 'fulfilment'], back: 'c-topic-api', outside: 'carrier', caller: 'fulfilment', first: 'gateway' },
];

describe('the connection that closes a circle', () => {
  it('is the one whose target already leads to its source over the connections before it', () => {
    const edges = [{ id: 'a', from: 'api', to: 'topic' }, { id: 'b', from: 'topic', to: 'worker' }, { id: 'c', from: 'topic', to: 'api' }, { id: 'd', from: 'worker', to: 'api' }, { id: 'self', from: 'api', to: 'api' }];
    expect([...closingEdges(edges)]).toEqual(['c', 'd']);
    // Listed the other way round, the other connection of the pair closes the circle.
    expect([...closingEdges([edges[2], edges[0], edges[1]])]).toEqual(['a']);
    expect([...closingEdges(edges.slice(0, 2))]).toEqual([]);
  });

  for (const sample of SAMPLES) {
    describe(sample.name, () => {
      const fixture = loadFixture('architecture', sample.name);

      it('keeps the connections listed before it in the direction of the diagram, in every direction', async () => {
        for (const direction of DIRECTIONS) {
          const ir = { ...structuredClone(fixture), direction };
          const { r, abs, paths } = await drawn(ir);
          expect(r.warnings, direction).toEqual([]);
          const at = (id) => along(abs.get(`a:${id}`), direction);
          for (let i = 1; i < sample.flow.length; i++) expect(at(sample.flow[i]), `${direction}: ${sample.flow[i]} after ${sample.flow[i - 1]}`).toBeGreaterThan(at(sample.flow[i - 1]));
          // Every connection but the closing one runs with the flow or across it, never against it.
          for (const c of ir.connections) {
            const path = paths.get(`a:${c.id}`);
            const run = along({ ...path.at(-1), width: 0, height: 0 }, direction) - along({ ...path[0], width: 0, height: 0 }, direction);
            if (c.id === sample.back) expect(run, `${direction}: ${c.id} leads back`).toBeLessThan(0);
            else expect(run, `${direction}: ${c.id}`).toBeGreaterThanOrEqual(-1);
          }
        }
      }, 120000);

      it('leaves the system outside the frames on the side of its caller, not where the flow starts', async () => {
        for (const direction of DIRECTIONS) {
          const ir = { ...structuredClone(fixture), direction };
          const { abs } = await drawn(ir);
          const at = (id) => along(abs.get(`a:${id}`), direction);
          expect(at(sample.outside), direction).toBeGreaterThan(at(sample.first));
          expect(at(sample.outside), direction).toBeGreaterThanOrEqual(at(sample.caller) - 1);
        }
      }, 120000);

      it('gives the same picture wherever the closing connection is listed after the way out', async () => {
        const moved = structuredClone(fixture);
        const back = moved.connections.findIndex((c) => c.id === sample.back);
        const out = moved.connections.findIndex((c) => c.id === 'c-api-topic');
        moved.connections.splice(out + 1, 0, ...moved.connections.splice(back, 1));
        const a = await drawn(fixture);
        const b = await drawn(moved);
        for (const c of fixture.components) expect(b.abs.get(`a:${c.id}`), c.id).toEqual(a.abs.get(`a:${c.id}`));
      }, 60000);

      it('holds to the measures of the other cloud samples: members in their frames, nothing on anything else', async () => {
        for (const direction of DIRECTIONS) {
          const ir = { ...structuredClone(fixture), direction };
          const { cells, abs, figures, paths } = await drawn(ir);
          const labelOf = new Map(figures.map((f) => [f.id, f.label]));
          for (const b of ir.boundaries) {
            const frame = abs.get(`a:${b.id}`);
            const inside = { x: frame.x, y: frame.y + 30, width: frame.width, height: frame.height - 30 };
            for (const child of b.children) {
              expect(contains(inside, abs.get(`a:${child}`)), `${direction}: ${child} in ${b.id}`).toBe(true);
              if (labelOf.has(child)) expect(contains(frame, labelOf.get(child)), `${direction}: label of ${child} in ${b.id}`).toBe(true);
            }
          }
          for (const f of figures) {
            for (const o of figures) if (o !== f) {
              expect(intersects(f.figure, o.figure), `${direction}: ${f.id} on ${o.id}`).toBe(false);
              expect(intersects(f.label, o.figure), `${direction}: label of ${f.id} on ${o.id}`).toBe(false);
              expect(intersects(f.label, o.label), `${direction}: label of ${f.id} on label of ${o.id}`).toBe(false);
            }
            for (const [id, path] of paths) for (let i = 1; i < path.length; i++) {
              expect(intersects(f.label, segmentBox(path[i - 1], path[i])), `${direction}: ${id} through the label of ${f.id}`).toBe(false);
            }
          }
          for (const [id, path] of paths) {
            const line = cells.find((c) => c.id === id);
            for (let i = 1; i < path.length; i++) {
              const seg = segmentBox(path[i - 1], path[i]);
              const thick = { x: seg.x + 0.5, y: seg.y + 0.5, width: Math.max(0.1, seg.width - 1), height: Math.max(0.1, seg.height - 1) };
              for (const c of ir.components) if (`a:${c.id}` !== line.source && `a:${c.id}` !== line.target) expect(intersects(thick, abs.get(`a:${c.id}`)), `${direction}: ${id} through ${c.id}`).toBe(false);
            }
          }
        }
      }, 120000);
    });
  }
});

describe('the line drawn back against the flow', () => {
  // A synced invoicing run: the topic pushes back to the API, which also writes to the
  // database, so the two figures have a different number of lines on their facing sides.
  const invoicing = () => ({"schemaVersion": 1, "kind": "architecture", "title": "Invoicing system on Google Cloud", "direction": "LR", "components": [{"id": "scheduler", "label": "Cloud Scheduler nightly-reminders", "icon": "gcp:scheduled_tasks"}, {"id": "invoice-api", "label": "invoice-api (Cloud Run)", "icon": "gcp:cloud_run"}, {"id": "invoice-events", "label": "Pub/Sub invoice-events", "kind": "queue", "icon": "gcp:cloud_pubsub"}, {"id": "invoice-worker", "label": "invoice-worker (Cloud Run)", "icon": "gcp:cloud_run"}, {"id": "invoices-pg", "label": "Cloud SQL invoices-pg\n(PostgreSQL 16)", "kind": "database", "icon": "gcp:cloud_sql"}, {"id": "invoice-pdfs", "label": "Cloud Storage invoice-pdfs (EU)", "kind": "database", "icon": "gcp:cloud_storage"}, {"id": "secrets", "label": "Secret Manager (3 secrets)"}, {"id": "payment-api", "label": "Payment API", "kind": "external", "icon": "gcp:application"}], "boundaries": [{"id": "project", "label": "Project invoicing-prod", "group": "gcp:project", "children": ["region"]}, {"id": "region", "label": "europe-west1", "group": "gcp:region", "children": ["scheduler", "invoice-api", "invoice-events", "invoice-worker", "invoice-pdfs", "secrets", "vpc"]}, {"id": "vpc", "label": "VPC network invoicing-vpc", "group": "gcp:vpc_network", "children": ["invoices-pg"]}], "connections": [{"id": "c-scheduler-api", "from": "scheduler", "to": "invoice-api", "label": "HTTP POST (OIDC)"}, {"id": "c-api-topic", "from": "invoice-api", "to": "invoice-events", "label": "publish"}, {"id": "c-topic-worker", "from": "invoice-events", "to": "invoice-worker", "label": "push"}, {"id": "c-topic-api", "from": "invoice-events", "to": "invoice-api", "label": "push"}, {"id": "c-api-db", "from": "invoice-api", "to": "invoices-pg", "label": "SQL"}, {"id": "c-worker-db", "from": "invoice-worker", "to": "invoices-pg", "label": "SQL"}, {"id": "c-worker-pdfs", "from": "invoice-worker", "to": "invoice-pdfs", "label": "write objects"}, {"id": "c-api-secrets", "from": "invoice-api", "to": "secrets", "label": "read secret"}, {"id": "c-worker-secrets", "from": "invoice-worker", "to": "secrets", "label": "read secrets"}, {"id": "c-worker-payment", "from": "invoice-worker", "to": "payment-api", "label": "HTTPS"}]});

  it('runs straight from figure to figure where its ends can be brought level, with no step in the middle', async () => {
    const ir = invoicing();
    const { r, paths, abs } = await drawn(ir);
    expect(r.warnings).toEqual([]);
    const back = paths.get('a:c-topic-api');
    expect(back).toHaveLength(2);
    expect(back[0].y).toBeCloseTo(back[1].y, 0);
    // Both ends stay on their figures, and apart from the other ends on the same sides.
    for (const [id, end] of [['invoice-events', back[0]], ['invoice-api', back[1]]]) {
      const f = abs.get(`a:${id}`);
      expect(end.y, id).toBeGreaterThan(f.y);
      expect(end.y, id).toBeLessThan(f.y + f.height);
    }
    const forward = paths.get('a:c-api-topic');
    expect(Math.abs(forward[0].y - back[1].y)).toBeGreaterThanOrEqual(10);
    expect(Math.abs(forward.at(-1).y - back[0].y)).toBeGreaterThanOrEqual(10);
    // The way out keeps the side of the back line it had: below it.
    expect(forward[0].y).toBeGreaterThan(back[1].y);
  });
});
