import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import catalog from '../src/aws-icons.json' with { type: 'json' };
import { awsIcon, awsGroup, nearestAwsNames } from '../src/aws-icons.mjs';
import { parseSidebar, buildCatalog, renderReference } from '../tools/generate-aws-icons.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { emit } from '../src/pipeline.mjs';
import { measureLabelBelow } from '../src/layout-graph.mjs';
import { checkDrawioStructure, absoluteBounds, edgePaths } from './drawio-structure.mjs';
import { loadFixture, validFixtures, scriptsDir } from './helpers.mjs';

// A short excerpt in the layout of draw.io's Sidebar-AWS4.js: two palettes that share a
// service, the groups palette, and the retired palette with its colour helper.
const SIDEBAR = `
(function()
{
	Sidebar.prototype.addAWS4Palette = function()
	{
		var pts = 'points=[[0,0],[1,1]];';
		var gn = 'mxgraph.aws4';
	};
	Sidebar.prototype.addAWS4GroupsPalette = function(s, gn, sb, pts)
	{
		var n4 = pts + 'html=1;container=1;' + mxConstants.STYLE_SHAPE + "=mxgraph.aws4.";
		this.addPaletteFunctions('aws4Groups', 'AWS / Groups', false,
		[
			 this.createVertexTemplateEntry(n4 + 'group;grIcon=' + gn + '.group_vpc2;strokeColor=#8C4FFF;',
					 s * 130, s * 130, 'VPC', 'VPC', null, null, this.getTagsForStencil(gn, 'vpc', dt).join(' ')),
			 this.createVertexTemplateEntry('fillColor=none;dashed=1;',
					 s * 130, s * 130, 'Availability Zone', 'Availability Zone', null, null, ''),
			 this.createVertexTemplateEntry('fillColor=#EFF0F3;',
					 s * 130, s * 130, 'Availability Zone', 'Availability Zone', null, null, '')
		]);
	};
	Sidebar.prototype.addAWS4ComputePalette = function(s, w, h, w2, gn, sb)
	{
		var n = 'fillColor=#ED7100;strokeColor=none;' + mxConstants.STYLE_SHAPE + "=mxgraph.aws4.";
		var n2 = 'gradientColor=none;fillColor=#ED7100;strokeColor=#ffffff;' + mxConstants.STYLE_SHAPE + "=mxgraph.aws4.";
		this.addPaletteFunctions('aws4Compute', 'AWS / Compute', false,
		[
			 this.createVertexTemplateEntry(n2 + 'resourceIcon;resIcon=' + gn + '.lambda;',
					 w2, w2, '', 'Lambda', null, null, this.getTagsForStencil(gn, 'lambda', dt).join(' ')),
			 this.createVertexTemplateEntry(n2 + 'resourceIcon;resIcon=' + gn + '.elastic_load_balancing;',
					 w2, w2, '', 'Elastic Load Balancing', null, null, ''),
			 this.createVertexTemplateEntry(n2 + 'resourceIcon;resIcon=' + gn + '.shared;',
					 w2, w2, '', 'Shared\\nService', null, null, ''),
			 this.createVertexTemplateEntry(n + 'lambda_function;',
					 s * 48, s * 48, '', 'Lambda Function', null, null, '')
		]);
	};
	Sidebar.prototype.addAWS4NetworkContentDeliveryPalette = function(s, w, h, w2, gn, sb)
	{
		var n2 = 'gradientColor=#4D72F3;fillColor=#8c4fff;strokeColor=#ffffff;' + mxConstants.STYLE_SHAPE + "=mxgraph.aws4.";
		this.addPaletteFunctions('aws4Network Content Delivery', 'AWS / Network & Content Delivery', false,
		[
			 this.createVertexTemplateEntry(n2 + 'resourceIcon;resIcon=' + gn + '.elastic_load_balancing;',
					 w2, w2, '', 'Elastic Load Balancing', null, null, ''),
			 this.createVertexTemplateEntry(n2 + 'resourceIcon;resIcon=' + gn + '.shared;',
					 w2, w2, '', 'Shared Service', null, null, '')
		]);
	};
	Sidebar.prototype.addAWS4RetiredPalette = function()
	{
		var svc = function(color)
		{
			return 'fillColor=' + color + ';' + mxConstants.STYLE_SHAPE + '=mxgraph.aws4.resourceIcon;resIcon=' + gn + '.';
		};
		this.addPaletteFunctions('aws4r', 'AWS (retired)', false,
		[
			 this.createVertexTemplateEntry(svc('#01A88D') + 'old_thing;',
					 w2, w2, '', 'Old Thing (retired)', null, null, '')
		]);
	};
})();
`;

describe('AWS catalog generator', () => {
  const { icons, groups, conflicts } = parseSidebar(SIDEBAR);

  it('reads each service icon with the fill colour of its palette, and skips resource shapes', () => {
    expect(icons.lambda).toEqual({ title: 'Lambda', category: 'Compute', fill: '#ED7100' });
    expect(icons.old_thing).toEqual({ title: 'Old Thing (retired)', category: 'AWS (retired)', fill: '#01A88D' });
    expect(icons.lambda_function).toBeUndefined();
  });

  it('keeps the first palette of a service that several list, reports the other colour, and honours the preferred category', () => {
    expect(icons.shared).toEqual({ title: 'Shared Service', category: 'Compute', fill: '#ED7100' });
    expect(conflicts).toEqual(['shared: kept #ED7100 (Compute), also #8C4FFF (Network & Content Delivery)']);
    expect(icons.elastic_load_balancing).toEqual({ title: 'Elastic Load Balancing', category: 'Network & Content Delivery', fill: '#8C4FFF', gradient: '#4D72F3' });
  });

  it('keys a group frame by its title and keeps the whole style, with the shared prefix expanded', () => {
    expect(groups.vpc).toEqual({ title: 'VPC', style: 'points=[[0,0],[1,1]];html=1;container=1;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc2;strokeColor=#8C4FFF;' });
    expect(groups.availability_zone.style).toBe('fillColor=none;dashed=1;');
    expect(groups.availability_zone_alt.style).toBe('fillColor=#EFF0F3;');
  });

  it('is deterministic: sorted keys and the source recorded', () => {
    const a = buildCatalog(SIDEBAR, 'v0').catalog;
    expect(Object.keys(a.icons)).toEqual([...Object.keys(a.icons)].sort());
    expect(a.source).toMatchObject({ repo: 'jgraph/drawio', tag: 'v0' });
    expect(a.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(buildCatalog(SIDEBAR, 'v0'))).toBe(JSON.stringify(buildCatalog(SIDEBAR, 'v0')));
  });
});

