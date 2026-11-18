import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import catalog from '../src/aws-icons.json' with { type: 'json' };
import { PROVIDERS, cloudIcon, cloudGroup, cloudAlias, cloudAliases, cloudNameElsewhere, suggestCloudNames, nearestCloudNames, providerOf, isProductLogo, isStoreIcon } from '../src/aws-icons.mjs';
import { parseGcp, buildCatalog, renderGcpReference } from '../tools/generate-aws-icons.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { emit } from '../src/pipeline.mjs';
import { checkDetail } from '../src/check-detail.mjs';
import { extractDrawio } from '../src/extract-drawio.mjs';
import { figjamNative } from '../src/figjam-native.mjs';
import { measureLabelBelow } from '../src/layout-graph.mjs';
import { checkDrawioStructure, absoluteBounds, edgePaths } from './drawio-structure.mjs';
import { loadFixture, scriptsDir, scriptData } from './helpers.mjs';

// A short excerpt in the layout of draw.io's Sidebar-GCP2.js: the zones palette with a zone, a
// white zone, the nested frames of the project legend and the project frame with the mark; a
// product palette and an icon palette that give titles their category; the helpers that hold
// the colours and sizes; a service card and a device card.
const LEGEND = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
  + '<mxCell id="2" value="Project Zone / Cloud Service Provider" style="shape=rect;strokeColor=none;fillColor=#F6F6F6;verticalAlign=top;fontSize=10;spacingLeft=10;spacing=0;" vertex="1" parent="1"><mxGeometry width="530" height="490" as="geometry"/></mxCell>'
  + '<mxCell id="3" value="Logical Grouping of Services / Instances" style="shape=rect;strokeColor=none;fillColor=#E3F2FD;verticalAlign=top;fontSize=10;spacingLeft=10;spacing=0;" vertex="1" parent="2"><mxGeometry width="250" height="180" as="geometry"/></mxCell>'
  + '<mxCell id="4" value="Zone" style="shape=rect;strokeColor=none;fillColor=#FFF3E0;" vertex="1" parent="3"><mxGeometry width="230" height="120" as="geometry"/></mxCell>'
  + '<mxCell id="5" value="SubNetwork" style="shape=rect;strokeColor=none;fillColor=#EDE7F6;" vertex="1" parent="4"><mxGeometry width="210" height="60" as="geometry"/></mxCell>'
  + '<mxCell id="10" value="Zone" style="shape=rect;strokeColor=none;fillColor=#000000;" vertex="1" parent="2"><mxGeometry width="230" height="250" as="geometry"/></mxCell>'
  + '</root></mxGraphModel>';
const packed = deflateRawSync(Buffer.from(encodeURIComponent(LEGEND))).toString('base64');
const SIDEBAR = `
(function()
{
	Sidebar.prototype.addGCP2ZonesPalette = function()
	{
		var s = 'sketch=0;rounded=1;absoluteArcSize=1;arcSize=2;strokeColor=none;spacing=10;spacingTop=-4;';
		var fns = [
		    this.createVertexTemplateEntry(s + 'fillColor=#ffffff;',
		    		120, 70, 'User 1', 'User 1 (Default)', null, null, this.getTagsForStencil(gn, '', dt + 'user').join(' ')),
		    this.createVertexTemplateEntry(s + 'fillColor=#EFEBE9;',
		    		120, 200, 'colo / dc /\\non-premises', 'colo / dc / on-premises', null, null, this.getTagsForStencil(gn, '', dt).join(' ')),
		    this.createVertexTemplateEntry(s + 'fillColor=#E0F2F1;',
		    		120, 75, 'Partner\\nzone', 'Partner zone', null, null, this.getTagsForStencil(gn, '', dt).join(' ')),
			this.addDataEntry(dt + 'project cloud service provider', 530, 490, 'Project Zone / Cloud Service Provider', '${packed}'),
			this.addEntry(dt + 'project', function()
		   	{
			    var bg = new mxCell('<b>Google </b>Cloud Platform', new mxGeometry(0, 0, 650, 350),
			    		'fillColor=#F6F6F6;strokeColor=none;fontSize=14;align=left;spacing=10;fontColor=#717171;9E9E9E;verticalAlign=top;spacingTop=-4;spacingLeft=40;');
		    	bg.vertex = true;
			    var zone1Cell = new mxCell('',
			    		new mxGeometry(0, 0, 23, 20),
			    		'shape=mxgraph.gcp2.google_cloud_platform;fillColor=#F6F6F6;strokeColor=none;');
			    zone1Cell.geometry.relative = true;
			    zone1Cell.geometry.offset = new mxPoint(20, 10);
		    	bg.insert(zone1Cell);
			   	return sb.createVertexTemplateFromCells([bg], bg.geometry.width, bg.geometry.height, 'Project Zone');
			})
	 	];
		this.addPalette('gcp2Zones', 'GCP / Zones', false, mxUtils.bind(this, function(content) {}));
	};
	Sidebar.prototype.addGCP2ServiceCardsPalette = function()
	{
		this.addGCP2ServiceCard('Bucket', 'bucket', 100, 44, dt + 'bucket', fns);
		this.addGCP2ServiceCard('Blank One Line', 'blank', 100, 44, dt, fns);
		this.addPalette('gcp2Service Cards', 'GCP / Service Cards', false, mxUtils.bind(this, function(content) {}));
	};
	Sidebar.prototype.addGCP2ComputePalette = function()
	{
		this.addGCP2UserProductCardSet('Kubernetes\\nEngine', 140, 180, 60, 26, 30, dt + 'gke', fns, icon);
		this.addGCP2UserProductCardSet('Cloud Run', 140, 180, 60, 26, 30, dt, fns, icon);
		this.addPalette('gcp2Compute', 'GCP / Compute', false, mxUtils.bind(this, function(content) {}));
	};
	Sidebar.prototype.addGCP2DatabasesPalette = function()
	{
		this.addGCP2UserProductCardSet('Cloud SQL', 140, 180, 60, 26, 30, dt, fns, icon);
		this.addPalette('gcp2Databases', 'GCP / Databases', false, mxUtils.bind(this, function(content) {}));
	};
	Sidebar.prototype.addGCP2UserDeviceCardsPalette = function()
	{
		this.addGCP2UserDeviceCard('Laptop', 'laptop', 1, 0.66, 0, dt + 'laptop', fns);
		this.addGCP2UserDeviceCard('Phone', 'phone', 0.64, 1, 0, dt + 'phone', fns);
		this.addGCP2UserDeviceCard('Firebase', 'firebase', 1, 1, 0, dt, fns);
		this.addPalette('gcp2User Device Cards', 'GCP / User and Device Cards', false, mxUtils.bind(this, function(content) {}));
	};
	Sidebar.prototype.addGCP2ProductCardsPalette = function()
	{
		this.addGCP2ProductCardSet('Firebase', 'firebase', 0.72, 1, 100, 130, dt + 'firebase', fns);
	};
	Sidebar.prototype.addGCP2IconsCICDPalette = function()
	{
		var fns = [
		    this.createVertexTemplateEntry(n + 'image=data:image/svg+xml,AAAA;',
		    		s * 42, s * 42, 'Container\\nRegistry', null, null, null, this.getTagsForStencil(gn, '', dt).join(' '))
	 	];
		this.addPalette('gcp2Icons CI CD', 'GCP Icons / CI/CD', false, mxUtils.bind(this, function(content) {}));
	};
	Sidebar.prototype.addGCP2CardSet = function(label, icon, w1, w2, dt, fns)
	{
		var s = 'sketch=0;fillColor=#5184F3;strokeColor=none;' + mxConstants.STYLE_SHAPE + '=mxgraph.gcp2.hexIcon;prIcon=';
			    var icon1 = new mxCell(label, new mxGeometry(0, 0.5, 44, 39), s + icon + ';part=1;');
	};
	Sidebar.prototype.addGCP2ProductCardSet = function(label, icon, scaleX, scaleY, w1, w2, dt, fns)
	{
		var s = 'sketch=0;fillColor=#5184F3;strokeColor=none;' + mxConstants.STYLE_SHAPE + '=mxgraph.gcp2.';
	};
	Sidebar.prototype.addGCP2ServiceCard = function(label, icon, w, h, dt, fns)
	{
		var s = 'sketch=0;fillColor=#757575;strokeColor=none;' + mxConstants.STYLE_SHAPE + '=mxgraph.gcp2.';
			    var icon1 = new mxCell(label, new mxGeometry(0, 0.5, 32, 32), s + icon + ';part=1;');
	};
	Sidebar.prototype.addGCP2UserDeviceCard = function(label, icon, scaleX, scaleY, h1, dt, fns)
	{
		var s = 'sketch=0;fillColor=#757575;strokeColor=none;' + mxConstants.STYLE_SHAPE + '=mxgraph.gcp2.';
			    var icon1 = new mxCell('', new mxGeometry(0.5, 0, 50 * scaleX, 50 * scaleY), s + icon + ';part=1;');
	};
})();
`;
// The property of the hexagon shape that lists the service stencils, as mxGCP2.js writes it.
const SHAPES = `
mxShapeGCP2HexIcon.prototype.customProperties = [
	{name: 'prType', dispName: 'Instance Type', defVal: 'standard', type: 'enum',
		enumList: [{val: 'standard', dispName: 'Standard'},
				   {val: 'dynamic', dispName: 'Dynamic'}]},
	{name: 'prIcon', dispName: 'Instance Icon', defVal: 'compute_engine', type: 'enum',
			enumList: [{val: 'container_engine', dispName: 'Kubernetes Engine'},
				       {val: 'cloud_run', dispName: 'Cloud Run'},
				       {val: 'cloud_sql', dispName: 'Cloud SQL'},
				       {val: 'cloud_deployment_manager', dispName: 'Monitoring'},
				       {val: 'cloud_deployment_manager', dispName: 'Deployment Manager'},
				       {val: 'container_registry', dispName: 'Container Registry'},
				       {val: 'gpu', dispName: 'GPU'},
				       {val: 'placeholder', dispName: 'Cloud Console'}]}
];
`;

