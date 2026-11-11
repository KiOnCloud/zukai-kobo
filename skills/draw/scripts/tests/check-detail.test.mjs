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
});
