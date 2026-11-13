import { describe, it, expect } from 'vitest';
import { checkDetail } from '../src/check-detail.mjs';
import { emit } from '../src/pipeline.mjs';
import { validFixtures } from './helpers.mjs';

const diagram = (components, connections) => ({ schemaVersion: 1, kind: 'architecture', title: 'T', components, connections });
const labelled = (label) => diagram([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], [{ id: 'c', from: 'a', to: 'b', label }]);

describe('level of detail of an architecture diagram', () => {
  it('reports the stores of one kind that one component alone uses, once, naming them', () => {
    const tables = ['orders', 'customers', 'invoices'].map((id) => ({ id, label: id, kind: 'database', icon: 'aws:dynamodb' }));
    const ir = diagram([{ id: 'api', label: 'API' }, ...tables], tables.map((t, i) => ({ id: `c${i}`, from: 'api', to: t.id })));
    const { warnings } = checkDetail(ir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toBe('/components/1');
    expect(warnings[0].message).toContain('3 components ("orders", "customers", "invoices")');
    expect(warnings[0].message).toContain('only "api" uses');
    expect(warnings[0].hint).toContain('one component');
  });

  it('leaves alone stores that differ in kind or user, two of a kind, and components that are not stores', () => {
    const store = (id, extra = {}) => ({ id, label: id, kind: 'database', ...extra });
    const from = (to, i, by = 'api') => ({ id: `c${i}`, from: by, to });
    // Two stores of one kind.
    expect(checkDetail(diagram([{ id: 'api', label: 'API' }, store('a'), store('b')], [from('a', 0), from('b', 1)])).warnings).toEqual([]);
    // Three stores, each of another service.
    const mixed = [store('a', { icon: 'aws:dynamodb' }), store('b', { icon: 'aws:s3' }), store('c', { icon: 'aws:aurora' })];
    expect(checkDetail(diagram([{ id: 'api', label: 'API' }, ...mixed], mixed.map((m, i) => from(m.id, i)))).warnings).toEqual([]);
    // Three stores of one kind, one of them shared with a second service: separate resources.
    const shared = [store('a'), store('b'), store('c')];
    expect(checkDetail(diagram([{ id: 'api', label: 'API' }, { id: 'job', label: 'Job' }, ...shared], [...shared.map((m, i) => from(m.id, i)), from('c', 9, 'job')])).warnings).toEqual([]);
    // Three functions behind one gateway are three deployed units.
    const fns = ['f1', 'f2', 'f3'].map((id) => ({ id, label: id, icon: 'aws:lambda' }));
    expect(checkDetail(diagram([{ id: 'gw', label: 'Gateway' }, ...fns], fns.map((f, i) => from(f.id, i, 'gw')))).warnings).toEqual([]);
  });

  it('counts a component as a store by its database or storage icon, whatever its kind', () => {
    const tables = ['orders', 'customers', 'invoices'].map((id) => ({ id, label: id, icon: 'aws:dynamodb' }));
    const ir = diagram([{ id: 'api', label: 'API' }, ...tables], tables.map((t, i) => ({ id: `c${i}`, from: 'api', to: t.id })));
    const { warnings } = checkDetail(ir);
    expect(warnings.map((w) => w.path)).toEqual(['/components/1']);
    expect(warnings[0].message).toContain('3 components ("orders", "customers", "invoices") are stores of one kind that only "api" uses');
    const buckets = ['raw', 'clean', 'archive'].map((id) => ({ id, label: id, kind: 'service', icon: 'aws:s3' }));
    const s3 = diagram([{ id: 'etl', label: 'ETL' }, ...buckets], buckets.map((b, i) => ({ id: `c${i}`, from: 'etl', to: b.id })));
    expect(checkDetail(s3).warnings.map((w) => w.path)).toEqual(['/components/1']);
  });

  it('reports a plain boundary that holds only components of one icon or one store kind', () => {
    const fargate = diagram([{ id: 'api1', label: 'API', icon: 'aws:fargate' }, { id: 'api2', label: 'Worker', icon: 'aws:fargate' }], []);
    fargate.boundaries = [{ id: 'b-api', label: 'Order API', children: ['api1', 'api2'] }];
    const { warnings } = checkDetail(fargate);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toBe('/boundaries/0');
    expect(warnings[0].message).toBe('detail: boundary "b-api" holds only 2 components of one kind ("api1", "api2"); a boundary groups what shares a network, an account or an owner, never the parts of one resource');
    expect(warnings[0].hint).toContain('drop the boundary');
    const caches = diagram([{ id: 'x', label: 'X' }, { id: 'k1', label: 'K1', kind: 'cache' }, { id: 'k2', label: 'K2', kind: 'cache' }], []);
    caches.boundaries = [{ id: 'b-x', label: 'X', children: ['x'] }, { id: 'b-cache', label: 'Cache', children: ['k1', 'k2'] }];
    expect(checkDetail(caches).warnings.map((w) => w.path)).toEqual(['/boundaries/1']);
  });

  it('leaves alone a boundary with an AWS frame, mixed icons, a nested boundary, or plain clients and services', () => {
    const withBoundary = (components, boundaries) => ({ ...diagram(components, []), boundaries });
    const fargate = (id) => ({ id, label: id, icon: 'aws:fargate' });
    // Two services in one subnet frame share a network.
    expect(checkDetail(withBoundary([fargate('a'), fargate('b')], [{ id: 'sn', label: 'Private subnet', group: 'aws:private_subnet', children: ['a', 'b'] }])).warnings).toEqual([]);
    // Children of mixed icons, or an icon beside none.
    expect(checkDetail(withBoundary([fargate('a'), { id: 'b', label: 'b', icon: 'aws:lambda' }], [{ id: 'g', label: 'G', children: ['a', 'b'] }])).warnings).toEqual([]);
    expect(checkDetail(withBoundary([fargate('a'), { id: 'b', label: 'b' }], [{ id: 'g', label: 'G', children: ['a', 'b'] }])).warnings).toEqual([]);
    // A boundary that also holds a boundary.
    expect(checkDetail(withBoundary([fargate('a'), fargate('b'), fargate('c')], [{ id: 'inner', label: 'I', children: ['c'] }, { id: 'outer', label: 'O', children: ['a', 'b', 'inner'] }])).warnings).toEqual([]);
    // Two iconless clients, or two iconless services: an owner or a team.
    for (const kind of ['client', 'service']) {
      expect(checkDetail(withBoundary([{ id: 'a', label: 'a', kind }, { id: 'b', label: 'b', kind }], [{ id: 'g', label: 'G', children: ['a', 'b'] }])).warnings, kind).toEqual([]);
    }
    // One child alone is not a group of parts.
    expect(checkDetail(withBoundary([fargate('a')], [{ id: 'g', label: 'G', children: ['a'] }])).warnings).toEqual([]);
  });

  it('reports connection labels numbered as steps once for the diagram, naming them all', () => {
    for (const [first, second] of [['1. activate', '2. mark syncing'], ['1) read', '2) write'], ['(1) read', '(2) write'], ['[1] read', '[12] write'], ['1: read', '2: write'], ['① read', '⑳ write']]) {
      const ir = diagram([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], [{ id: 'c0', from: 'a', to: 'b', label: 'HTTPS' }, { id: 'c1', from: 'a', to: 'b', label: first }, { id: 'c2', from: 'b', to: 'a', label: second }]);
      const { warnings } = checkDetail(ir);
      expect(warnings.map((w) => w.path), first).toEqual(['/connections/1/label']);
      expect(warnings[0].message, first).toBe('detail: 2 connection labels start with a step number ("c1", "c2"); an architecture diagram shows how the parts reach each other, not the order of calls');
      expect(warnings[0].hint, first).toContain('`ref`');
    }
  });

  it('leaves alone one numbered label and labels that only start with a number', () => {
    expect(checkDetail(labelled('1. activate')).warnings).toEqual([]);
    const plain = ['HTTP :8080', 'HTTP/2', 'TLS 1.3, end-to-end', '443', '3.5 GB cache', '2 replicas', '1.5 Gbps', '10 GB'];
    const ir = diagram([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], plain.map((label, i) => ({ id: `c${i}`, from: 'a', to: 'b', label })));
    expect(checkDetail(ir).warnings).toEqual([]);
  });

  it('reports a diagram that draws a resource in parts and numbers its calls, one warning per breach', () => {
    const tableIds = ['users', 'devices', 'readings', 'alerts', 'syncs', 'settings'];
    const tables = tableIds.map((id) => ({ id, label: id, kind: 'database', icon: 'aws:dynamodb' }));
    const ir = diagram(
      [{ id: 'app', label: 'App', kind: 'client' }, { id: 'api', label: 'API', icon: 'aws:fargate' }, { id: 'worker', label: 'Sync worker', icon: 'aws:fargate' }, ...tables],
      [
        { id: 'c1', from: 'app', to: 'api', label: '1. trigger' },
        { id: 'c2', from: 'api', to: 'worker', label: '2. gửi yêu cầu' },
        ...tables.map((t, i) => ({ id: `c${i + 3}`, from: 'worker', to: t.id, label: `${i + 3}. mark as syncing` })),
      ],
    );
    ir.boundaries = [{ id: 'b-db', label: 'DynamoDB', children: tableIds }, { id: 'b-api', label: 'Order API', children: ['api', 'worker'] }];
    const { warnings } = checkDetail(ir);
    expect(warnings.map((w) => w.path)).toEqual(['/boundaries/0', '/boundaries/1', '/connections/0/label']);
    expect(warnings[0].message).toContain('boundary "b-db" holds only 6 components of one kind');
    expect(warnings[1].message).toContain('boundary "b-api" holds only 2 components of one kind ("api", "worker")');
    expect(warnings[2].message).toContain('8 connection labels start with a step number');
    expect(warnings.some((w) => w.message.includes('are stores of one kind'))).toBe(false);
  });

  it('reports a connection labelled with an endpoint, a job or a field', () => {
    for (const [label, what] of [
      ['REST + SignalR /hubs/imageProcessing', 'an endpoint path'],
      ['GET /api/v1/orders', 'an endpoint path'],
      ['batch-job/sync-orders', 'a job or resource path'],
      ['write version, latestSyncDate', 'a field or method name'],
      ['organization/schema', 'a resource or data path'],
      ['sync-orders-to-billing', 'the name of a job or a route'],
      ['HTTPS, orders/invoices', 'a resource or data path'],
    ]) {
      const { warnings } = checkDetail(labelled(label));
      expect(warnings.map((w) => w.path), label).toEqual(['/connections/0/label']);
      expect(warnings[0].message, label).toContain(`reads as ${what}`);
      expect(warnings[0].message, label).toContain(`"${label}"`);
    }
  });

  it('accepts the labels an infrastructure connection carries', () => {
    for (const label of ['HTTPS', 'HTTP :8080', 'HTTP/2', 'gRPC', 'mTLS', 'TCP/IP', 'read / write', 'read/write', 'pub/sub', 'request/response', 'publish/subscribe', 'upload/download', 'active/passive', 'metrics/logs', 'point-in-time restore', 'site-to-site VPN', 'at-least-once delivery', 'replication to ap-northeast-3', 'TLS 1.3, end-to-end', 'read-only', 'multi-az failover', 'pull image', 'access logs', '/api', '/user-avatar/*, /tv-app/*', 'publish OrderPaid', 'container api:8080', 'HTTPS + webhook', 'PostgreSQL wire protocol', 'OAuth2', 'WebSocket', 'đọc / ghi']) {
      expect(checkDetail(labelled(label)).warnings, label).toEqual([]);
    }
  });

  it('looks at architecture diagrams only, and finds nothing in the fixtures of this repository', () => {
    expect(checkDetail({ kind: 'flowchart', nodes: [], edges: [{ id: 'e', from: 'a', to: 'b', label: '/api/v1/orders' }] }).warnings).toEqual([]);
    for (const { name, ir } of validFixtures()) expect(checkDetail(ir).warnings, name).toEqual([]);
  });

  it('is part of every emit: the warnings come back with the output, whatever the target', async () => {
    for (const target of ['drawio', 'mermaid', 'figjam']) {
      const r = await emit(labelled('GET /api/v1/orders'), target);
      expect(r.ok, target).toBe(true);
      const detail = r.warnings.filter((w) => w.stage === 'detail');
      expect(detail, target).toHaveLength(1);
      expect(detail[0].message, target).toMatch(/^detail: /);
    }
  });

  it('reports a connection labelled with a SQL statement, not one named in plain words', () => {
    for (const label of ['INSERT INTO orders', 'SELECT * FROM users', 'UPDATE orders SET status', 'DELETE FROM carts']) {
      expect(checkDetail(labelled(label)).warnings.map((w) => w.message).join('\n'), label).toMatch(/reads as a database statement/);
    }
    for (const label of ['SQL', 'Update stock', 'read / write']) expect(checkDetail(labelled(label)).warnings, label).toEqual([]);
  });
});
