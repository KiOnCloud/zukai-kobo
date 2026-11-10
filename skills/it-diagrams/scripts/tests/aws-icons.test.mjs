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
import { loadFixture, scriptsDir } from './helpers.mjs';

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
    const { cellOf } = await drawn(loadFixture('architecture', 'valid-aws'));
    for (const id of ['cloud', 'region', 'vpc', 'public', 'private']) expect(cellOf(id).style, id).toContain('spacingLeft=30;');
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