describe('GCP catalog generator', () => {
  const { icons, groups } = parseGcp(SIDEBAR, SHAPES.replace("{val: 'cloud_deployment_manager', dispName: 'Monitoring'},", '').replace("{val: 'cloud_deployment_manager', dispName: 'Deployment Manager'},", ''));

  it('reads each service icon of the hexagon shape with the palette colour, at the width of an AWS icon', () => {
    expect(icons.cloud_run).toEqual({ title: 'Cloud Run', category: 'Compute', fill: '#5184F3', width: 78, height: 69 });
    // The stencil keeps an older name; the title is the one the shape lists for it.
    expect(icons.container_engine).toMatchObject({ title: 'Kubernetes Engine', category: 'Compute' });
    expect(icons.cloud_sql.category).toBe('Databases');
    // An instance type is not an icon, and the placeholder stands for no service.
    expect(icons.standard).toBeUndefined();
    expect(icons.placeholder).toBeUndefined();
  });

  it('takes the category from the palette that lists the title, one name for a category two palettes name differently, else from its own table', () => {
    expect(icons.container_registry.category).toBe('CI - CD');
    expect(icons.gpu.category).toBe('Compute');
    expect(() => parseGcp(SIDEBAR, SHAPES)).toThrow(/no category for the GCP service icon "cloud_deployment_manager" \(Monitoring, Deployment Manager\)/);
  });

  it('reads the resource figures in grey, smaller than a service icon, with the proportions of the palette', () => {
    expect(icons.bucket).toEqual({ title: 'Bucket', category: 'Service Cards', fill: '#757575', width: 57, height: 57 });
    expect(icons.laptop).toEqual({ title: 'Laptop', category: 'User and Device Cards', fill: '#757575', width: 57, height: 38 });
    expect(icons.phone).toMatchObject({ width: 36, height: 57 });
    expect(icons.blank).toBeUndefined();
  });

  it('names the frames of the zones palette and of the project legend, each with the whole style of the palette', () => {
    expect(Object.keys(groups).sort()).toEqual(['google_cloud', 'logical_group', 'on_premises', 'partner_zone', 'project', 'subnet', 'vpc_network', 'zone']);
    expect(groups.on_premises).toEqual({ title: 'On-premises (colo, data center)', style: 'sketch=0;rounded=1;absoluteArcSize=1;arcSize=2;strokeColor=none;spacing=10;spacingTop=-4;fillColor=#EFEBE9;' });
    expect(groups.partner_zone.title).toBe('Partner zone');
    expect(groups.project).toEqual({ title: 'Project', style: 'shape=rect;strokeColor=none;fillColor=#F6F6F6;verticalAlign=top;fontSize=10;spacingLeft=10;spacing=0;' });
    // The first frame of a title is kept; a VPC network is the logical grouping under a second name.
    expect(groups.zone.style).toContain('fillColor=#FFF3E0;');
    expect(groups.vpc_network).toEqual({ title: 'VPC network', style: groups.logical_group.style });
    expect(groups.subnet.title).toBe('Subnetwork');
  });

  it('reads the project frame with its mark, without the stray token of the palette source', () => {
    expect(groups.google_cloud).toEqual({
      title: 'Google Cloud',
      style: 'fillColor=#F6F6F6;strokeColor=none;fontSize=14;align=left;spacing=10;fontColor=#717171;verticalAlign=top;spacingTop=-4;spacingLeft=40;',
      mark: { style: 'shape=mxgraph.gcp2.google_cloud_platform;fillColor=#F6F6F6;strokeColor=none;', x: 20, y: 10, width: 23, height: 20 },
    });
  });

  it('builds the GCP part only from both files, keeps a logo under its name, and carries an existing part over', () => {
    const shapes = SHAPES.replace(/\{val: 'cloud_deployment_manager'[^\n]*\n/g, '');
    const aws = "\tSidebar.prototype.addAWS4Palette = function()\n\t{\n\t\tvar pts = 'points=[[0,0]];';\n\t};\n";
    const fresh = buildCatalog(aws, 'v1', { source: SIDEBAR }, { shapes }).catalog;
    expect(Object.keys(fresh.gcp.icons)).toEqual([...Object.keys(fresh.gcp.icons)].sort());
    expect(fresh.source.gcp).toEqual({ path: 'src/main/webapp/shapes/mxGCP2.js', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // The device card named like the Firebase logo does not replace the logo.
    expect(fresh.logos.firebase).toBeDefined();
    expect(fresh.gcp.icons.firebase).toBeUndefined();
    expect(buildCatalog(aws, 'v1', { source: SIDEBAR }).catalog.gcp).toBeUndefined();
    const kept = buildCatalog(aws, 'v2', {}, { kept: { source: fresh.source.gcp, gcp: fresh.gcp } }).catalog;
    expect(kept.gcp).toEqual(fresh.gcp);
    expect(kept.source.gcp).toEqual(fresh.source.gcp);
    expect(JSON.stringify(buildCatalog(aws, 'v1', { source: SIDEBAR }, { shapes }))).toBe(JSON.stringify(buildCatalog(aws, 'v1', { source: SIDEBAR }, { shapes })));
  });
});

describe('committed GCP catalog', () => {
  const iconNames = Object.keys(catalog.gcp.icons);
  const groupNames = Object.keys(catalog.gcp.groups);

  it('holds the service icons, the resource figures and the group frames, well-formed', () => {
    expect(iconNames.length).toBeGreaterThanOrEqual(100);
    expect(groupNames.length).toBeGreaterThanOrEqual(15);
    for (const name of [...iconNames, ...groupNames]) expect(name).toMatch(/^[a-z0-9_]{1,64}$/);
    for (const [name, icon] of Object.entries(catalog.gcp.icons)) {
      expect(icon.fill, name).toMatch(/^#[0-9A-F]{6}$/);
      expect(icon.title, name).not.toBe('');
      expect(icon.category, name).not.toBe('');
      expect(Math.max(icon.width, icon.height), name).toBeLessThanOrEqual(78);
      expect(Math.min(icon.width, icon.height), name).toBeGreaterThan(20);
      // No icon takes the name of a product logo.
      expect(Object.hasOwn(catalog.logos, name), name).toBe(false);
    }
    for (const [name, group] of Object.entries(catalog.gcp.groups)) {
      expect(group.style.endsWith(';'), name).toBe(true);
      // Every frame can be seen on a white page: it has a fill, or an outline.
      expect(/fillColor=#(?!ffffff)[0-9A-Fa-f]{6};/i.test(group.style) || /strokeColor=#[0-9A-Fa-f]{6};/.test(group.style), name).toBe(true);
    }
    expect(catalog.source.gcp.path).toMatch(/mxGCP2\.js$/);
  });

  it('has the services people draw most, under the names draw.io gives them', () => {
    for (const name of ['cloud_run', 'cloud_functions', 'app_engine', 'compute_engine', 'container_engine', 'cloud_sql', 'cloud_spanner', 'cloud_firestore', 'cloud_bigtable', 'cloud_memorystore', 'cloud_storage', 'bigquery', 'cloud_pubsub', 'cloud_dataflow', 'cloud_tasks', 'cloud_load_balancing', 'cloud_cdn', 'cloud_dns', 'cloud_armor', 'cloud_nat', 'cloud_vpn', 'cloud_iam', 'key_management_service', 'identity_aware_proxy', 'container_builder', 'container_registry', 'logging', 'stackdriver', 'cloud_endpoints', 'apigee_api_platform']) {
      const icon = cloudIcon(`gcp:${name}`);
      expect(icon, name).toMatchObject({ provider: 'gcp', stencil: `mxgraph.gcp2.${name}`, fill: '#5184F3', width: 78, height: 69 });
    }
    for (const name of ['google_cloud', 'project', 'region', 'zone', 'vpc_network', 'subnet', 'logical_group', 'kubernetes_cluster', 'instance_group', 'firewall', 'on_premises', 'external_saas']) {
      expect(cloudGroup(`gcp:${name}`), name).toMatchObject({ provider: 'gcp', name });
    }
    expect(cloudGroup('gcp:google_cloud').mark.style).toContain('shape=mxgraph.gcp2.google_cloud_platform;');
    expect(cloudGroup('gcp:project').mark).toBeUndefined();
  });

  it('has the grey figures a system outside Google Cloud is drawn with', () => {
    for (const name of ['application', 'database', 'storage', 'users', 'desktop', 'laptop', 'phone', 'bucket', 'scheduled_tasks', 'application_system']) {
      const icon = cloudIcon(`gcp:${name}`);
      expect(icon, name).toMatchObject({ fill: '#757575', stencil: `mxgraph.gcp2.${name}` });
      expect(Math.max(icon.width, icon.height), name).toBe(57);
    }
  });

  it('looks up own names only, each under its own provider', () => {
    expect(cloudIcon('gcp:constructor')).toBeUndefined();
    expect(cloudIcon('gcp:lambda')).toBeUndefined();
    expect(cloudIcon('aws:cloud_run')).toBeUndefined();
    expect(cloudIcon('azure:cloud_run')).toBeUndefined();
    expect(cloudGroup('gcp:vpc')).toBeUndefined();
    expect(cloudGroup('aws:project')).toBeUndefined();
    expect(cloudGroup('gcp:cloud_run')).toBeUndefined();
    expect(providerOf('gcp:anything')).toBe('gcp');
    expect(providerOf('azure:vm')).toBeUndefined();
    expect(isProductLogo('gcp:firebase')).toBe(true);
    expect(isProductLogo('gcp:cloud_run')).toBe(false);
    expect(Object.keys(PROVIDERS)).toEqual(['aws', 'gcp']);
  });

  it('knows which icons draw a store, for both providers alike', () => {
    for (const icon of ['gcp:cloud_sql', 'gcp:cloud_spanner', 'gcp:cloud_firestore', 'gcp:cloud_storage', 'aws:rds', 'aws:s3']) expect(isStoreIcon(icon), icon).toBe(true);
    for (const icon of ['gcp:cloud_run', 'gcp:cloud_pubsub', 'gcp:firebase', 'gcp:database', 'aws:lambda', 'gcp:nope', undefined]) expect(isStoreIcon(icon), String(icon)).toBe(false);
  });

  it('is what the lookup reference lists, name for name', () => {
    const reference = readFileSync(join(scriptsDir, '..', 'references', 'gcp-icons.md'), 'utf8');
    expect(reference).toBe(renderGcpReference(catalog));
    const listed = [...reference.matchAll(/^\| `gcp:([a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...groupNames, ...iconNames, ...Object.keys(catalog.logos)].sort());
    // Every name the guidance of the page writes is a name of the catalog.
    for (const m of reference.matchAll(/`((?:gcp|aws):[a-z0-9_]+)`/g)) expect(cloudIcon(m[1]) ?? cloudGroup(m[1]), m[1]).toBeDefined();
  });

  it('suggests the catalog name for the names people guess, among the names of the provider written', () => {
    expect(nearestCloudNames('icons', 'gcp:cloudrun')[0]).toBe('gcp:cloud_run');
    expect(nearestCloudNames('icons', 'gcp:gke')).toContain('gcp:gke_on_prem');
    expect(nearestCloudNames('icons', 'gcp:kubernetes_engine')[0]).toBe('gcp:container_engine');
    expect(nearestCloudNames('icons', 'gcp:pubsub')[0]).toBe('gcp:cloud_pubsub');
    expect(nearestCloudNames('icons', 'gcp:gcs')).toEqual([]);
    expect(nearestCloudNames('icons', 'gcp:storage_bucket')).toContain('gcp:bucket');
    expect(nearestCloudNames('icons', 'gcp:iam')[0]).toBe('gcp:cloud_iam');
    expect(nearestCloudNames('icons', 'gcp:kms')[0]).toBe('gcp:key_management_service');
    expect(nearestCloudNames('groups', 'gcp:vpc')).toEqual(['gcp:vpc_network']);
    expect(nearestCloudNames('groups', 'gcp:subnetwork')[0]).toBe('gcp:subnet');
    // A name written for one provider is not answered with a name of the other.
    expect(nearestCloudNames('icons', 'gcp:lambda').every((n) => n.startsWith('gcp:'))).toBe(true);
    expect(nearestCloudNames('icons', 'aws:cloud_run').every((n) => n.startsWith('aws:'))).toBe(true);
    expect(nearestCloudNames('groups', 'aws:subnet')).toEqual(['aws:public_subnet', 'aws:private_subnet']);
  });
});

describe('GCP names in an architecture IR', () => {
  const base = (components, boundaries = []) => ({ schemaVersion: 1, kind: 'architecture', title: 'T', components, boundaries, connections: [] });

  it('accepts every icon and every group frame of the catalog', () => {
    const components = Object.keys(catalog.gcp.icons).map((name, i) => ({ id: `c${i}`, label: name, icon: `gcp:${name}` }));
    const boundaries = Object.keys(catalog.gcp.groups).map((name, i) => ({ id: `b${i}`, label: name, group: `gcp:${name}`, children: [`c${i}`] }));
    expect(validateIr(base(components, boundaries))).toEqual({ ok: true, errors: [] });
  });

  it('reports every unknown name in one run, each with the nearest names and the page that lists them', () => {
    const r = validateIr(loadFixture('architecture', 'invalid-gcp-unknown-names'));
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => `${e.path} ${e.message}`)).toEqual([
      '/components/0/icon unknown GCP icon "gcp:iam"',
      '/components/1/icon unknown GCP icon "gcp:cloudrun"',
      '/boundaries/0/group unknown GCP group frame "gcp:vpc"',
    ]);
    expect(r.errors[0].hint).toContain('did you mean gcp:cloud_iam');
    expect(r.errors[1].hint).toContain('did you mean gcp:cloud_run');
    expect(r.errors[2].hint).toContain('did you mean gcp:vpc_network?');
    for (const e of r.errors) expect(e.hint).toContain('references/gcp-icons.md');
  });

  it('points an unknown AWS name at the AWS page and an unknown GCP name at the GCP page', () => {
    const r = validateIr(base([{ id: 'a', label: 'A', icon: 'aws:lamda' }, { id: 'b', label: 'B', icon: 'gcp:cloud_rnu' }]));
    expect(r.errors.map((e) => e.message)).toEqual(['unknown AWS icon "aws:lamda"', 'unknown GCP icon "gcp:cloud_rnu"']);
    expect(r.errors[0].hint).toContain('references/aws-icons.md');
    expect(r.errors[0].hint).not.toContain('gcp');
    expect(r.errors[1].hint).toMatch(/did you mean [^?]*gcp:cloud_run[,?]/);
  });

  it('rejects a malformed group with one error that says how to write it', () => {
    for (const group of ['azure:vnet', 'project', 'gcp:Project', 'gcp:']) {
      const r = validateIr(base([{ id: 'a', label: 'A' }], [{ id: 'b', label: 'B', group, children: ['a'] }]));
      expect(r.errors, group).toEqual([{ path: '/boundaries/0/group', message: expect.any(String), hint: 'write "aws:<name>" or "gcp:<name>" with a name listed in references/aws-icons.md or references/gcp-icons.md' }]);
    }
  });
});

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const segmentBox = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
const DIRECTIONS = ['LR', 'TB', 'RL', 'BT'];
const withDirection = (ir, direction) => ({ ...structuredClone(ir), direction });
const part = (style, key) => style.match(new RegExp(`(?:^|;)${key}=([^;]*)`))?.[1];

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

const SAMPLES = ['valid-gcp', 'valid-gcp-zones', 'valid-gcp-invoicing', 'valid-gcp-fan-out', 'valid-gcp-shared-systems', 'valid-gcp-outside-pair', 'valid-gcp-outside-chain', 'valid-multi-cloud'];

describe('GCP icons and group frames in draw.io', () => {
  it('draws each icon as its stencil in the colour of the catalog, at its size, with its name below', async () => {
    const ir = loadFixture('architecture', 'valid-gcp-fan-out');
    const { r, figures } = await drawn(ir);
    expect(r.warnings).toEqual([]);
    const icons = figures.filter((f) => f.icon);
    expect(icons).toHaveLength(13);
    for (const f of icons) {
      const entry = cloudIcon(f.icon);
      expect(f.cell.style, f.id).toContain(`shape=mxgraph.gcp2.${entry.name};`);
      expect(f.cell.style, f.id).toContain(`fillColor=${entry.fill};strokeColor=none;`);
      expect(f.cell.style, f.id).toContain('verticalLabelPosition=bottom;verticalAlign=top;');
      expect(f.cell.style, f.id).not.toContain('resourceIcon');
      expect([f.figure.width, f.figure.height], f.id).toEqual([entry.width, entry.height]);
      expect(f.cell.value, f.id).toBe(ir.components.find((c) => c.id === f.id).label);
    }
    // A service is the blue hexagon, a system outside the cloud a grey figure or its logo.
    expect(figures.find((f) => f.id === 'api').cell.style).toContain('fillColor=#5184F3;');
    expect([figures.find((f) => f.id === 'api').figure.width, figures.find((f) => f.id === 'api').figure.height]).toEqual([78, 69]);
    expect(figures.find((f) => f.id === 'idp').cell.style).toContain('fillColor=#757575;');
    expect(figures.find((f) => f.id === 'realtime').cell.style).toContain('shape=mxgraph.gcp2.firebase;');
  }, 30000);

  it('draws each group frame in the colours of draw.io\'s palette, as a container with its title at the top left', async () => {
    for (const sample of ['valid-gcp', 'valid-gcp-zones']) {
      const ir = loadFixture('architecture', sample);
      const { cellOf } = await drawn(ir);
      for (const b of ir.boundaries) {
        const style = cellOf(b.id).style;
        if (!b.group) { expect(style, b.id).toContain('swimlane;'); continue; }
        const palette = cloudGroup(b.group).style;
        for (const key of ['fillColor', 'strokeColor', 'fontColor', 'shape']) expect(part(style, key), `${b.id} ${key}`).toBe(part(palette, key));
        expect(style, b.id).toContain('container=1;pointerEvents=0;collapsible=0;recursiveResize=0;');
        expect(style, b.id).toContain('verticalAlign=top;');
        expect(style, b.id).toContain('align=left;');
        // One size for every title, one key for its left margin.
        expect(style.match(/fontSize=/g), b.id).toHaveLength(1);
        expect(style, b.id).toContain('fontSize=12;');
        expect(style.match(/(?:^|;)spacing=/g), b.id).toHaveLength(1);
        expect(style, b.id).toContain(';spacing=0;');
        expect(style.match(/spacingLeft=/g), b.id).toHaveLength(1);
        expect(style, b.id).not.toContain('swimlane');
      }
    }
  });

  it('draws the Google Cloud mark in the corner of its frame, as a part of the frame that no connection can end on', async () => {
    const { cells, abs, cellOf } = await drawn(loadFixture('architecture', 'valid-gcp'));
    const mark = cells.find((c) => c.id === 'a:cloud:mark');
    expect(mark).toMatchObject({ parent: 'a:cloud', connectable: '0', value: '' });
    expect(mark.style).toContain('shape=mxgraph.gcp2.google_cloud_platform;');
    expect(mark.style).toContain('part=1;');
    const frame = abs.get('a:cloud');
    const box = abs.get('a:cloud:mark');
    expect([box.x - frame.x, box.y - frame.y, box.width, box.height]).toEqual([20, 10, 23, 20]);
    // The title starts after the mark.
    expect(Number(part(cellOf('cloud').style, 'spacingLeft'))).toBeGreaterThanOrEqual(20 + 23);
    // No other frame has a mark, and no cell hangs on one.
    expect(cells.filter((c) => c.id.endsWith(':mark'))).toHaveLength(1);
    expect(cells.some((c) => c.source === mark.id || c.target === mark.id || c.parent === mark.id)).toBe(false);
  });

  it('keeps every frame title clear of every connection, in every direction', async () => {
    let moved = 0;
    for (const sample of SAMPLES) for (const direction of DIRECTIONS) {
      const ir = withDirection(loadFixture('architecture', sample), direction);
      const { r, abs, cellOf, paths } = await drawn(ir);
      expect(r.warnings, `${sample} ${direction}`).toEqual([]);
      for (const b of ir.boundaries.filter((x) => x.group)) {
        const frame = abs.get(`a:${b.id}`);
        const style = cellOf(b.id).style;
        const text = measureLabelBelow(b.label, { maxWidth: 360 });
        const left = /align=left;/.test(style) ? Number(style.match(/spacingLeft=(\d+);/)[1]) : (frame.width - text.width) / 2;
        const usual = b.group.startsWith('aws:') ? 30 : b.group === 'gcp:google_cloud' ? 50 : 10;
        if (/align=left;/.test(style) && left !== usual) moved++;
        const title = { x: frame.x + left, y: frame.y, width: text.width, height: text.height + 4 };
        expect(title.x + title.width, `${sample} ${direction}: title of ${b.id} inside its frame`).toBeLessThanOrEqual(frame.x + frame.width);
        for (const [id, path] of paths) for (let i = 1; i < path.length; i++) {
          expect(intersects(title, segmentBox(path[i - 1], path[i])), `${sample} ${direction}: ${id} through the title of ${b.id}`).toBe(false);
        }
      }
    }
    // Connections enter frames from above in the top-down samples: some titles had to step aside.
    expect(moved).toBeGreaterThan(0);
  }, 120000);

  it('leaves a title in its usual place when nothing crosses it', async () => {
    const { cellOf } = await drawn(loadFixture('architecture', 'valid-gcp'));
    expect(cellOf('cloud').style).toContain('spacingLeft=50;');
    for (const id of ['region', 'vpc', 'proxy']) expect(cellOf(id).style, id).toContain('spacingLeft=10;');
    // The line to the payment provider leaves the private subnet through its top.
    expect(cellOf('private').style).not.toContain('spacingLeft=10;');
  });

  it('keeps every member inside its frame, below the title, in every direction', async () => {
    for (const sample of SAMPLES) for (const direction of DIRECTIONS) {
      const ir = withDirection(loadFixture('architecture', sample), direction);
      const { abs, figures } = await drawn(ir);
      const labelOf = new Map(figures.map((f) => [f.id, f.label]));
      for (const b of ir.boundaries) {
        const frame = abs.get(`a:${b.id}`);
        const inside = { x: frame.x, y: frame.y + 30, width: frame.width, height: frame.height - 30 };
        for (const child of b.children) {
          const where = `${sample} ${direction}: ${child} in ${b.id}`;
          expect(contains(inside, abs.get(`a:${child}`)), where).toBe(true);
          if (labelOf.has(child)) expect(contains(frame, labelOf.get(child)), `${where} (label)`).toBe(true);
        }
      }
    }
  }, 120000);

  it('makes a frame wide enough for its title on one line, after the mark where it has one', async () => {
    for (const [group, before] of [['gcp:vpc_network', 10], ['gcp:google_cloud', 50]]) {
      const ir = { schemaVersion: 1, kind: 'architecture', title: 'T', components: [{ id: 'svc', label: 'Svc', icon: 'gcp:cloud_run' }], boundaries: [{ id: 'f', label: 'Shared services network 10.20.0.0/16 (production)', group, children: ['svc'] }], connections: [] };
      for (const direction of DIRECTIONS) {
        const { abs } = await drawn({ ...ir, direction });
        expect(abs.get('a:f').width, `${group} ${direction}`).toBeGreaterThanOrEqual(measureLabelBelow(ir.boundaries[0].label, { maxWidth: 360 }).width + before);
        expect(abs.get('a:f').height, `${group} ${direction}`).toBeLessThan(200);
      }
    }
  });

  it('lets no figure or label overlap another, and no connection run through a label or a component', async () => {
    for (const sample of SAMPLES) for (const direction of DIRECTIONS) {
      const ir = withDirection(loadFixture('architecture', sample), direction);
      const { cells, abs, figures, paths } = await drawn(ir);
      const where = `${sample} ${direction}`;
      for (const a of figures) {
        for (const o of figures) if (o !== a) {
          expect(intersects(a.label, o.figure), `${where}: ${a.id} label on ${o.id}`).toBe(false);
          expect(intersects(a.label, o.label), `${where}: ${a.id} label on ${o.id} label`).toBe(false);
          expect(intersects(a.figure, o.figure), `${where}: ${a.id} on ${o.id}`).toBe(false);
        }
        for (const [id, path] of paths) for (let i = 1; i < path.length; i++) {
          expect(intersects(a.label, segmentBox(path[i - 1], path[i])), `${where}: ${id} through the label of ${a.id}`).toBe(false);
        }
      }
      for (const [id, path] of paths) {
        const line = cells.find((c) => c.id === id);
        for (let i = 1; i < path.length; i++) {
          const seg = segmentBox(path[i - 1], path[i]);
          const thick = { x: seg.x + 0.5, y: seg.y + 0.5, width: Math.max(0.1, seg.width - 1), height: Math.max(0.1, seg.height - 1) };
          for (const c of ir.components) if (`a:${c.id}` !== line.source && `a:${c.id}` !== line.target) expect(intersects(thick, abs.get(`a:${c.id}`)), `${where}: ${id} through ${c.id}`).toBe(false);
        }
      }
    }
  }, 120000);

  // A tax API called by the second component of a chain that runs on for four more.
  const chain = {
    schemaVersion: 1, kind: 'architecture', title: 'T',
    components: [
      { id: 'users', label: 'Users', kind: 'client' }, { id: 'lb', label: 'Load balancer', icon: 'gcp:cloud_load_balancing' },
      { id: 'api', label: 'Invoice API', icon: 'gcp:container_engine' }, { id: 'db', label: 'Database', kind: 'database', icon: 'gcp:cloud_sql' },
      { id: 'queue', label: 'Topic', kind: 'queue', icon: 'gcp:cloud_pubsub' }, { id: 'fn', label: 'Renderer', icon: 'gcp:cloud_functions' },
      { id: 'bucket', label: 'Bucket', kind: 'database', icon: 'gcp:cloud_storage' }, { id: 'tax', label: 'Tax rate API', kind: 'external' },
    ],
    boundaries: [
      { id: 'region', label: 'Region', group: 'gcp:region', children: ['vpc', 'queue', 'fn', 'bucket'] },
      { id: 'vpc', label: 'VPC network', group: 'gcp:vpc_network', children: ['lb', 'api', 'db'] },
    ],
    connections: [
      { id: 'c1', from: 'users', to: 'lb' }, { id: 'c2', from: 'lb', to: 'api' }, { id: 'c3', from: 'api', to: 'db' },
      { id: 'c4', from: 'api', to: 'tax', label: 'gets tax rates' }, { id: 'c5', from: 'api', to: 'queue' },
      { id: 'c6', from: 'queue', to: 'fn' }, { id: 'c7', from: 'fn', to: 'bucket' },
    ],
  };
  const onBox = (pt, box) => pt.x >= box.x - 0.5 && pt.x <= box.x + box.width + 0.5 && pt.y >= box.y - 0.5 && pt.y <= box.y + box.height + 60;

  it('puts a system that one component calls beside the frames, level with its caller, on one straight line', async () => {
    for (const sample of [chain, loadFixture('architecture', 'valid-gcp'), loadFixture('architecture', 'valid-gcp-invoicing')]) for (const direction of DIRECTIONS) {
      const ir = { ...structuredClone(sample), direction };
      const [edgeId, caller, system, outer] = sample === chain ? ['c4', 'api', 'tax', 'region'] : ir.title.startsWith('Invoicing') ? ['api-to-tax', 'invoice-api', 'tax-rate-api', 'project'] : ['c9', 'api', 'psp', 'cloud'];
      const where = `${ir.title} ${direction}`;
      const { r, abs, cellOf, figures, paths } = await drawn(ir);
      expect(r.warnings, where).toEqual([]);
      expect([cellOf(edgeId).source, cellOf(edgeId).target], where).toEqual([`a:${caller}`, `a:${system}`]);
      const path = paths.get(`a:${edgeId}`);
      expect(path, where).toHaveLength(2);
      const across = direction === 'TB' || direction === 'BT' ? 'y' : 'x';
      expect(Math.abs(path[0][across] - path[1][across]), `${where}: straight`).toBeLessThan(0.5);
      expect(onBox(path[0], abs.get(`a:${caller}`)), `${where}: starts at the caller`).toBe(true);
      expect(onBox(path[1], abs.get(`a:${system}`)), `${where}: ends at the system`).toBe(true);
      const box = abs.get(`a:${system}`);
      expect(intersects(box, abs.get(`a:${outer}`)), `${where}: outside the frames`).toBe(false);
      const line = segmentBox(path[0], path[1]);
      for (const c of ir.components) {
        if (c.id === caller || c.id === system) continue;
        expect(intersects(line, abs.get(`a:${c.id}`)), `${where}: line through ${c.id}`).toBe(false);
        expect(intersects(box, abs.get(`a:${c.id}`)), `${where}: system on ${c.id}`).toBe(false);
      }
      for (const f of figures) if (f.id !== caller) expect(intersects(line, f.label), `${where}: line through the name of ${f.id}`).toBe(false);
    }
  }, 120000);

  it('stands a store beside the component that uses it, so the connection that goes on stays clear of it', async () => {
    for (const direction of DIRECTIONS) {
      const { r, abs, cellOf, figures, paths } = await drawn({ ...structuredClone(chain), direction });
      expect(r.warnings, direction).toEqual([]);
      const api = figures.find((f) => f.id === 'api');
      const db = figures.find((f) => f.id === 'db');
      const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      if (direction === 'LR' || direction === 'RL') {
        expect(Math.abs(centre(db.figure).x - centre(api.figure).x), direction).toBeLessThan(1);
        expect(db.figure.y, direction).toBeGreaterThan(api.label.y + api.label.height);
      } else {
        expect(Math.abs(centre(db.figure).y - centre(api.figure).y), direction).toBeLessThan(1);
        expect(db.figure.x, direction).toBeGreaterThan(api.figure.x + api.figure.width);
      }
      expect([cellOf('c3').source, cellOf('c3').target], direction).toEqual(['a:api', 'a:db']);
      const line = paths.get('a:c3');
      expect(line, direction).toHaveLength(2);
      expect(Math.min(Math.abs(line[0].x - line[1].x), Math.abs(line[0].y - line[1].y)), direction).toBeLessThan(0.5);
      for (const box of [db.figure, db.label]) expect(contains(abs.get('a:vpc'), box), `${direction}: db in the VPC network`).toBe(true);
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

  it('keeps a store in the flow when its user passes nothing on', async () => {
    const only = { schemaVersion: 1, kind: 'architecture', title: 'T', direction: 'LR', components: [{ id: 'api', label: 'API', icon: 'gcp:cloud_run' }, { id: 'db', label: 'DB', kind: 'database', icon: 'gcp:cloud_sql' }], boundaries: [{ id: 'region', label: 'Region', group: 'gcp:region', children: ['api', 'db'] }], connections: [{ id: 'c', from: 'api', to: 'db' }] };
    const one = await drawn(only);
    expect(one.abs.get('a:db').x).toBeGreaterThan(one.abs.get('a:api').x + 78);
  });

  it('keeps a caller outside the frames where the flow starts, however deep the frames nest', async () => {
    const groups = ['gcp:project', 'gcp:region', 'gcp:vpc_network', 'gcp:subnet'];
    const before = { LR: (a, b) => a.x + a.width <= b.x, TB: (a, b) => a.y + a.height <= b.y, RL: (a, b) => a.x >= b.x + b.width, BT: (a, b) => a.y >= b.y + b.height };
    for (const depth of [1, 4]) for (const label of [undefined, 'HTTPS']) for (const direction of DIRECTIONS) {
      const frames = ['f1', 'f2', 'f3', 'f4'].slice(0, depth);
      const ir = {
        schemaVersion: 1, kind: 'architecture', title: 'T', direction,
        components: [{ id: 'u', label: 'Users', kind: 'client' }, { id: 'a', label: 'Load balancer', icon: 'gcp:cloud_load_balancing' }],
        boundaries: frames.map((f, i) => ({ id: f, label: `Frame ${i}`, group: groups[i], children: [i === depth - 1 ? 'a' : frames[i + 1]] })),
        connections: [{ id: 'c', from: 'u', to: 'a', ...(label ? { label } : {}) }],
      };
      const { abs } = await drawn(ir);
      expect(before[direction](abs.get('a:u'), abs.get('a:f1')), `depth ${depth} ${label ?? 'no label'} ${direction}`).toBe(true);
    }
  });

  it('writes a label inside a frame on the colour of that frame, and a label outside every frame on white', async () => {
    const { cells } = await drawn(loadFixture('architecture', 'valid-gcp'));
    const style = (id) => cells.find((c) => c.id === `a:${id}:label`).style;
    const fill = (group) => /fillColor=(#[0-9A-Fa-f]{6});/.exec(cloudGroup(group).style)[1];
    // API to Cloud SQL and API to the cache both run inside the private subnet.
    expect(style('c5')).toContain(`labelBackgroundColor=${fill('gcp:subnet')};`);
    expect(style('c6')).toContain(`labelBackgroundColor=${fill('gcp:subnet')};`);
    // Cloud CDN to the bucket lies in the outer frame; the topic to the worker in the region.
    expect(style('c2')).toContain(`labelBackgroundColor=${fill('gcp:google_cloud')};`);
    expect(style('c8')).toContain(`labelBackgroundColor=${fill('gcp:region')};`);
    // Browser to Cloud CDN starts outside every frame.
    expect(style('c1')).not.toContain('labelBackgroundColor');
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
    for (const sample of ['valid-gcp', 'valid-gcp-zones', 'valid-gcp-invoicing', 'valid-multi-cloud']) for (const direction of DIRECTIONS) {
      const ir = withDirection(loadFixture('architecture', sample), direction);
      const { cells, abs, figures, paths } = await drawn(ir);
      const where = `${sample} ${direction}`;
      const boxes = [];
      for (const c of ir.connections) {
        const cell = cells.find((x) => x.id === `a:${c.id}:label`);
        if (!cell) continue;
        const box = labelBox(cell, paths.get(`a:${c.id}`), c.label);
        boxes.push({ id: c.id, box });
        for (const b of ir.boundaries.filter((x) => x.group)) {
          const frame = abs.get(`a:${b.id}`);
          expect(contains(frame, box) || !intersects(box, frame), `${where}: label of ${c.id} across the border of ${b.id}`).toBe(true);
        }
        for (const p of ir.components) expect(intersects(box, abs.get(`a:${p.id}`)), `${where}: label of ${c.id} on ${p.id}`).toBe(false);
        for (const f of figures) expect(intersects(box, f.label), `${where}: label of ${c.id} on the name of ${f.id}`).toBe(false);
        // Nor on the mark of a frame.
        for (const mark of cells.filter((x) => x.id.endsWith(':mark'))) expect(intersects(box, abs.get(mark.id)), `${where}: label of ${c.id} on ${mark.id}`).toBe(false);
      }
      for (const a of boxes) for (const b of boxes) if (a !== b) expect(intersects(a.box, b.box), `${where}: labels of ${a.id} and ${b.id}`).toBe(false);
    }
  }, 120000);

  it('stands a label on the side of its line where the other labels of its row stand, when that side is free', async () => {
    // The line from the queue to the worker is too short for its label in the first layout, so
    // the layout engine places that label; the others of the row are placed above their lines.
    const ir = {
      schemaVersion: 1, kind: 'architecture', title: 'Notification service', direction: 'LR',
      components: [
        { id: 'callers', label: 'Backend services', kind: 'client' },
        { id: 'api', label: 'Notification API (Cloud Run)', icon: 'gcp:cloud_run' },
        { id: 'queue', label: 'Cloud Tasks queue', kind: 'queue', icon: 'gcp:cloud_tasks' },
        { id: 'worker', label: 'Notification worker (Cloud Run)', icon: 'gcp:cloud_run' },
        { id: 'templates', label: 'Templates (Firestore)', kind: 'database', icon: 'gcp:cloud_firestore' },
        { id: 'sendgrid', label: 'SendGrid', kind: 'external', icon: 'gcp:application' },
        { id: 'fcm', label: 'Firebase Cloud Messaging', kind: 'external', icon: 'gcp:firebase' },
      ],
      boundaries: [{ id: 'gc', label: 'Google Cloud', group: 'gcp:google_cloud', children: ['api', 'queue', 'worker', 'templates'] }],
      connections: [
        { id: 'c1', from: 'callers', to: 'api', label: 'HTTPS' },
        { id: 'c2', from: 'api', to: 'queue', label: 'enqueue' },
        { id: 'c3', from: 'queue', to: 'worker', label: 'HTTP dispatch' },
        { id: 'c4', from: 'worker', to: 'templates', label: 'reads templates' },
        { id: 'c5', from: 'worker', to: 'sendgrid', label: 'send mail' },
        { id: 'c6', from: 'worker', to: 'fcm', label: 'send push' },
      ],
    };
    const { r, cells, paths } = await drawn(ir);
    expect(r.warnings).toEqual([]);
    const row = ['c1', 'c2', 'c3', 'c6'];
    // One row: every one of these lines is straight and at one height.
    const ys = row.flatMap((id) => paths.get(`a:${id}`).map((q) => q.y));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
    for (const id of row) {
      const offset = cells.find((c) => c.id === `a:${id}:label`).mxGeometry.mxPoint[0];
      expect(Number(offset.y), `${id} above its line`).toBeLessThan(0);
    }
  });

  it('stands the systems a client and a service both call in a row along the frames, between their callers', async () => {
    const ir = loadFixture('architecture', 'valid-gcp-shared-systems');
    const { r, abs } = await drawn(ir);
    expect(r.warnings).toEqual([]);
    const outer = abs.get('a:project');
    for (const id of ['idp', 'realtime']) {
      const box = abs.get(`a:${id}`);
      expect(intersects(box, outer), id).toBe(false);
      // Between the browser and the API along the flow, above or below the frames.
      expect(box.x, id).toBeGreaterThan(abs.get('a:browser').x);
      expect(box.x, id).toBeLessThan(abs.get('a:api').x + 200);
      expect(box.y + box.height <= outer.y || box.y >= outer.y + outer.height, id).toBe(true);
    }
  });

  it('joins a system and the component it exchanges calls with by two lines of their own, and keeps a chain through the frames out of the way', async () => {
    for (const sample of ['valid-gcp-outside-pair', 'valid-gcp-outside-chain']) for (const direction of DIRECTIONS) {
      const ir = withDirection(loadFixture('architecture', sample), direction);
      const { r, abs, paths } = await drawn(ir);
      expect(r.warnings, `${sample} ${direction}`).toEqual([]);
      expect(intersects(abs.get('a:partner'), abs.get('a:cloud')), `${sample} ${direction}`).toBe(false);
      const [out, back] = [paths.get('a:c5'), paths.get('a:c6')];
      // Neither line runs round the picture: each is shorter than the outer frame is long.
      const length = (p) => p.slice(1).reduce((s, q, i) => s + Math.abs(q.x - p[i].x) + Math.abs(q.y - p[i].y), 0);
      const frame = abs.get('a:cloud');
      for (const p of [out, back]) expect(length(p), `${sample} ${direction}`).toBeLessThan(Math.max(frame.width, frame.height));
    }
  }, 60000);
});

describe('the main flow of a GCP diagram', () => {
  const ir = loadFixture('architecture', 'valid-gcp-fan-out');
  // What the API uses inside the region: the members of its fan.
  const used = ir.connections.filter((c) => c.from === 'api' && !['idp', 'realtime', 'records'].includes(c.to)).map((c) => c.to);

  it('runs through the middle of the picture, with what a hub uses on both sides of it', async () => {
    for (const direction of DIRECTIONS) {
      const { r, abs, figures } = await drawn(withDirection(ir, direction));
      expect(r.warnings, direction).toEqual([]);
      const sideways = direction === 'LR' || direction === 'RL';
      const across = (b) => (sideways ? b.y + b.height / 2 : b.x + b.width / 2);
      const at = (id) => across(figures.find((f) => f.id === id).figure);
      const members = used.map(at);
      const lo = Math.min(...members);
      const span = Math.max(...members) - lo;
      expect(span, direction).toBeGreaterThan(300);
      const share = (at('api') - lo) / span;
      expect(share, `${direction}: the API among what it uses`).toBeGreaterThan(1 / 3);
      expect(share, `${direction}: the API among what it uses`).toBeLessThan(2 / 3);
      expect(members.filter((m) => m < at('api') - 1).length, direction).toBeGreaterThanOrEqual(2);
      expect(members.filter((m) => m > at('api') + 1).length, direction).toBeGreaterThanOrEqual(2);
      // The whole flow, client to load balancer to API, lies in the middle half of the region.
      const region = abs.get('a:region');
      const [from, size] = sideways ? [region.y, region.height] : [region.x, region.width];
      for (const id of ['browser', 'lb', 'api']) {
        const part = (at(id) - from) / size;
        expect(part, `${direction}: ${id} across the region`).toBeGreaterThan(0.25);
        expect(part, `${direction}: ${id} across the region`).toBeLessThan(0.75);
      }
    }
  }, 60000);
});

describe('a diagram of a system on AWS and Google Cloud', () => {
  const ir = loadFixture('architecture', 'valid-multi-cloud');

  it('draws each cloud in its own frame, side by side along the flow, each component with the icon of its cloud', async () => {
    for (const direction of DIRECTIONS) {
      const { r, abs, cellOf } = await drawn(withDirection(ir, direction));
      expect(r.warnings, direction).toEqual([]);
      const [aws, gcp] = [abs.get('a:aws'), abs.get('a:gcp')];
      expect(intersects(aws, gcp), direction).toBe(false);
      // The flow runs from the AWS side to the Google Cloud side.
      const before = { LR: aws.x + aws.width <= gcp.x, RL: gcp.x + gcp.width <= aws.x, TB: aws.y + aws.height <= gcp.y, BT: gcp.y + gcp.height <= aws.y };
      expect(before[direction], direction).toBe(true);
      expect(cellOf('aws').style).toContain('grIcon=mxgraph.aws4.group_aws_cloud_alt;');
      expect(cellOf('gcp').style).toContain('fillColor=#F6F6F6;');
      expect(cellOf('api').style).toContain('resIcon=mxgraph.aws4.fargate;');
      expect(cellOf('topic').style).toContain('shape=mxgraph.gcp2.cloud_pubsub;');
      // Every component of a cloud lies in the frame of that cloud.
      for (const c of ir.components.filter((x) => x.icon && x.kind !== 'external')) {
        expect(contains(c.icon.startsWith('aws:') ? aws : gcp, abs.get(`a:${c.id}`)), `${direction}: ${c.id}`).toBe(true);
        expect(intersects(c.icon.startsWith('aws:') ? gcp : aws, abs.get(`a:${c.id}`)), `${direction}: ${c.id}`).toBe(false);
      }
    }
  }, 60000);

  it('joins the two clouds by one connection that crosses no component, and stands the store of the API beside it', async () => {
    const { abs, paths, figures } = await drawn(ir);
    const bridge = paths.get('a:c7');
    for (let i = 1; i < bridge.length; i++) {
      const seg = segmentBox(bridge[i - 1], bridge[i]);
      for (const c of ir.components) if (c.id !== 'forwarder' && c.id !== 'topic') expect(intersects({ ...seg, width: seg.width + 0.1, height: seg.height + 0.1 }, abs.get(`a:${c.id}`)), c.id).toBe(false);
    }
    const centre = (b) => b.x + b.width / 2;
    expect(Math.abs(centre(figures.find((f) => f.id === 'db').figure) - centre(figures.find((f) => f.id === 'api').figure))).toBeLessThan(1);
  });

  it('says on the other targets what was lost of each provider, once each', async () => {
    for (const target of ['mermaid', 'figjam']) {
      const r = await emit(ir, target);
      expect(r.ok).toBe(true);
      const lost = r.warnings.filter((w) => /\.(aws|gcp)$/.test(w.feature ?? ''));
      expect(lost.map((w) => [w.feature, w.path]), target).toEqual([['component.icon.aws', '/components'], ['component.icon.gcp', '/components'], ['boundary.group.aws', '/boundaries'], ['boundary.group.gcp', '/boundaries']]);
    }
  });
});

describe('GCP icons on the targets that cannot draw them', () => {
  const strip = (ir) => ({ ...ir, components: ir.components.map(({ icon, ...c }) => c), boundaries: ir.boundaries.map(({ group, ...b }) => b) });

  for (const target of ['mermaid', 'figjam']) {
    it(`${target}: draws the generic diagram and says once what was lost`, async () => {
      for (const sample of ['valid-gcp', 'valid-gcp-zones', 'valid-gcp-fan-out']) {
        const ir = loadFixture('architecture', sample);
        const r = await emit(ir, target);
        expect(r.ok, sample).toBe(true);
        expect(r.output, sample).toBe((await emit(strip(ir), target)).output);
        const lost = r.warnings.filter((w) => /\.(aws|gcp)$/.test(w.feature ?? ''));
        expect(lost.map((w) => [w.feature, w.path]), sample).toEqual([['component.icon.gcp', '/components'], ['boundary.group.gcp', '/boundaries']]);
        expect(lost[0].message).toContain('no GCP icons');
        expect(lost[1].message).toContain('GCP group frames');
      }
    });
  }

  it('counts a product logo with the icons around it, so a diagram that showed one before says what it said before', async () => {
    const features = async (components) => (await emit({ schemaVersion: 1, kind: 'architecture', title: 'T', components, connections: [] }, 'mermaid')).warnings.map((w) => w.feature).filter((f) => /\.(aws|gcp)$/.test(f ?? ''));
    const logo = { id: 'l', label: 'Firebase', kind: 'external', icon: 'gcp:firebase' };
    expect(await features([logo])).toEqual(['component.icon.aws']);
    expect(await features([logo, { id: 'a', label: 'A', icon: 'aws:lambda' }])).toEqual(['component.icon.aws']);
    expect(await features([logo, { id: 'a', label: 'A', icon: 'gcp:cloud_run' }])).toEqual(['component.icon.gcp']);
    expect(await features([logo, { id: 'a', label: 'A', icon: 'gcp:cloud_run' }, { id: 'b', label: 'B', icon: 'aws:lambda' }])).toEqual(['component.icon.aws', 'component.icon.gcp']);
  });

  it('drawio: no warning', async () => {
    for (const sample of SAMPLES) expect((await emit(loadFixture('architecture', sample), 'drawio')).warnings, sample).toEqual([]);
  }, 30000);
});

describe('level of detail of a GCP architecture diagram', () => {
  const diagram = (components, connections, boundaries = []) => ({ schemaVersion: 1, kind: 'architecture', title: 'T', components, connections, boundaries });

  it('reports the stores of one icon that one component alone uses, whatever their kind says', () => {
    // No `kind`: the icon alone says these are stores.
    const tables = ['orders', 'customers', 'invoices'].map((id) => ({ id, label: id, icon: 'gcp:cloud_firestore' }));
    const { warnings } = checkDetail(diagram([{ id: 'api', label: 'API', icon: 'gcp:cloud_run' }, ...tables], tables.map((t, i) => ({ id: `c${i}`, from: 'api', to: t.id }))));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('3 components ("orders", "customers", "invoices")');
    // Three Cloud Run services of one caller are not stores.
    const services = ['a', 'b', 'c'].map((id) => ({ id, label: id, icon: 'gcp:cloud_run' }));
    expect(checkDetail(diagram([{ id: 'api', label: 'API' }, ...services], services.map((t, i) => ({ id: `c${i}`, from: 'api', to: t.id })))).warnings).toEqual([]);
  });

  it('leaves a GCP group frame around components of one kind alone, and reports a plain boundary around them', () => {
    const nodes = ['a', 'b'].map((id) => ({ id, label: id, icon: 'gcp:compute_engine' }));
    expect(checkDetail(diagram(nodes, [], [{ id: 'z', label: 'Zone', group: 'gcp:zone', children: ['a', 'b'] }])).warnings).toEqual([]);
    expect(checkDetail(diagram(nodes, [], [{ id: 'z', label: 'Servers', children: ['a', 'b'] }])).warnings).toHaveLength(1);
  });

  it('finds nothing to report in the GCP fixtures', () => {
    for (const sample of SAMPLES) expect(checkDetail(loadFixture('architecture', sample)).warnings, sample).toEqual([]);
  });
});

describe('a GCP diagram read back', () => {
  it('from its draw.io file: every icon and frame under its name, and the mark as no element', async () => {
    const ir = loadFixture('architecture', 'valid-gcp');
    const { output } = await emit(ir, 'drawio', { diagramId: 'a' });
    const page = extractDrawio(output).pages[0];
    const byLabel = (label) => page.nodes.find((n) => n.label === label);
    for (const c of ir.components.filter((x) => x.icon)) expect(byLabel(c.label), c.id).toMatchObject({ shape: 'icon', icon: c.icon });
    for (const b of ir.boundaries) expect(byLabel(b.label), b.id).toMatchObject({ shape: 'group', group: b.group });
    expect(page.nodes.filter((n) => !n.label)).toEqual([]);
    expect(page.nodes).toHaveLength(ir.components.length + ir.boundaries.length);
    expect(page.edges).toHaveLength(ir.connections.length);
  });

  it('from a file made by hand with the palette: the hexagon shape, a zone of the palette and the project frame', () => {
    const cell = (id, value, style, parent = '1') => `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="10" y="40" width="200" height="120" as="geometry"/></mxCell>`;
    const xml = `<mxfile><diagram id="p" name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${[
      cell('prj', 'Google Cloud Platform', catalog.gcp.groups.google_cloud.style),
      cell('mark', '', `${catalog.gcp.groups.google_cloud.mark.style}part=1;`, 'prj'),
      cell('net', 'prod-vpc network', catalog.gcp.groups.logical_group.style, 'prj'),
      cell('grp', 'Batch services', catalog.gcp.groups.logical_group.style, 'prj'),
      cell('dc', 'on-premises', catalog.gcp.groups.on_premises.style),
      cell('run', 'API', 'sketch=0;html=1;fillColor=#5184F3;strokeColor=none;shape=mxgraph.gcp2.hexIcon;prIcon=cloud_run;', 'net'),
      cell('old', 'Thing', 'shape=mxgraph.gcp2.hexIcon;prIcon=not_a_stencil;', 'net'),
      cell('box', 'Plain note', 'rounded=0;whiteSpace=wrap;html=1;fillColor=#F6F6F6;strokeColor=#666666;verticalAlign=top;'),
    ].join('')}</root></mxGraphModel></diagram></mxfile>`;
    const nodes = extractDrawio(xml).pages[0].nodes;
    expect(nodes.map((n) => [n.label, n.shape, n.icon ?? n.group])).toEqual([
      ['Google Cloud Platform', 'group', 'gcp:google_cloud'],
      ['prod-vpc network', 'group', 'gcp:vpc_network'],
      ['Batch services', 'group', 'gcp:logical_group'],
      ['on-premises', 'group', 'gcp:on_premises'],
      ['API', 'icon', 'gcp:cloud_run'],
      ['Thing', 'icon', 'drawio:mxgraph.gcp2.not_a_stencil'],
      ['Plain note', 'box', undefined],
    ]);
  });
});

describe('a GCP diagram on the native FigJam board', () => {
  it('draws the hexagon of each service once per script, the mark of the frame, and each frame title at the top of its frame', async () => {
    const ir = loadFixture('architecture', 'valid-gcp');
    const xml = (await emit(ir, 'drawio', { diagramId: 'a' })).output;
    const { parts } = figjamNative(xml, { title: ir.title });
    expect(parts.length).toBe(1);
    const D = scriptData(parts[0]);
    const pictures = D.items.filter((i) => i[0] === 'g').map((i) => i[1].split('#')[0]);
    for (const c of ir.components.filter((x) => x.icon)) expect(pictures, c.id).toContain(`mxgraph.gcp2.${c.icon.slice(4)}`);
    expect(pictures).toContain('mxgraph.gcp2.google_cloud_platform');
    expect(Object.keys(D.stencils).sort()).toEqual([...new Set(D.items.filter((i) => i[0] === 'g').map((i) => i[1]))].sort());
    // The group of a picture names its stencil, the group of a frame its kind of frame.
    const names = D.items.filter((i) => i[0] === '[').map((i) => i[1]);
    expect(names).toEqual(expect.arrayContaining(['Order API (GKE) [gcp:container_engine]', 'Google Cloud [gcp:google_cloud]', 'asia-northeast1 [gcp:region]', 'VPC network 10.0.0.0/16 [gcp:vpc_network]', 'Private subnet [gcp:subnet]']));
    // A frame is a filled rectangle with its title on the first line under its top side.
    const { cells } = checkDrawioStructure(xml);
    const abs = absoluteBounds(cells);
    for (const b of ir.boundaries) {
      const frame = abs.get(`a:${b.id}`);
      const title = D.items.find((i) => i[0] === 't' && i[5] === b.label);
      expect(title, b.id).toBeDefined();
      const offset = D.offset ?? [0, 0];
      expect(title[2] - offset[1] - frame.y, b.id).toBeGreaterThanOrEqual(0);
      expect(title[2] - offset[1] - frame.y, b.id).toBeLessThan(12);
      expect(title[6], b.id).toMatchObject({ v: 't', a: 'l' });
    }
  });
});

describe('the names people write for a service draw.io names otherwise', () => {
  const base = (components, boundaries = []) => ({ schemaVersion: 1, kind: 'architecture', title: 'T', components, boundaries, connections: [] });
  const hintFor = (icon) => validateIr(base([{ id: 'a', label: 'A', icon }])).errors[0].hint;
  const groupHint = (group) => validateIr(base([{ id: 'a', label: 'A' }], [{ id: 'b', label: 'B', group, children: ['a'] }])).errors[0].hint;

  it('are answered with the catalog name first, not with a name that only looks alike', () => {
    expect(hintFor('gcp:cloud_scheduler')).toMatch(/^did you mean gcp:scheduled_tasks\? That is draw\.io's name for it; /);
    expect(hintFor('gcp:gke')).toMatch(/^did you mean gcp:container_engine\?/);
    expect(hintFor('gcp:gke')).not.toContain('gke_on_prem');
    expect(hintFor('gcp:cloud_sql_instance')).toMatch(/^did you mean gcp:cloud_sql\?/);
    expect(hintFor('gcp:cloud_tasks_queue')).toMatch(/^did you mean gcp:cloud_tasks\?/);
    expect(hintFor('aws:alb')).toMatch(/^did you mean aws:elastic_load_balancing\?/);
    expect(groupHint('gcp:subnetwork')).toMatch(/^did you mean gcp:subnet\?/);
    for (const icon of ['gcp:cloud_scheduler', 'gcp:gke', 'aws:alb']) expect(hintFor(icon)).toContain(`references/${icon.slice(0, 3)}-icons.md`);
  });

  it('are answered with "no stencil" where draw.io has none, and with no name at all', () => {
    for (const icon of ['gcp:secret_manager', 'gcp:eventarc', 'gcp:workflows']) {
      const hint = hintFor(icon);
      expect(hint, icon).toMatch(/^draw\.io has no stencil for this service: leave "icon" out, and the component keeps its generic shape; /);
      expect(hint, icon).not.toContain('did you mean');
    }
  });

  it('lead to what an alias stands for when the written name only comes close to it', () => {
    expect(suggestCloudNames('icons', 'gcp:gke_cluster_prod')[0]).toBe('gcp:container_engine');
    expect(suggestCloudNames('icons', 'gcp:cloud_scheduler_job')[0]).toBe('gcp:scheduled_tasks');
    // Without an alias near it, the list is the nearest catalog names, as before.
    expect(suggestCloudNames('icons', 'gcp:cloudrun')).toEqual(nearestCloudNames('icons', 'gcp:cloudrun'));
    expect(suggestCloudNames('icons', 'gcp:zzzzqqqq')).toEqual([]);
  });

  it('are a table whose every target is a catalog name and whose every key is none', () => {
    for (const provider of Object.keys(PROVIDERS)) for (const [table, lookup] of [['icons', cloudIcon], ['groups', cloudGroup]]) {
      for (const [written, target] of cloudAliases(provider, table)) {
        expect(lookup(`${provider}:${written}`), `${provider}:${written} must not be a name`).toBeUndefined();
        if (target !== null) expect(lookup(`${provider}:${target}`), `${provider}:${target}`).toBeDefined();
        expect(cloudAlias(table, `${provider}:${written}`)).toEqual({ name: target === null ? null : `${provider}:${target}` });
      }
    }
    expect(cloudAlias('icons', 'gcp:cloud_run')).toBeUndefined();
    expect(cloudAlias('icons', 'azure:functions')).toBeUndefined();
  });

  it('are printed in the reference page of their provider, as text that is not taken for a name', () => {
    const page = readFileSync(join(scriptsDir, '..', 'references', 'gcp-icons.md'), 'utf8');
    expect(page).toContain('## Names that are written otherwise');
    expect(page).toContain('| gcp:cloud_scheduler | `gcp:scheduled_tasks` (`icon`) |');
    expect(page).toContain('| gcp:secret_manager | no stencil: leave `icon` out, the generic shape stays |');
    expect(page).toContain('| gcp:subnetwork | `gcp:subnet` (`group`) |');
    expect(readFileSync(join(scriptsDir, '..', 'references', 'aws-icons.md'), 'utf8')).toContain('| aws:alb | `aws:elastic_load_balancing` (`icon`) |');
  });
});

describe('a name that is written in the wrong list', () => {
  const base = (components, boundaries = []) => ({ schemaVersion: 1, kind: 'architecture', title: 'T', components, boundaries, connections: [] });

  it('is told apart: a frame written as an icon, an icon written as a frame, a name of the other cloud', () => {
    const asIcon = validateIr(base([{ id: 'a', label: 'A', icon: 'gcp:vpc_network' }])).errors[0];
    expect(asIcon.message).toBe('unknown GCP icon "gcp:vpc_network"');
    expect(asIcon.hint).toMatch(/^gcp:vpc_network is a group frame, not an icon: write it as "group" of the boundary that holds the components; /);
    const asGroup = validateIr(base([{ id: 'a', label: 'A' }], [{ id: 'b', label: 'B', group: 'gcp:cloud_run', children: ['a'] }])).errors[0];
    expect(asGroup.hint).toMatch(/^gcp:cloud_run is an icon, not a group frame: write it as "icon" of a component; /);
    const otherCloud = validateIr(base([{ id: 'a', label: 'A', icon: 'aws:cloud_run' }])).errors[0];
    expect(otherCloud.hint).toMatch(/^this name is GCP's: write gcp:cloud_run when the component runs on GCP; the nearest AWS names are aws:/);
    expect(otherCloud.hint).toContain('references/aws-icons.md');
    const awsFrame = validateIr(base([{ id: 'a', label: 'A' }], [{ id: 'b', label: 'B', group: 'gcp:availability_zone', children: ['a'] }])).errors[0];
    expect(awsFrame.hint).toMatch(/^did you mean gcp:zone\?/);
  });

  it('is found by the lookup, and a name that is nowhere is not', () => {
    expect(cloudNameElsewhere('icons', 'gcp:vpc_network')).toEqual({ value: 'gcp:vpc_network', table: 'groups', provider: 'gcp' });
    expect(cloudNameElsewhere('icons', 'aws:cloud_run')).toEqual({ value: 'gcp:cloud_run', table: 'icons', provider: 'gcp' });
    expect(cloudNameElsewhere('groups', 'gcp:vpc')).toEqual({ value: 'aws:vpc', table: 'groups', provider: 'aws' });
    expect(cloudNameElsewhere('icons', 'gcp:no_such_thing')).toBeUndefined();
  });
});