describe('committed AWS catalog', () => {
  const iconNames = Object.keys(catalog.icons);
  const groupNames = Object.keys(catalog.groups);

  it('holds the whole service icon set and the group frames, well-formed', () => {
    expect(iconNames.length).toBeGreaterThanOrEqual(300);
    expect(groupNames.length).toBeGreaterThanOrEqual(20);
    expect(catalog.source.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    for (const name of [...iconNames, ...groupNames]) expect(name).toMatch(/^[a-z0-9_]{1,64}$/);
    for (const [name, icon] of Object.entries(catalog.icons)) {
      expect(icon.fill, name).toMatch(/^#[0-9A-F]{6}$/);
      expect(icon.title, name).not.toBe('');
      expect(icon.category, name).not.toBe('');
    }
    for (const [name, group] of Object.entries(catalog.groups)) expect(group.style.endsWith(';'), name).toBe(true);
  });

  it('has the services people draw most, under the names draw.io gives them', () => {
    for (const name of ['lambda', 'ec2', 's3', 'rds', 'aurora', 'dynamodb', 'sqs', 'sns', 'api_gateway', 'cloudfront', 'route_53', 'elastic_load_balancing', 'ecs', 'eks', 'fargate', 'elasticache', 'cognito', 'secrets_manager', 'identity_and_access_management', 'key_management_service', 'cloudwatch_2', 'eventbridge', 'step_functions', 'waf']) {
      expect(awsIcon(`aws:${name}`), name).toBeDefined();
    }
    for (const name of ['aws_cloud', 'aws_account', 'region', 'availability_zone', 'vpc', 'public_subnet', 'private_subnet', 'security_group', 'auto_scaling_group']) {
      expect(awsGroup(`aws:${name}`), name).toBeDefined();
    }
    expect(awsGroup('aws:vpc').style).toContain('grIcon=mxgraph.aws4.group_vpc2;');
  });

  it('looks up own names only', () => {
    expect(awsIcon('aws:constructor')).toBeUndefined();
    expect(awsIcon('aws:toString')).toBeUndefined();
    expect(awsIcon('lambda')).toBeUndefined();
    expect(awsIcon(undefined)).toBeUndefined();
    expect(awsGroup('aws:lambda')).toBeUndefined();
  });

  it('is what the lookup reference lists, name for name', () => {
    const reference = readFileSync(join(scriptsDir, '..', 'references', 'aws-icons.md'), 'utf8');
    expect(reference).toBe(renderReference(catalog));
    const listed = [...reference.matchAll(/^\| `aws:([a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...groupNames, ...iconNames].sort());
  });

  it('suggests the catalog name for the names people guess', () => {
    expect(nearestAwsNames('icons', 'aws:iam')[0]).toBe('aws:identity_and_access_management');
    expect(nearestAwsNames('icons', 'aws:kms')[0]).toBe('aws:key_management_service');
    expect(nearestAwsNames('icons', 'aws:elb')[0]).toBe('aws:elastic_load_balancing');
    expect(nearestAwsNames('icons', 'aws:cloudwatch')[0]).toBe('aws:cloudwatch_2');
    expect(nearestAwsNames('icons', 'aws:route53')[0]).toBe('aws:route_53');
    expect(nearestAwsNames('icons', 'aws:lamda')[0]).toBe('aws:lambda');
    expect(nearestAwsNames('icons', 'aws:s3_bucket')[0]).toBe('aws:s3');
    expect(nearestAwsNames('groups', 'aws:subnet')).toEqual(['aws:public_subnet', 'aws:private_subnet']);
    expect(nearestAwsNames('icons', 'aws:xyzzy')).toEqual([]);
  });
});

describe('AWS names in an architecture IR', () => {
  const base = (components, boundaries = []) => ({ schemaVersion: 1, kind: 'architecture', title: 'T', components, boundaries, connections: [] });

  it('accepts every icon and every group frame of the catalog', () => {
    const components = Object.keys(catalog.icons).map((name, i) => ({ id: `c${i}`, label: name, icon: `aws:${name}` }));
    const boundaries = Object.keys(catalog.groups).map((name, i) => ({ id: `b${i}`, label: name, group: `aws:${name}`, children: [`c${i}`] }));
    expect(validateIr(base(components, boundaries))).toEqual({ ok: true, errors: [] });
  });

  it('reports every unknown name in one run, each with the nearest names', () => {
    const r = validateIr(loadFixture('architecture', 'invalid-aws-unknown-names'));
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => `${e.path} ${e.message}`)).toEqual([
      '/components/0/icon unknown AWS icon "aws:iam"',
      '/components/1/icon unknown AWS icon "aws:lamda"',
      '/boundaries/0/group unknown AWS group frame "aws:subnet"',
    ]);
    expect(r.errors[0].hint).toContain('did you mean aws:identity_and_access_management');
    expect(r.errors[1].hint).toContain('aws:lambda');
    expect(r.errors[2].hint).toContain('aws:public_subnet, aws:private_subnet');
    for (const e of r.errors) expect(e.hint).toContain('references/aws-icons.md');
  });

  it('rejects another provider or a malformed value with one error that says how to write it', () => {
    for (const icon of ['gcp:compute', 'lambda', 'aws:Lambda', 'aws:']) {
      const r = validateIr(base([{ id: 'a', label: 'A', icon }]));
      expect(r.errors, icon).toEqual([{ path: '/components/0/icon', message: expect.any(String), hint: 'write "aws:<name>" with a name listed in references/aws-icons.md' }]);
    }
  });

  it('does not accept the fields on another kind', () => {
    const r = validateIr({ schemaVersion: 1, kind: 'flowchart', title: 'T', nodes: [{ id: 'a', label: 'A', icon: 'aws:lambda' }], edges: [] });
    expect(r.ok).toBe(false);
  });
});

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const segmentBox = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });

/** The diagram as draw.io draws it: every figure with a label below, and that label's block. */
async function drawn(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'a' });
  expect(r.ok).toBe(true);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  const abs = absoluteBounds(cells);
  const cellOf = (id) => cells.find((x) => x.id === `a:${id}`);
  const figures = ir.components.filter((c) => c.icon || c.kind === 'client').map((c) => {
    const cell = cellOf(c.id);
    const figure = abs.get(cell.id);
    const wrap = Number(cell.style.match(/labelWidth=(\d+)/)[1]);
    return { id: c.id, icon: c.icon, cell, figure, label: { x: figure.x + figure.width / 2 - wrap / 2, y: figure.y + figure.height, width: wrap, height: measureLabelBelow(c.label).height } };
  });
  return { r, cells, abs, cellOf, figures, paths: edgePaths(cells, abs) };
}

const withDirection = (ir, direction) => ({ ...structuredClone(ir), direction });

describe('AWS icons and group frames in draw.io', () => {
  const samples = ['valid-aws', 'valid-aws-zones'];

  it('draws each icon with its stencil, the colour of its category and its name below', async () => {
    const ir = loadFixture('architecture', 'valid-aws');
    const { r, figures } = await drawn(ir);
    expect(r.warnings).toEqual([]);
    const icons = figures.filter((f) => f.icon);
    expect(icons).toHaveLength(8);
    for (const f of icons) {
      const entry = awsIcon(f.icon);
      expect(f.cell.style, f.id).toContain(`shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${entry.name};`);
      expect(f.cell.style, f.id).toContain(`fillColor=${entry.fill};`);
      expect(f.cell.style, f.id).toContain('verticalLabelPosition=bottom;verticalAlign=top;');
      expect(f.cell.style, f.id).toContain('whiteSpace=wrap;');
      expect([f.figure.width, f.figure.height], f.id).toEqual([78, 78]);
      expect(f.cell.value, f.id).toBe(ir.components.find((c) => c.id === f.id).label);
    }
    // The icon replaces the shape of the kind; a component without one keeps it.
    expect(figures.find((f) => f.id === 'db').cell.style).not.toContain('cylinder3');
    expect(figures.find((f) => f.id === 'browser').cell.style).toContain('shape=umlActor');
  });

  it('writes the gradient of the few categories draw.io draws with one', async () => {
    const name = Object.keys(catalog.icons).find((n) => catalog.icons[n].gradient);
    const { cellOf } = await drawn({ schemaVersion: 1, kind: 'architecture', title: 'T', components: [{ id: 'x', label: 'X', icon: `aws:${name}` }], connections: [] });
    expect(cellOf('x').style).toContain(`gradientColor=${catalog.icons[name].gradient};gradientDirection=north;fillColor=${catalog.icons[name].fill};`);
  });

  it('draws each group frame with the stencil and colours of draw.io\'s palette, as a container', async () => {
    const part = (style, key) => style.match(new RegExp(`(?:^|;)${key}=([^;]*)`))?.[1];
    for (const sample of samples) {
      const ir = loadFixture('architecture', sample);
      const { cellOf } = await drawn(ir);
      for (const b of ir.boundaries) {
        const style = cellOf(b.id).style;
        if (!b.group) { expect(style, b.id).toContain('swimlane;'); continue; }
        const palette = awsGroup(b.group).style;
        for (const key of ['grIcon', 'strokeColor', 'fillColor', 'fontColor', 'dashed']) expect(part(style, key), `${b.id} ${key}`).toBe(part(palette, key));
        expect(style, b.id).toContain('container=1;');
        expect(style, b.id).toContain('verticalAlign=top;');
        expect(style, b.id).not.toContain('swimlane');
      }
    }
  });

  it('draws the Auto Scaling group with its icon in the corner, like every other frame', async () => {
    const { cellOf } = await drawn(loadFixture('architecture', 'valid-aws-zones'));
    const style = cellOf('asg').style;
    expect(style).toContain('shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_auto_scaling_group;');
    expect(style).not.toContain('groupCenter');
    expect(style).not.toContain('spacingTop');
    expect(style).toMatch(/align=left;spacingLeft=\d+;/);
  });

  it('keeps every frame title clear of every connection, in every direction', async () => {
    let moved = 0;
    for (const sample of samples) for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const ir = withDirection(loadFixture('architecture', sample), direction);
      const { r, abs, cellOf, paths } = await drawn(ir);
      expect(r.warnings, `${sample} ${direction}`).toEqual([]);
      for (const b of ir.boundaries.filter((x) => x.group)) {
        const frame = abs.get(`a:${b.id}`);
        const style = cellOf(b.id).style;
        const text = measureLabelBelow(b.label, { maxWidth: 360 });
        // Where draw.io writes the title: from `spacingLeft` when it is left-aligned, else centred.
        const left = /align=left;/.test(style) ? Number(style.match(/spacingLeft=(\d+);/)[1]) : (frame.width - text.width) / 2;
        if (/align=left;spacingLeft=(\d+);/.test(style) && Number(style.match(/spacingLeft=(\d+);/)[1]) !== 30) moved++;
        const title = { x: frame.x + left, y: frame.y, width: text.width, height: text.height + 4 };
        expect(title.x + title.width, `${sample} ${direction}: title of ${b.id} inside its frame`).toBeLessThanOrEqual(frame.x + frame.width);
        for (const [id, path] of paths) for (let i = 1; i < path.length; i++) {
          expect(intersects(title, segmentBox(path[i - 1], path[i])), `${sample} ${direction}: ${id} through the title of ${b.id}`).toBe(false);
        }
      }
    }
    // The top-down sample has connections that enter frames from above: some titles had to step aside.
    expect(moved).toBeGreaterThan(0);
  });

  it('leaves a title in its usual place when nothing crosses it', async () => {
    // Only the private subnet has a line through the top where its title stands (the one to the payment provider).
    const { cellOf } = await drawn(loadFixture('architecture', 'valid-aws'));
    for (const id of ['cloud', 'region', 'vpc', 'public']) expect(cellOf(id).style, id).toContain('spacingLeft=30;');
    expect(cellOf('private').style).not.toContain('spacingLeft=30;');
  });

  it('keeps every member inside its frame, below the title, in every direction', async () => {
    for (const sample of samples) for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const ir = withDirection(loadFixture('architecture', sample), direction);
      const { abs, figures } = await drawn(ir);
      const labelOf = new Map(figures.map((f) => [f.id, f.label]));
      for (const b of ir.boundaries) {
        const frame = abs.get(`a:${b.id}`);
        const header = 30;
        const inside = { x: frame.x, y: frame.y + header, width: frame.width, height: frame.height - header };
        for (const child of b.children) {
          const where = `${sample} ${direction}: ${child} in ${b.id}`;
          expect(contains(inside, abs.get(`a:${child}`)), where).toBe(true);
          if (labelOf.has(child)) expect(contains(frame, labelOf.get(child)), `${where} (label)`).toBe(true);
        }
      }
    }
  });

  it('makes a frame wide enough for its title on one line beside the corner icon', async () => {
    const ir = { schemaVersion: 1, kind: 'architecture', title: 'T', components: [{ id: 'fn', label: 'Fn', icon: 'aws:lambda' }], boundaries: [{ id: 'vpc', label: 'Shared services VPC 10.20.0.0/16 (production)', group: 'aws:vpc', children: ['fn'] }], connections: [] };
    for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const { abs } = await drawn({ ...ir, direction });
      expect(abs.get('a:vpc').width, direction).toBeGreaterThanOrEqual(measureLabelBelow(ir.boundaries[0].label, { maxWidth: 360 }).width + 30);
      expect(abs.get('a:vpc').height, direction).toBeLessThan(200);
    }
  });

  it('lets no figure or label overlap another, and no connection run through a label', async () => {
    for (const sample of samples) for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const { figures, paths } = await drawn(withDirection(loadFixture('architecture', sample), direction));
      for (const a of figures) {
        for (const o of figures) if (o !== a) {
          expect(intersects(a.label, o.figure), `${sample} ${direction}: ${a.id} label on ${o.id}`).toBe(false);
          expect(intersects(a.label, o.label), `${sample} ${direction}: ${a.id} label on ${o.id} label`).toBe(false);
          expect(intersects(a.figure, o.figure), `${sample} ${direction}: ${a.id} on ${o.id}`).toBe(false);
        }
        for (const [id, path] of paths) for (let i = 1; i < path.length; i++) {
          expect(intersects(a.label, segmentBox(path[i - 1], path[i])), `${sample} ${direction}: ${id} through the label of ${a.id}`).toBe(false);
        }
      }
    }
  });

  // A tax API called by the second component of a chain that runs on for four more.
  const chain = {
    schemaVersion: 1, kind: 'architecture', title: 'T',
    components: [
      { id: 'users', label: 'Users', kind: 'client' }, { id: 'alb', label: 'Load balancer', icon: 'aws:elastic_load_balancing' },
      { id: 'api', label: 'Invoice API', icon: 'aws:fargate' }, { id: 'db', label: 'Database', kind: 'database', icon: 'aws:rds' },
      { id: 'queue', label: 'Queue', kind: 'queue', icon: 'aws:sqs' }, { id: 'fn', label: 'Renderer', icon: 'aws:lambda' },
      { id: 'bucket', label: 'Bucket', kind: 'database', icon: 'aws:s3' }, { id: 'tax', label: 'Tax rate API', kind: 'external' },
    ],
    boundaries: [
      { id: 'region', label: 'Region', group: 'aws:region', children: ['vpc', 'queue', 'fn', 'bucket'] },
      { id: 'vpc', label: 'VPC', group: 'aws:vpc', children: ['alb', 'api', 'db'] },
    ],
    connections: [
      { id: 'c1', from: 'users', to: 'alb' }, { id: 'c2', from: 'alb', to: 'api' }, { id: 'c3', from: 'api', to: 'db' },
      { id: 'c4', from: 'api', to: 'tax', label: 'gets tax rates' }, { id: 'c5', from: 'api', to: 'queue' },
      { id: 'c6', from: 'queue', to: 'fn' }, { id: 'c7', from: 'fn', to: 'bucket' },
    ],
  };
  // A connection that leaves a figure downwards starts under its name, on the figure's column.
  const onBox = (pt, box) => pt.x >= box.x - 0.5 && pt.x <= box.x + box.width + 0.5 && pt.y >= box.y - 0.5 && pt.y <= box.y + box.height + 60;

  it('puts a system that one component calls beside the frames, level with its caller, on one straight line', async () => {
    for (const sample of [chain, loadFixture('architecture', 'valid-aws')]) for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const ir = { ...structuredClone(sample), direction };
      const [edgeId, caller, system, outer] = sample === chain ? ['c4', 'api', 'tax', 'region'] : ['c9', 'api', 'psp', 'cloud'];
      const where = `${ir.title} ${direction}`;
      const { r, abs, cellOf, figures, paths } = await drawn(ir);
      expect(r.warnings, where).toEqual([]);
      expect([cellOf(edgeId).source, cellOf(edgeId).target], where).toEqual([`a:${caller}`, `a:${system}`]);
      // One straight line across the flow, from the caller to the system.
      const path = paths.get(`a:${edgeId}`);
      expect(path, where).toHaveLength(2);
      const across = direction === 'TB' || direction === 'BT' ? 'y' : 'x';
      expect(Math.abs(path[0][across] - path[1][across]), `${where}: straight`).toBeLessThan(0.5);
      expect(onBox(path[0], abs.get(`a:${caller}`)), `${where}: starts at the caller`).toBe(true);
      expect(onBox(path[1], abs.get(`a:${system}`)), `${where}: ends at the system`).toBe(true);
      // The system stands outside the outermost frame, and the line runs through no other component or name.
      const box = abs.get(`a:${system}`);
      expect(intersects(box, abs.get(`a:${outer}`)), `${where}: outside the frames`).toBe(false);
      const line = segmentBox(path[0], path[1]);
      for (const c of ir.components) {
        if (c.id === caller || c.id === system) continue;
        expect(intersects(line, abs.get(`a:${c.id}`)), `${where}: line through ${c.id}`).toBe(false);
        expect(intersects(box, abs.get(`a:${c.id}`)), `${where}: system on ${c.id}`).toBe(false);
      }
      for (const f of figures) if (f.id !== caller) expect(intersects(line, f.label), `${where}: line through the name of ${f.id}`).toBe(false);
      // It runs along no stretch of another connection.
      for (const [id, other] of paths) {
        if (id === `a:${edgeId}`) continue;
        for (let i = 1; i < other.length; i++) {
          const seg = segmentBox(other[i - 1], other[i]);
          const parallel = across === 'y' ? seg.height < 0.5 : seg.width < 0.5;
          if (parallel) expect(intersects({ x: line.x - 5, y: line.y - 5, width: line.width + 10, height: line.height + 10 }, { ...seg, width: seg.width + 0.1, height: seg.height + 0.1 }), `${where}: along ${id}`).toBe(false);
        }
      }
    }
  });

  it('stands a store beside the component that uses it, so the connection that goes on stays clear of it', async () => {
    for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const { r, abs, cellOf, figures, paths } = await drawn({ ...structuredClone(chain), direction });
      expect(r.warnings, direction).toEqual([]);
      const api = figures.find((f) => f.id === 'api');
      const db = figures.find((f) => f.id === 'db');
      const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      // Across the flow: under the API on its column when the flow runs sideways, level with it to the right when it runs down or up.
      if (direction === 'LR' || direction === 'RL') {
        expect(Math.abs(centre(db.figure).x - centre(api.figure).x), direction).toBeLessThan(1);
        expect(db.figure.y, direction).toBeGreaterThan(api.label.y + api.label.height);
      } else {
        expect(Math.abs(centre(db.figure).y - centre(api.figure).y), direction).toBeLessThan(1);
        expect(db.figure.x, direction).toBeGreaterThan(api.figure.x + api.figure.width);
      }
      // One straight line joins them, from the API to the database.
      expect([cellOf('c3').source, cellOf('c3').target], direction).toEqual(['a:api', 'a:db']);
      const line = paths.get('a:c3');
      expect(line, direction).toHaveLength(2);
      expect(Math.min(Math.abs(line[0].x - line[1].x), Math.abs(line[0].y - line[1].y)), direction).toBeLessThan(0.5);
      // Both stay inside their frame, and no other connection comes near the database or its name.
      for (const box of [db.figure, db.label]) expect(contains(abs.get('a:vpc'), box), `${direction}: db in the VPC`).toBe(true);
      const around = (b) => ({ x: b.x - 20, y: b.y - 20, width: b.width + 40, height: b.height + 40 });
      for (const [id, path] of paths) {
        if (id === 'a:c3') continue;
        for (let i = 1; i < path.length; i++) {
          const seg = segmentBox(path[i - 1], path[i]);
          for (const box of [db.figure, db.label]) expect(intersects(around(box), { ...seg, width: seg.width + 0.1, height: seg.height + 0.1 }), `${direction}: ${id} near db`).toBe(false);
        }
      }
    }
  });

  it('keeps a store in the flow when its user passes nothing on, or when it is not the only one', async () => {
    // Nothing leaves the API but the line to the database: the database is simply the next step.
    const only = { schemaVersion: 1, kind: 'architecture', title: 'T', direction: 'LR', components: [{ id: 'api', label: 'API', icon: 'aws:fargate' }, { id: 'db', label: 'DB', kind: 'database', icon: 'aws:rds' }], boundaries: [{ id: 'vpc', label: 'VPC', group: 'aws:vpc', children: ['api', 'db'] }], connections: [{ id: 'c', from: 'api', to: 'db' }] };
    const one = await drawn(only);
    expect(one.abs.get('a:db').x).toBeGreaterThan(one.abs.get('a:api').x + 78);
    // Two stores: the first stands beside the API, the second keeps its place in the flow.
    const two = structuredClone(chain);
    two.components.push({ id: 'cache', label: 'Cache', kind: 'cache', icon: 'aws:elasticache' });
    two.boundaries[1].children.push('cache');
    two.connections.push({ id: 'c9', from: 'api', to: 'cache' });
    const both = await drawn({ ...two, direction: 'LR' });
    expect(both.r.warnings).toEqual([]);
    expect(Math.abs(both.abs.get('a:db').x - both.abs.get('a:api').x)).toBeLessThan(1);
    expect(both.abs.get('a:cache').x).toBeGreaterThan(both.abs.get('a:api').x + 78);
  });

  it('keeps a caller outside the frames where the flow starts, however deep the frames nest', async () => {
    const groups = ['aws:aws_account', 'aws:region', 'aws:vpc', 'aws:public_subnet'];
    const before = { LR: (a, b) => a.x + a.width <= b.x, TB: (a, b) => a.y + a.height <= b.y, RL: (a, b) => a.x >= b.x + b.width, BT: (a, b) => a.y >= b.y + b.height };
    for (const depth of [1, 4]) for (const label of [undefined, 'HTTPS']) for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const frames = ['f1', 'f2', 'f3', 'f4'].slice(0, depth);
      const ir = {
        schemaVersion: 1, kind: 'architecture', title: 'T', direction,
        components: [{ id: 'u', label: 'Users', kind: 'client' }, { id: 'a', label: 'Load balancer', icon: 'aws:elastic_load_balancing' }],
        boundaries: frames.map((f, i) => ({ id: f, label: `Frame ${i}`, group: groups[i], children: [i === depth - 1 ? 'a' : frames[i + 1]] })),
        connections: [{ id: 'c', from: 'u', to: 'a', ...(label ? { label } : {}) }],
      };
      const { abs } = await drawn(ir);
      expect(before[direction](abs.get('a:u'), abs.get('a:f1')), `depth ${depth} ${label ?? 'no label'} ${direction}`).toBe(true);
    }
  });

  it('writes a label inside a tinted frame on the colour of that frame, and any other label on white', async () => {
    const { cells } = await drawn(loadFixture('architecture', 'valid-aws'));
    const style = (id) => cells.find((c) => c.id === `a:${id}:label`).style;
    const subnet = /fillColor=(#[0-9A-Fa-f]{6});/.exec(awsGroup('aws:private_subnet').style)[1];
    // API to Aurora and API to the cache both run inside the private subnet.
    expect(style('c5')).toContain(`labelBackgroundColor=${subnet};`);
    expect(style('c6')).toContain(`labelBackgroundColor=${subnet};`);
    // Browser to CloudFront lies outside every frame; CloudFront to S3 in a frame without a fill.
    expect(style('c1')).not.toContain('labelBackgroundColor');
    expect(style('c2')).not.toContain('labelBackgroundColor');
  });

  it('writes no connection label across a frame border, on a component, a name or another label', async () => {
    // Where draw.io puts a label: its place along the drawn line, moved by its offset.
    const labelBox = (cell, path, text) => {
      const lengths = path.slice(1).map((p, i) => Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y));
      const total = lengths.reduce((s, l) => s + l, 0);
      let along = ((Number(cell.mxGeometry.x) + 1) / 2) * total;
      let i = 0;
      while (i < lengths.length - 1 && along > lengths[i]) along -= lengths[i++];
      const t = lengths[i] === 0 ? 0 : along / lengths[i];
      const at = { x: path[i].x + t * (path[i + 1].x - path[i].x), y: path[i].y + t * (path[i + 1].y - path[i].y) };
      const offset = cell.mxGeometry.mxPoint?.[0] ?? { x: 0, y: 0 };
      const width = text.length * 6.2 + 4;
      const align = /align=(left|right|center)/.exec(cell.style)[1];
      const x = at.x + Number(offset.x) - (align === 'center' ? width / 2 : align === 'right' ? width : 0);
      return { x, y: at.y + Number(offset.y) - 8, width, height: 16 };
    };
    const long = structuredClone(loadFixture('architecture', 'valid-aws-invoicing'));
    long.connections = long.connections.map((c) => (c.id === 'alb-to-api' ? { ...c, label: 'container api:8080' } : c));
    for (const ir of [loadFixture('architecture', 'valid-aws'), loadFixture('architecture', 'valid-aws-zones'), loadFixture('architecture', 'valid-aws-invoicing'), long]) for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const { cells, abs, figures, paths } = await drawn({ ...structuredClone(ir), direction });
      const where = `${ir.title} ${direction}`;
      const boxes = [];
      for (const c of ir.connections) {
        const cell = cells.find((x) => x.id === `a:${c.id}:label`);
        if (!cell) continue;
        const box = labelBox(cell, paths.get(`a:${c.id}`), c.label);
        boxes.push({ id: c.id, box });
        for (const b of ir.boundaries.filter((x) => x.group)) {
          const frame = abs.get(`a:${b.id}`);
          const inside = contains(frame, box);
          expect(inside || !intersects(box, frame), `${where}: label of ${c.id} across the border of ${b.id}`).toBe(true);
        }
        for (const part of ir.components) expect(intersects(box, abs.get(`a:${part.id}`)), `${where}: label of ${c.id} on ${part.id}`).toBe(false);
        for (const f of figures) expect(intersects(box, f.label), `${where}: label of ${c.id} on the name of ${f.id}`).toBe(false);
      }
      for (const a of boxes) for (const b of boxes) if (a !== b) expect(intersects(a.box, b.box), `${where}: labels of ${a.id} and ${b.id}`).toBe(false);
    }
  });

  it('keeps a client as near the frames with a label on its connection as without one', async () => {
    const groups = ['aws:aws_account', 'aws:region', 'aws:vpc', 'aws:public_subnet'];
    const make = (direction, label) => ({
      schemaVersion: 1, kind: 'architecture', title: 'T', direction,
      components: [{ id: 'u', label: 'Users', kind: 'client' }, { id: 'a', label: 'Load balancer', icon: 'aws:elastic_load_balancing' }],
      boundaries: groups.map((g, i) => ({ id: `f${i}`, label: `Frame ${i}`, group: g, children: [i === 3 ? 'a' : `f${i + 1}`] })),
      connections: [{ id: 'c', from: 'u', to: 'a', ...(label ? { label } : {}) }],
    });
    const gap = (abs, direction) => {
      const u = abs.get('a:u'); const f = abs.get('a:f0');
      return { LR: f.x - (u.x + u.width), RL: u.x - (f.x + f.width), TB: f.y - (u.y + u.height), BT: u.y - (f.y + f.height) }[direction];
    };
    for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const plain = await drawn(make(direction));
      const labelled = await drawn(make(direction, 'HTTPS'));
      expect(labelled.r.warnings, direction).toEqual([]);
      expect(gap(labelled.abs, direction), direction).toBe(gap(plain.abs, direction));
      // The label is written, and it stands before the outermost frame.
      const label = labelled.cells.find((c) => c.id === 'a:c:label');
      expect(label?.value, direction).toBe('HTTPS');
    }
    // A label too long for that stretch of a left-to-right line gets its own room from the layout, as before.
    const long = await drawn(make('LR', 'HTTPS with mutual TLS and a client certificate'));
    expect(gap(long.abs, 'LR')).toBeGreaterThan(gap((await drawn(make('LR'))).abs, 'LR'));
  });

  it('keeps a system with several callers, or one that calls in, in the flow', async () => {
    const two = structuredClone(chain);
    two.connections.push({ id: 'c8', from: 'fn', to: 'tax' });
    const { r, paths } = await drawn({ ...two, direction: 'LR' });
    expect(r.warnings).toEqual([]);
    expect(paths.get('a:c4').length + paths.get('a:c8').length).toBeGreaterThan(4);
    const caller = structuredClone(chain);
    caller.connections = caller.connections.map((c) => (c.id === 'c4' ? { ...c, from: 'tax', to: 'api' } : c));
    const drawnCaller = await drawn({ ...caller, direction: 'LR' });
    // A system that calls in stands where the flow starts, before the frames.
    expect(drawnCaller.abs.get('a:tax').x + drawnCaller.abs.get('a:tax').width).toBeLessThanOrEqual(drawnCaller.abs.get('a:region').x);
  });

  it('puts a system with several callers at the nearer end of the frames, with the arrows still pointing the way the IR says', async () => {
    const two = structuredClone(chain);
    two.connections.push({ id: 'c8', from: 'alb', to: 'tax' });
    const before = { LR: (a, b) => a.x + a.width <= b.x, TB: (a, b) => a.y + a.height <= b.y, RL: (a, b) => a.x >= b.x + b.width, BT: (a, b) => a.y >= b.y + b.height };
    for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const { r, abs, cellOf, paths } = await drawn({ ...two, direction });
      expect(r.warnings, direction).toEqual([]);
      expect(before[direction](abs.get('a:tax'), abs.get('a:region')), `${direction}: at the start of the flow`).toBe(true);
      for (const [id, from] of [['c4', 'api'], ['c8', 'alb']]) {
        expect([cellOf(id).source, cellOf(id).target], direction).toEqual([`a:${from}`, 'a:tax']);
        expect(onBox(paths.get(`a:${id}`)[0], abs.get(`a:${from}`)), `${direction}: ${id} starts at ${from}`).toBe(true);
        expect(onBox(paths.get(`a:${id}`).at(-1), abs.get('a:tax')), `${direction}: ${id} ends at the tax API`).toBe(true);
      }
    }
  });

  it('leaves a system outside the frames where the flow puts it when it has a figure of its own', async () => {
    const ir = { schemaVersion: 1, kind: 'architecture', title: 'T', direction: 'LR', components: [{ id: 'u', label: 'User', kind: 'client' }, { id: 'api', label: 'API', icon: 'aws:lambda' }, { id: 'ext', label: 'Partner', kind: 'client' }], boundaries: [{ id: 'vpc', label: 'VPC', group: 'aws:vpc', children: ['api'] }], connections: [{ id: 'c1', from: 'u', to: 'api' }, { id: 'c2', from: 'api', to: 'ext' }] };
    const { abs } = await drawn(ir);
    expect(abs.get('a:ext').x).toBeGreaterThanOrEqual(abs.get('a:vpc').x + abs.get('a:vpc').width);
    expect(abs.get('a:u').x + abs.get('a:u').width).toBeLessThanOrEqual(abs.get('a:vpc').x);
  });

  it('lines up the figures of one frame on a centre line', async () => {
    const { figures } = await drawn(withDirection(loadFixture('architecture', 'valid-aws'), 'TB'));
    const centre = (id) => { const f = figures.find((x) => x.id === id).figure; return f.x + f.width / 2; };
    const ir = { schemaVersion: 1, kind: 'architecture', title: 'T', components: [{ id: 'u', label: 'A user with a long name', kind: 'client' }, { id: 'fn', label: 'Fn', icon: 'aws:lambda' }], boundaries: [{ id: 'b', label: 'B', children: ['u', 'fn'] }], connections: [{ id: 'c', from: 'u', to: 'fn' }] };
    const mixed = await drawn(ir);
    const c = (id) => { const f = mixed.figures.find((x) => x.id === id).figure; return f.x + f.width / 2; };
    expect(c('u')).toBe(c('fn'));
    expect(Number.isInteger(centre('api'))).toBe(true);
  });
});

describe('AWS icons on the targets that cannot draw them', () => {
  const strip = (ir) => ({ ...ir, components: ir.components.map(({ icon, ...c }) => c), boundaries: ir.boundaries.map(({ group, ...b }) => b) });

  for (const target of ['mermaid', 'figjam']) {
    it(`${target}: draws the generic diagram and says once what was lost`, async () => {
      for (const sample of ['valid-aws', 'valid-aws-zones']) {
        const ir = loadFixture('architecture', sample);
        const r = await emit(ir, target);
        expect(r.ok, sample).toBe(true);
        expect(r.output, sample).toBe((await emit(strip(ir), target)).output);
        const lost = r.warnings.filter((w) => /\.aws$/.test(w.feature ?? ''));
        expect(lost.map((w) => [w.feature, w.path]), sample).toEqual([['component.icon.aws', '/components'], ['boundary.group.aws', '/boundaries']]);
        expect(lost[0].message).toContain('no AWS icons');
      }
    });
  }

  it('drawio: no warning', async () => {
    const r = await emit(loadFixture('architecture', 'valid-aws'), 'drawio');
    expect(r.warnings).toEqual([]);
  });
});

/**
 * The same measures on any architecture diagram: how many bends a connection has, whether a
 * line runs through a component or its name that it does not belong to, and how much of a
 * frame its members fill.
 */
async function layoutMeasures(ir) {
  const { r, cells, abs, paths } = await drawn(ir);
  const parts = ir.components.map((c) => {
    const cell = cells.find((x) => x.id === `a:${c.id}`);
    const box = abs.get(cell.id);
    const wrap = /labelWidth=(\d+)/.exec(cell.style)?.[1];
    return { id: cell.id, box, name: wrap ? { x: box.x + box.width / 2 - wrap / 2, y: box.y + box.height, width: Number(wrap), height: measureLabelBelow(c.label).height } : undefined };
  });
  let bends = 0;
  let through = 0;
  for (const [id, path] of paths) {
    bends += path.length - 2;
    const line = cells.find((c) => c.id === id);
    for (let i = 1; i < path.length; i++) {
      const seg = segmentBox(path[i - 1], path[i]);
      const thick = { ...seg, width: seg.width + 0.6, height: seg.height + 0.6 };
      const inside = (b) => thick.x < b.x + b.width - 0.5 && b.x < thick.x + thick.width - 0.5 && thick.y < b.y + b.height - 0.5 && b.y < thick.y + thick.height - 0.5;
      for (const part of parts) if (part.id !== line.source && part.id !== line.target && (inside(part.box) || (part.name && inside(part.name)))) through++;
    }
  }
  const fills = (ir.boundaries ?? []).map((b) => {
    const frame = abs.get(`a:${b.id}`);
    return b.children.reduce((sum, k) => sum + abs.get(`a:${k}`).width * abs.get(`a:${k}`).height, 0) / (frame.width * frame.height);
  });
  // How much of the whole drawing the components and their names take.
  const all = [...abs.values()];
  const width = Math.max(...all.map((b) => b.x + b.width)) - Math.min(...all.map((b) => b.x));
  const height = Math.max(...all.map((b) => b.y + b.height)) - Math.min(...all.map((b) => b.y));
  const ink = parts.reduce((sum, part) => sum + part.box.width * part.box.height + (part.name ? part.name.width * part.name.height : 0), 0);
  return { warnings: r.warnings.length, bendsPerConnection: bends / Math.max(1, paths.size), through, leastFilledFrame: fills.length ? Math.min(...fills) : undefined, pageFill: ink / (width * height), connections: paths.size };
}

describe('AWS architecture diagrams against the plain architecture diagrams of this repository', () => {
  it('are drawn no worse on the same measures, sideways and downwards', async () => {
    const architecture = validFixtures().filter((f) => f.kind === 'architecture');
    const usesAws = (ir) => ir.components.some((c) => c.icon) || (ir.boundaries ?? []).some((b) => b.group);
    const measured = [];
    for (const { name, ir } of architecture) for (const direction of ['LR', 'TB']) {
      measured.push({ name, direction, aws: usesAws(ir), ...(await layoutMeasures({ ...structuredClone(ir), direction })) });
    }
    const plain = measured.filter((m) => !m.aws);
    const aws = measured.filter((m) => m.aws);
    expect(aws.length).toBeGreaterThanOrEqual(6);
    expect(plain.length).toBeGreaterThanOrEqual(10);
    const mean = (list, key) => list.reduce((s, m) => s + m[key], 0) / list.length;
    const framed = (list) => list.filter((m) => m.leastFilledFrame !== undefined);
    // No line through a component or a name it does not belong to, and no layout warning: as in the plain diagrams.
    for (const m of measured) {
      expect(m.through, `${m.name} ${m.direction}`).toBe(0);
      expect(m.warnings, `${m.name} ${m.direction}`).toBe(0);
    }
    // Connections bend no more than in the plain diagrams, on average.
    expect(mean(aws, 'bendsPerConnection')).toBeLessThanOrEqual(mean(plain, 'bendsPerConnection'));
    // No AWS frame is emptier than the emptiest frame of a plain diagram.
    const emptiestPlain = Math.min(...framed(plain).map((m) => m.leastFilledFrame));
    for (const m of framed(aws)) expect(m.leastFilledFrame, `${m.name} ${m.direction}`).toBeGreaterThanOrEqual(emptiestPlain);
    // The drawing as a whole is as full as the plain diagrams that have frames and at least as
    // many connections as the smallest AWS one (a three-component diagram is fuller by nature).
    const smallest = Math.min(...aws.map((m) => m.connections));
    const comparable = framed(plain).filter((m) => m.connections >= smallest);
    expect(comparable.length).toBeGreaterThanOrEqual(4);
    expect(mean(aws, 'pageFill')).toBeGreaterThanOrEqual(mean(comparable, 'pageFill'));
    expect(mean(framed(aws), 'leastFilledFrame')).toBeGreaterThanOrEqual(0.95 * mean(framed(plain), 'leastFilledFrame'));
  });
});
