/**
 * End to end, through the committed bundle and from another working directory, as an agent
 * runs it: an architecture diagram of a system on Google Cloud from its IR to every target,
 * read back, bundled and checked, and what the commands say when a name is wrong.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir, loadFixture } from './helpers.mjs';
import { checkDrawioStructure } from './drawio-structure.mjs';
import { loadPlaywright } from '../src/preview.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-gcp-cwd-'));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  const out = parse(r.stdout);
  const err = parse(r.stderr);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: out.at(-1), err: err.at(-1), warnings: err.flatMap((e) => e?.warnings ?? []), errors: [...out, ...err].flatMap((e) => e?.errors ?? []) };
};
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return file; };
const tmp = (name) => mkdtempSync(join(tmpdir(), `zukai-gcp-${name}-`));
const fixture = (name) => join(fixturesDir, 'architecture', `${name}.json`);
const SLOW = 120_000;

describe('a GCP architecture diagram through the bundle', () => {
  it('validates, and draws the draw.io file with the GCP stencils and frames, without a warning', () => {
    const dir = tmp('drawio');
    const ir = write(join(dir, 'invoicing.ir.json'), loadFixture('architecture', 'valid-gcp-invoicing'));
    const validated = cli('validate', ir);
    expect(validated.code).toBe(0);
    expect(validated.warnings).toEqual([]);
    const out = join(dir, 'invoicing.drawio');
    const r = cli('emit', '--to', 'drawio', ir, '--out', out);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, warnings: 0 });
    const xml = readFileSync(out, 'utf8');
    const { problems, cells } = checkDrawioStructure(xml);
    expect(problems).toEqual([]);
    const style = (id) => cells.find((c) => c.id === `invoicing:${id}`).style;
    expect(style('invoice-api')).toContain('shape=mxgraph.gcp2.cloud_run;');
    expect(style('invoice-db')).toContain('shape=mxgraph.gcp2.cloud_sql;');
    expect(style('invoice-topic')).toContain('shape=mxgraph.gcp2.cloud_pubsub;');
    expect(style('pdf-bucket')).toContain('shape=mxgraph.gcp2.cloud_storage;');
    expect(style('project')).toContain('fillColor=#F6F6F6;');
    expect(style('region')).toContain('fillColor=#ECEFF1;');
    expect(style('vpc')).toContain('fillColor=#E3F2FD;');
    expect(style('private-subnet')).toContain('fillColor=#EDE7F6;');
    for (const id of ['project', 'region', 'vpc', 'private-subnet']) expect(style(id), id).toContain('container=1;');
    // The same IR gives the same file, byte for byte, and the file reads as not edited by hand.
    const again = join(tmp('again'), 'invoicing.drawio');
    expect(cli('emit', '--to', 'drawio', ir, '--out', again).code).toBe(0);
    expect(readFileSync(again, 'utf8')).toBe(xml);
    expect(cli('drift', out, ir).out).toMatchObject({ ok: true, drifted: false });
  }, SLOW);

  it('draws the frame with the Google Cloud mark, and a system on both clouds with the frames of both', () => {
    const dir = tmp('multi');
    const out = join(dir, 'multi.drawio');
    const r = cli('emit', '--to', 'drawio', fixture('valid-multi-cloud'), '--out', out);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, warnings: 0 });
    const xml = readFileSync(out, 'utf8');
    expect(xml).toContain('shape=mxgraph.gcp2.google_cloud_platform;');
    expect(xml).toContain('grIcon=mxgraph.aws4.group_aws_cloud_alt;');
    expect(xml).toContain('resIcon=mxgraph.aws4.fargate;');
    expect(xml).toContain('shape=mxgraph.gcp2.bigquery;');
    expect(checkDrawioStructure(xml).problems).toEqual([]);
  }, SLOW);

  it('writes Mermaid and the FigJam text as the generic diagram, and says once per provider what was lost', () => {
    const dir = tmp('text');
    for (const target of ['mermaid', 'figjam']) {
      const out = join(dir, `${target}.mmd`);
      const r = cli('emit', '--to', target, fixture('valid-gcp'), '--out', out);
      expect(r.code, target).toBe(0);
      expect(readFileSync(out, 'utf8'), target).toContain('Order API (GKE)');
      expect(readFileSync(out, 'utf8'), target).not.toContain('gcp:');
      const lost = r.warnings.filter((w) => /\.(aws|gcp)$/.test(w.feature ?? '')).map((w) => w.feature);
      expect(lost, target).toEqual(['component.icon.gcp', 'boundary.group.gcp']);
    }
    const both = cli('emit', '--to', 'mermaid', fixture('valid-multi-cloud'), '--out', join(dir, 'both.mmd'));
    expect(both.warnings.filter((w) => /\.(aws|gcp)$/.test(w.feature ?? '')).map((w) => w.feature)).toEqual(['component.icon.aws', 'component.icon.gcp', 'boundary.group.aws', 'boundary.group.gcp']);
  }, SLOW);

  it('writes the native FigJam script with the pictures of the GCP services and the names of their stencils', () => {
    const dir = tmp('native');
    const script = join(dir, 'board.js');
    const r = cli('emit', '--to', 'figjam', fixture('valid-gcp'), '--out', join(dir, 'board.mmd'), '--native', script);
    expect(r.code).toBe(0);
    expect(existsSync(script)).toBe(true);
    const text = readFileSync(script, 'utf8');
    expect(text.length).toBeLessThanOrEqual(50000);
    const D = JSON.parse(/^const D = (.*);$/m.exec(text)[1]);
    expect(Object.keys(D.stencils).some((k) => k.startsWith('mxgraph.gcp2.cloud_sql#'))).toBe(true);
    expect(Object.keys(D.stencils).some((k) => k.startsWith('mxgraph.gcp2.google_cloud_platform#'))).toBe(true);
    expect(text).toContain('Cloud SQL for PostgreSQL [gcp:cloud_sql]');
    expect(text).toContain('VPC network 10.0.0.0/16 [gcp:vpc_network]');
  }, SLOW);

  it('reads its own draw.io file back with every GCP name, and the IR covers every text of it', () => {
    const dir = tmp('extract');
    const drawio = join(dir, 'platform.drawio');
    expect(cli('emit', '--to', 'drawio', fixture('valid-gcp'), '--out', drawio).code).toBe(0);
    const facts = join(dir, 'facts.json');
    const r = cli('extract', drawio, '--out', facts);
    expect(r.code).toBe(0);
    expect(r.out.pages[0]).toMatchObject({ nodes: 15, edges: 9, warnings: [] });
    expect(r.out.pages[0].kindHints[0].kind).toBe('architecture');
    const nodes = JSON.parse(readFileSync(facts, 'utf8')).pages[0].nodes;
    const named = Object.fromEntries(nodes.map((n) => [n.label, n.icon ?? n.group]));
    expect(named).toMatchObject({ 'Order API (GKE)': 'gcp:container_engine', 'Cloud SQL for PostgreSQL': 'gcp:cloud_sql', 'Google Cloud': 'gcp:google_cloud', 'asia-northeast1': 'gcp:region', 'VPC network 10.0.0.0/16': 'gcp:vpc_network', 'Private subnet': 'gcp:subnet' });
    const covered = cli('cover', facts, fixture('valid-gcp'));
    expect(covered.code).toBe(0);
    expect(covered.out).toMatchObject({ ok: true, missing: [] });
  }, SLOW);

  it('bundles a run of a GCP diagram and a multi-cloud one into one file, a page each', () => {
    const run = join(tmp('run'), 'diagrams', '20261117_invoicing');
    write(join(run, 'source', 'invoicing.ir.json'), loadFixture('architecture', 'valid-gcp-invoicing'));
    write(join(run, 'source', 'invoicing-01-analytics.ir.json'), loadFixture('architecture', 'valid-multi-cloud'));
    const out = join(run, 'invoicing.drawio');
    const r = cli('bundle', '--to', 'drawio', '--out', out, run);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, diagrams: 2, warnings: 0 });
    const xml = readFileSync(out, 'utf8');
    expect([...xml.matchAll(/<diagram id="([^"]+)"/g)].map((m) => m[1])).toEqual(['invoicing', 'invoicing-01-analytics']);
    expect(checkDrawioStructure(xml).problems).toEqual([]);
    expect(cli('drift', out, run).out).toMatchObject({ ok: true, drifted: false });
  }, SLOW);

  it.skipIf(!loadPlaywright(scriptsDir))('renders the draw.io file to a picture', () => {
    const dir = tmp('preview');
    const drawio = join(dir, 'zones.drawio');
    expect(cli('emit', '--to', 'drawio', fixture('valid-gcp-zones'), '--out', drawio).code).toBe(0);
    const png = join(dir, 'zones.png');
    const r = cli('preview', drawio, '--out', png);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true });
    expect(statSync(png).size).toBeGreaterThan(20000);
  }, SLOW);
});

describe('what the bundle says about a GCP diagram that is wrong', () => {
  it('exits 2 on unknown GCP names, each with the nearest names and the page that lists them, on validate and on emit', () => {
    for (const args of [['validate', fixture('invalid-gcp-unknown-names')], ['emit', '--to', 'drawio', fixture('invalid-gcp-unknown-names'), '--out', join(tmp('bad'), 'x.drawio')]]) {
      const r = cli(...args);
      expect(r.code, args[0]).toBe(2);
      expect(r.errors.map((e) => e.message), args[0]).toEqual(['unknown GCP icon "gcp:iam"', 'unknown GCP icon "gcp:cloudrun"', 'unknown GCP group frame "gcp:vpc"']);
      expect(r.errors[0].hint).toContain('did you mean gcp:cloud_iam?');
      expect(r.errors[2].hint).toContain('did you mean gcp:vpc_network?');
      for (const e of r.errors) expect(e.hint).toContain('references/gcp-icons.md');
    }
    expect(existsSync(join(cwd, 'x.drawio'))).toBe(false);
  }, SLOW);

  it('exits 2 on a provider it has no icons for, and says how a name is written', () => {
    const ir = { schemaVersion: 1, kind: 'architecture', title: 'T', components: [{ id: 'a', label: 'A', icon: 'azure:vm' }], boundaries: [{ id: 'b', label: 'B', group: 'gcp:Region', children: ['a'] }], connections: [] };
    const r = cli('validate', write(join(tmp('azure'), 'a.ir.json'), ir));
    expect(r.code).toBe(2);
    expect(r.errors.map((e) => e.path).sort()).toEqual(['/boundaries/0/group', '/components/0/icon']);
    for (const e of r.errors) expect(e.hint).toBe('write "aws:<name>" or "gcp:<name>" with a name listed in references/aws-icons.md or references/gcp-icons.md');
  }, SLOW);

  it('warns on validate when the collections of one database are drawn one by one, and keeps quiet once the user has accepted it', () => {
    const tables = ['orders', 'customers', 'invoices'].map((id) => ({ id, label: id, icon: 'gcp:cloud_firestore' }));
    const ir = { schemaVersion: 1, kind: 'architecture', title: 'T', components: [{ id: 'api', label: 'API', icon: 'gcp:cloud_run' }, ...tables], connections: tables.map((t, i) => ({ id: `c${i}`, from: 'api', to: t.id })) };
    const dir = tmp('detail');
    const r = cli('validate', write(join(dir, 'a.ir.json'), ir));
    expect(r.code).toBe(0);
    expect(r.warnings.map((w) => w.message.slice(0, 22))).toEqual(['detail: 3 components (']);
    const accepted = { ...ir, meta: { notes: ['detail accepted: "orders", "customers", "invoices" are separate databases'] } };
    expect(cli('validate', write(join(dir, 'b.ir.json'), accepted)).warnings).toEqual([]);
  }, SLOW);
});

describe('what stays as it was', () => {
  it('draws an AWS diagram with a product logo exactly as before, and says about it what it said before', () => {
    const dir = tmp('before');
    for (const name of ['valid-aws', 'valid-aws-fan-out', 'valid-aws-shared-systems']) {
      const expected = readFileSync(join(scriptsDir, 'tests', 'snapshots', 'drawio', `architecture-${name}.drawio`), 'utf8');
      // The command line names the page after the file it writes, so the file is given the name the snapshot was made under.
      const id = /<diagram id="([^"]+)"/.exec(expected)[1];
      const out = join(dir, name, `${id}.drawio`);
      mkdirSync(join(dir, name));
      expect(cli('emit', '--to', 'drawio', fixture(name), '--out', out).code, name).toBe(0);
      expect(readFileSync(out, 'utf8'), name).toBe(expected);
    }
    const r = cli('emit', '--to', 'mermaid', fixture('valid-aws-fan-out'), '--out', join(dir, 'fan.mmd'));
    expect(r.warnings.filter((w) => /\.(aws|gcp)$/.test(w.feature ?? '')).map((w) => w.feature)).toEqual(['component.icon.aws', 'boundary.group.aws']);
  }, SLOW);
});
