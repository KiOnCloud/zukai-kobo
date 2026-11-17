/**
 * Build the icon catalog from draw.io's own palette definitions, so every name the emitter
 * writes is a stencil draw.io really ships. draw.io draws an unknown stencil name as an empty
 * box without an error, which is why the names are taken from the source and checked at
 * validation time instead of being written from memory.
 *
 * Usage: node tools/generate-aws-icons.mjs <path to Sidebar-AWS4.js> [tag] [path to Sidebar-GCP2.js] [path to mxGCP2.js]
 *
 * The inputs are local files; nothing is fetched. Download them for the pinned tag from
 *   https://raw.githubusercontent.com/jgraph/drawio/<tag>/src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js
 *   https://raw.githubusercontent.com/jgraph/drawio/<tag>/src/main/webapp/js/diagramly/sidebar/Sidebar-GCP2.js
 *   https://raw.githubusercontent.com/jgraph/drawio/<tag>/src/main/webapp/shapes/mxGCP2.js
 * The files are read as text and never evaluated. The first holds the AWS icons and group
 * frames. The second holds the product logos (Firebase and the like), the GCP group frames
 * and the GCP resource figures; the third names the GCP service icons. Without the second the
 * logos of the existing catalog are kept, without the third its GCP part.
 *
 * Writes src/aws-icons.json (bundled, read by the validator and the emitter),
 * ../references/aws-icons.md and ../references/gcp-icons.md (the lists the model looks names
 * up in).
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The table of names people write for a service draw.io names otherwise, or has no stencil
 * for. It is kept by hand in src/cloud-aliases.json (the validator answers an unknown name
 * from it) and printed at the end of each reference page.
 */
function aliasSection(provider, prefix) {
  const aliases = JSON.parse(readFileSync(join(here, '..', 'src', 'cloud-aliases.json'), 'utf8'))[provider] ?? {};
  const rows = [];
  for (const [table, field] of [['icons', 'icon'], ['groups', 'group']]) {
    for (const [written, target] of Object.entries(aliases[table] ?? {})) {
      rows.push(`| ${prefix}:${written} | ${target === null ? `no stencil: leave \`${field}\` out, the generic shape stays` : `\`${prefix}:${target}\` (\`${field}\`)`} |`);
    }
  }
  if (rows.length === 0) return [];
  return ['', '## Names that are written otherwise', '', 'A name of the left column is not valid; it is what people write for the service. Validation answers it with the right column.', '', '| Not a name | Write |', '|---|---|', ...rows];
}
const DEFAULT_TAG = 'v32.6.10';
const SOURCE_PATH = 'src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js';
const LOGO_SOURCE_PATH = 'src/main/webapp/js/diagramly/sidebar/Sidebar-GCP2.js';
const GCP_SHAPES_PATH = 'src/main/webapp/shapes/mxGCP2.js';
/** The longer side of a figure that is not a square service icon, the side of a service icon. */
const FIGURE_SIDE = 78;
/**
 * A product logo is one colour, and the palette draws every one in the blue of its cards.
 * These take the colour the product is known by instead.
 */
const LOGO_FILL = { firebase: '#FFA000' };

/**
 * A service that several palettes list keeps the colour of the first one, in file order.
 * These follow the category AWS itself files the service under instead.
 */
const PREFERRED_CATEGORY = { elastic_load_balancing: 'Network & Content Delivery', api_gateway: 'Network & Content Delivery' };

const JS_STRING = "'((?:[^'\\\\]|\\\\.)*)'";
const plainTitle = (raw) => raw.replace(/\\n/g, ' ').replace(/\\(.)/g, '$1').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** The fill of a style string; a gradient is kept only when the palette really uses one. */
function colours(style) {
  const fill = /fillColor=(#[0-9A-Fa-f]{6})/.exec(style)?.[1];
  const gradient = /gradientColor=(#[0-9A-Fa-f]{6})/.exec(style)?.[1];
  return fill ? { fill: fill.toUpperCase(), ...(gradient ? { gradient: gradient.toUpperCase() } : {}) } : undefined;
}

/**
 * @param {string} source text of Sidebar-AWS4.js
 * @returns {{ icons: Record<string,{title:string,category:string,fill:string,gradient?:string}>, groups: Record<string,{title:string,style:string}>, conflicts: string[] }}
 */
export function parseSidebar(source) {
  // The palette builds each style by concatenation; fold the two constant operands in so a
  // style is one string literal.
  const text = source
    .replace(/' \+ mxConstants\.STYLE_SHAPE \+ ["']=mxgraph\.aws4\./g, "shape=mxgraph.aws4.")
    .replace(/shape=mxgraph\.aws4\.";/g, "shape=mxgraph.aws4.';")
    .replace(/' \+ gn \+ '/g, 'mxgraph.aws4');
  const pts = new RegExp(`var pts = ${JS_STRING};`).exec(text)?.[1] ?? '';

  const icons = {};
  const groups = {};
  const conflicts = [];
  const addIcon = (name, rawTitle, category, colour) => {
    if (!colour) throw new Error(`no fill colour found for icon "${name}" in palette "${category}"`);
    const entry = { title: plainTitle(rawTitle), category, ...colour };
    const known = icons[name];
    if (!known || (PREFERRED_CATEGORY[name] === category && known.category !== category)) icons[name] = entry;
    else if (PREFERRED_CATEGORY[name]) return;
    else if (known.fill !== entry.fill) conflicts.push(`${name}: kept ${known.fill} (${known.category}), also ${entry.fill} (${category})`);
  };

  const palettes = text.split(/(?=\tSidebar\.prototype\.addAWS4\w*Palette = function)/).slice(1);
  for (const body of palettes) {
    const fn = /addAWS4(\w*)Palette/.exec(body)[1];
    const category = plainTitle(new RegExp(`addPaletteFunctions\\('[^']*', ${JS_STRING}`).exec(body)?.[1] ?? '').replace(/^AWS \/ /, '');
    if (!category) continue;

    if (fn === 'Groups') {
      const n4 = new RegExp(`var n4 = pts \\+ ${JS_STRING};`).exec(body)?.[1];
      const entry = new RegExp(`createVertexTemplateEntry\\((n4 \\+ )?${JS_STRING},\\s*s \\* 130, s \\* 130, ${JS_STRING}, ${JS_STRING}`, 'g');
      for (const m of body.matchAll(entry)) {
        const title = plainTitle(m[4]);
        let key = slug(title);
        if (groups[key]) key += '_alt';
        if (groups[key]) throw new Error(`three groups share the title "${title}"`);
        groups[key] = { title, style: m[1] ? `${pts}${n4}${m[2]}` : m[2] };
      }
      continue;
    }

    // The general resources are shapes of their own, not service icons in a coloured square:
    // each has its size, and one colour for all. They stand for what is not an AWS service
    // (a client, a server, another party's application).
    if (fn === 'GeneralResources') {
      const style = new RegExp(`var n = ${JS_STRING}`).exec(body)?.[1] ?? '';
      const colour = colours(style);
      for (const m of body.matchAll(new RegExp(`createVertexTemplateEntry\\(n \\+ '([a-z0-9_]+);',\\s*s \\* (\\d+), s \\* (\\d+), '', ${JS_STRING}`, 'g'))) {
        if (!colour) throw new Error('no fill colour found for the general resources');
        if (icons[m[1]]) continue;
        icons[m[1]] = { title: plainTitle(m[4]), category, ...colour, width: Number(m[2]), height: Number(m[3]) };
      }
      continue;
    }

    // Style variables of this palette: `var n2 = '...';`
    const vars = new Map();
    for (const m of body.matchAll(new RegExp(`var (\\w+) = ${JS_STRING}`, 'g'))) vars.set(m[1], colours(m[2]));
    const tail = `,\\s*w2, w2, '', ${JS_STRING}`;
    for (const m of body.matchAll(new RegExp(`createVertexTemplateEntry\\((\\w+) \\+ 'resourceIcon;resIcon=mxgraph\\.aws4\\.([a-z0-9_]+);'${tail}`, 'g'))) {
      addIcon(m[2], m[3], category, vars.get(m[1]));
    }
    // The retired palette passes the colour to a helper: svc('#8C4FFF') + 'name;'
    for (const m of body.matchAll(new RegExp(`createVertexTemplateEntry\\(svc\\('(#[0-9A-Fa-f]{6})'\\) \\+ '([a-z0-9_]+);'${tail}`, 'g'))) {
      addIcon(m[2], m[3], category, { fill: m[1].toUpperCase() });
    }
    // ...or uses a ready style that already ends in `resIcon=mxgraph.aws4.`
    for (const m of body.matchAll(new RegExp(`createVertexTemplateEntry\\((\\w+) \\+ '([a-z0-9_]+);'${tail}`, 'g'))) {
      const style = new RegExp(`var ${m[1]} = ${JS_STRING}`).exec(body)?.[1] ?? '';
      if (style.endsWith('resIcon=mxgraph.aws4.')) addIcon(m[2], m[3], category, colours(style));
    }
  }
  return { icons, groups, conflicts };
}

/**
 * The product logos of draw.io's GCP library: one stencil each, drawn in one colour, with the
 * proportions the palette gives it. The longer side becomes `FIGURE_SIDE`.
 * @param {string} source text of Sidebar-GCP2.js
 * @returns {Record<string,{title:string,fill:string,width:number,height:number}>}
 */
export function parseLogos(source) {
  const body = /addGCP2ProductCardsPalette = function[\s\S]*?\n\t};/.exec(source)?.[0] ?? '';
  const fill = /addGCP2ProductCardSet = function[\s\S]*?fillColor=(#[0-9A-Fa-f]{6})/.exec(source)?.[1];
  const logos = {};
  for (const m of body.matchAll(new RegExp(`addGCP2ProductCardSet\\(${JS_STRING}, '([a-z0-9_]+)', ([\\d.]+), ([\\d.]+),`, 'g'))) {
    if (!fill) throw new Error('no fill colour found for the product logos');
    const [x, y] = [Number(m[3]), Number(m[4])];
    const scale = FIGURE_SIDE / Math.max(x, y);
    logos[m[2]] = { title: plainTitle(m[1]), fill: LOGO_FILL[m[2]] ?? fill.toUpperCase(), width: Math.round(x * scale), height: Math.round(y * scale) };
  }
  return logos;
}

/**
 * The category of a GCP service icon whose title no palette of the sidebar lists. A name that
 * is neither there nor here stops the generator: a new icon gets its category on purpose.
 */
const GCP_CATEGORY = {
  gpu: 'Compute', gke_on_prem: 'Compute',
  cloud_security_scanner: 'Security',
  data_studio: 'Data Analytics',
  cloud_machine_learning: 'AI and Machine Learning', cloud_speech_api: 'AI and Machine Learning', cloud_jobs_api: 'AI and Machine Learning', ai_hub: 'AI and Machine Learning',
  cloud_inference_api: 'AI and Machine Learning', recommendations_ai: 'AI and Machine Learning',
  cloud_apis: 'Operations', cloud_iot_edge: 'Internet of Things',
  dedicated_interconnect: 'Networking', cloud_service_mesh: 'Networking', traffic_director: 'Networking',
};
/** The newer icon palettes name three categories differently from the product palettes; one name each. */
const GCP_CATEGORY_ALIAS = { 'CI/CD': 'CI - CD', Analytics: 'Data Analytics', Serverless: 'Compute' };
/**
 * The names of the GCP group frames, by the title the palette gives each. A title that is not
 * here is named by its slug. The library has no frame of its own for a VPC network: its
 * frame for a logical grouping stands for one, under a second name.
 */
const GCP_GROUP_NAMES = {
  'Project Zone': [{ name: 'google_cloud', title: 'Google Cloud' }],
  'Project Zone / Cloud Service Provider': [{ name: 'project', title: 'Project' }],
  'Logical Grouping of Services / Instances': [{ name: 'logical_group', title: 'Logical grouping of services or instances' }, { name: 'vpc_network', title: 'VPC network' }],
  SubNetwork: [{ name: 'subnet', title: 'Subnetwork' }],
  pod: [{ name: 'pod', title: 'Pod' }],
  'Infrastructure System': [{ name: 'infrastructure_system', title: 'Infrastructure system' }],
  'colo / dc / on-premises': [{ name: 'on_premises', title: 'On-premises (colo, data center)' }],
  'System 1': [{ name: 'system', title: 'System' }],
  'External SaaS Providers': [{ name: 'external_saas', title: 'External SaaS providers' }],
  'External Data Sources': [{ name: 'external_data_sources', title: 'External data sources' }],
  'External Infrastructure 3rd party': [{ name: 'external_infrastructure_3rd_party', title: 'External infrastructure, 3rd party' }],
  'External Infrastructure 1st party': [{ name: 'external_infrastructure_1st_party', title: 'External infrastructure, 1st party' }],
};

const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** A style without the stray tokens the palette source carries (a colour with no key before it). */
const tidyStyle = (style) => style.split(';').filter((part) => part !== '' && !/^[0-9A-Fa-f]{6}$/.test(part)).map((part) => `${part};`).join('');

/**
 * The GCP part of the catalog.
 *
 * A service icon is one stencil, a hexagon in the colour of the cell with the pictogram of
 * the service cut out in white. The shape definition (mxGCP2.js) lists the names, each with
 * the title or titles the service goes by; the palettes of the sidebar say which category a
 * title belongs to. The sidebar also holds the figures of what a service is made of or talks
 * to (a bucket, a gateway, a laptop), each a stencil of its own in grey, and the frames.
 * Sizes follow the palette: a service icon is as wide as an AWS one, and a resource figure is
 * as much smaller than it as the icon of a service card is in the palette.
 * @param {string} sidebar text of Sidebar-GCP2.js
 * @param {string} shapes text of mxGCP2.js
 * @returns {{ icons: Record<string,{title:string,category:string,fill:string,width:number,height:number}>, groups: Record<string,{title:string,style:string,mark?:object}> }}
 */
export function parseGcp(sidebar, shapes) {
  const palettes = sidebar.split(/(?=\tSidebar\.prototype\.addGCP2\w* = function)/).slice(1);
  const body = (fn) => palettes.find((p) => p.startsWith(`\tSidebar.prototype.${fn} = function`)) ?? '';
  const paletteTitle = (text) => plainTitle(new RegExp(`this\\.addPalette\\('[^']*', ${JS_STRING}`).exec(text)?.[1] ?? '');

  // Which category a title belongs to: the product palettes first, then the newer icon palettes.
  const categoryOf = new Map();
  for (const text of palettes) {
    const palette = paletteTitle(text);
    const named = /^GCP(?: Icons)? \/ (.+)$/.exec(palette)?.[1];
    if (!named) continue;
    const category = GCP_CATEGORY_ALIAS[named] ?? named;
    const titles = [
      ...[...text.matchAll(new RegExp(`addGCP2UserProductCardSet\\(${JS_STRING}`, 'g'))].map((m) => m[1]),
      ...(palette.startsWith('GCP Icons') ? [...text.matchAll(new RegExp(`s \\* \\d+, s \\* \\d+, ${JS_STRING}, null`, 'g'))].map((m) => m[1]) : []),
    ];
    for (const raw of titles) {
      const key = squash(plainTitle(raw)).replace(/^cloud/, '');
      if (key && !categoryOf.has(key)) categoryOf.set(key, category);
    }
  }

  const icons = {};
  const add = (name, entry) => { if (!icons[name]) icons[name] = entry; };

  // Service icons: the values of the `prIcon` property, with the size the palette draws one in.
  const helper = body('addGCP2CardSet');
  const fill = /fillColor=(#[0-9A-Fa-f]{6})/.exec(helper)?.[1]?.toUpperCase();
  const size = /new mxGeometry\(0, 0\.5, (\d+), (\d+)\)/.exec(helper);
  const list = /name: 'prIcon'[\s\S]*?enumList: \[([\s\S]*?)\]\}/.exec(shapes)?.[1] ?? '';
  const titles = new Map();
  for (const m of list.matchAll(new RegExp(`\\{val: '([a-z0-9_]+)', dispName: ${JS_STRING}\\}`, 'g'))) {
    if (m[1] === 'placeholder') continue;
    if (!titles.has(m[1])) titles.set(m[1], []);
    titles.get(m[1]).push(plainTitle(m[2]));
  }
  if (titles.size > 0 && (!fill || !size)) throw new Error('no fill colour or size found for the GCP service icons');
  const unit = size ? FIGURE_SIDE / Number(size[1]) : 1;
  for (const [name, known] of titles) {
    // A stencil that stands for several services is titled by the one it is named after.
    const title = known.find((t) => squash(name).endsWith(squash(t))) ?? known[0];
    const category = [...known, name].map((t) => categoryOf.get(squash(t).replace(/^cloud/, ''))).find(Boolean) ?? GCP_CATEGORY[name];
    if (!category) throw new Error(`no category for the GCP service icon "${name}" (${known.join(', ')}): add it to GCP_CATEGORY`);
    add(name, { title, category, fill, width: FIGURE_SIDE, height: Math.round(Number(size[2]) * unit) });
  }

  // Resource figures: the icon of a service card, and the figure of a user or device card.
  const figures = [
    { fn: 'addGCP2ServiceCard', palette: 'addGCP2ServiceCardsPalette', call: new RegExp(`addGCP2ServiceCard\\(${JS_STRING}, '([a-z0-9_]+)',`, 'g'), box: () => { const m = /new mxGeometry\(0, 0\.5, (\d+), (\d+)\)/.exec(body('addGCP2ServiceCard')); return m && [Number(m[1]), Number(m[2])]; } },
    { fn: 'addGCP2UserDeviceCard', palette: 'addGCP2UserDeviceCardsPalette', call: new RegExp(`addGCP2UserDeviceCard\\(${JS_STRING}, '([a-z0-9_]+)', ([\\d.]+), ([\\d.]+),`, 'g'), box: (m) => { const side = /new mxGeometry\(0\.5, 0, (\d+) \* scaleX/.exec(body('addGCP2UserDeviceCard')); return side && [Number(side[1]) * Number(m[3]), Number(side[1]) * Number(m[4])]; } },
  ];
  for (const { fn, palette, call, box } of figures) {
    const text = body(palette);
    const category = paletteTitle(text).replace(/^GCP \/ /, '');
    const colour = /fillColor=(#[0-9A-Fa-f]{6})/.exec(body(fn))?.[1]?.toUpperCase();
    for (const m of text.matchAll(call)) {
      if (m[2] === 'blank') continue;
      const drawn = box(m);
      // The longer side of every resource figure: the side of a service card's icon, at the scale of a service icon.
      const card = figures[0].box();
      if (!colour || !drawn || !card) throw new Error(`no fill colour or size found for the figures of ${fn}`);
      const scale = Math.round(card[0] * unit) / Math.max(...drawn);
      add(m[2], { title: plainTitle(m[1]), category, fill: colour, width: Math.round(drawn[0] * scale), height: Math.round(drawn[1] * scale) });
    }
  }

  // Group frames: the zones, the nested frames of the project legend, and the project frame with the logo.
  const groups = {};
  const addGroup = (paletteName, style, extra = {}) => {
    for (const { name, title } of GCP_GROUP_NAMES[paletteName] ?? [{ name: slug(paletteName), title: paletteName }]) {
      if (!groups[name]) groups[name] = { title, style: tidyStyle(style), ...extra };
    }
  };
  const zones = body('addGCP2ZonesPalette');
  const shared = new RegExp(`var s = ${JS_STRING};`).exec(zones)?.[1] ?? '';
  for (const m of zones.matchAll(new RegExp(`createVertexTemplateEntry\\(s \\+ 'fillColor=(#[0-9A-Fa-f]{6});',\\s*\\d+, \\d+, ${JS_STRING}, ${JS_STRING}`, 'g'))) {
    // A white frame cannot be told from the page.
    if (m[1].toLowerCase() === '#ffffff') continue;
    addGroup(plainTitle(m[3]), `${shared}fillColor=${m[1]};`);
  }
  for (const m of zones.matchAll(new RegExp(`addDataEntry\\([^,]+, \\d+, \\d+, ${JS_STRING}, '([A-Za-z0-9+/=]+)'`, 'g'))) {
    const xml = decodeURIComponent(inflateRawSync(Buffer.from(m[2], 'base64')).toString('utf8'));
    for (const cell of xml.matchAll(/<mxCell id="\d+" value="([^"]*)" style="([^"]*)" vertex="1"/g)) addGroup(cell[1], cell[2]);
  }
  const project = new RegExp(`new mxCell\\(${JS_STRING}, new mxGeometry\\(0, 0, \\d+, \\d+\\),\\s*${JS_STRING}\\);[\\s\\S]*?new mxGeometry\\(0, 0, (\\d+), (\\d+)\\),\\s*'(shape=mxgraph\\.gcp2\\.[a-z0-9_]+;[^']*)'\\);[\\s\\S]*?new mxPoint\\((\\d+), (\\d+)\\);[\\s\\S]*?'Project Zone'\\)`).exec(zones);
  if (project) addGroup('Project Zone', project[2], { mark: { style: tidyStyle(project[5]), x: Number(project[6]), y: Number(project[7]), width: Number(project[3]), height: Number(project[4]) } });
  return { icons, groups };
}

const sorted = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * @param {string} source text of Sidebar-AWS4.js
 * @param {string} tag
 * @param {{source?:string, kept?:{source:object, logos:object}}} [logos] the text of
 *   Sidebar-GCP2.js, or the logos of an existing catalog to carry over
 * @param {{shapes?:string, kept?:{source:object, gcp:object}}} [gcp] the text of mxGCP2.js
 *   (read together with the text of Sidebar-GCP2.js), or the GCP part of an existing catalog
 */
export function buildCatalog(source, tag, logos = {}, gcp = {}) {
  const { icons, groups, conflicts } = parseSidebar(source);
  const logoSource = logos.source !== undefined ? { path: LOGO_SOURCE_PATH, sha256: sha256(logos.source) } : logos.kept?.source;
  const logoTable = logos.source !== undefined ? parseLogos(logos.source) : (logos.kept?.logos ?? {});
  const fresh = gcp.shapes !== undefined && logos.source !== undefined;
  const gcpSource = fresh ? { path: GCP_SHAPES_PATH, sha256: sha256(gcp.shapes) } : gcp.kept?.source;
  const gcpPart = fresh ? parseGcp(logos.source, gcp.shapes) : gcp.kept?.gcp;
  // A logo keeps its name: a GCP figure of the same name would change what existing diagrams show.
  const gcpIcons = Object.fromEntries(Object.entries(gcpPart?.icons ?? {}).filter(([name]) => !Object.hasOwn(logoTable, name)));
  const catalog = {
    source: { repo: 'jgraph/drawio', tag, path: SOURCE_PATH, sha256: sha256(source), ...(logoSource ? { logos: logoSource } : {}), ...(gcpSource ? { gcp: gcpSource } : {}) },
    icons: sorted(icons),
    groups: sorted(groups),
    logos: sorted(logoTable),
    ...(gcpPart ? { gcp: { icons: sorted(gcpIcons), groups: sorted(gcpPart.groups) } } : {}),
  };
  return { catalog, conflicts };
}

export function renderReference(catalog) {
  const out = [
    '# AWS icons and group frames',
    '',
    '<!-- Generated by scripts/tools/generate-aws-icons.mjs from scripts/src/aws-icons.json and scripts/src/cloud-aliases.json; do not edit. -->',
    '',
    `Names for the \`icon\` field of an architecture component and the \`group\` field of a boundary.`,
    `They are the stencil names of draw.io's built-in AWS library (${catalog.source.repo} ${catalog.source.tag}).`,
    'Write the value exactly as listed; a name that is not in this file fails validation.',
    'A service with no entry here keeps its generic shape: leave `icon` out.',
    'A system outside AWS takes a general resource or a product logo, both listed below.',
    'The icons and group frames of Google Cloud are in `gcp-icons.md`.',
    '',
    '## Choosing',
    '',
    '- Frames nest from the outside in: AWS Cloud or account, region, VPC, Availability Zone or',
    '  subnet. Draw only the levels the request or the code names. The outermost frame is',
    '  `aws:aws_account` when an account is named or several accounts are shown, else',
    '  `aws:aws_cloud`; never both around the same content. Add `aws:region` inside it only',
    '  when the region is named. A system said to run on AWS always gets that outermost frame; a',
    '  region, a VPC or a subnet the user cannot name is not drawn and not invented, and',
    '  `meta.notes` says so in one `assumed:` entry.',
    '- A service that runs outside the VPC (S3, SQS, SNS, DynamoDB, a Lambda function without a',
    '  VPC configuration, CloudFront, Route 53) goes in the region or the outer frame, not in a',
    '  subnet.',
    '- Supporting resources are not components: an internet or NAT gateway, a route table, an',
    '  IAM role, a target group, a subnet group, an ECS cluster or task definition. Leave them',
    '  out (a subnet with a route to an internet gateway is simply the public subnet) unless',
    '  the user asks for the network or permission detail.',
    '- A VPC, a subnet or a security group is a frame (`group`), not a component: `aws:vpc` is',
    '  also in the icon list, for the rare diagram that shows the VPC service as one box.',
    '- Containers on Fargate take `aws:fargate`, on EC2 instances `aws:ecs`; a Kubernetes',
    '  workload takes `aws:eks`.',
    '- `kind` beside an icon is what the other targets draw: `database` for a store (RDS,',
    '  DynamoDB, S3), `queue` for a queue, topic or stream, `cache` for a cache, `service` (the',
    '  default) for the rest.',
    '- A system outside AWS (`kind` `external`: a third-party API, the customer\'s own system,',
    '  a SaaS product) gets an icon too, so it reads as a system and not as a note. Use its',
    '  product logo when one is listed under "Product logos" (`gcp:firebase`), else a general',
    '  resource: `aws:generic_application` for an API or a SaaS product, `aws:traditional_server`',
    '  or `aws:servers` for a system on its own machines, `aws:corporate_data_center` for a',
    '  whole site, `aws:generic_database` for a database. A general resource is dark, a service',
    '  icon has the colour of its category, so the two never look alike; a general resource',
    '  never stands for an AWS service.',
    '',
    '## Group frames (`group`)',
    '',
    '| Value | Frame |',
    '|---|---|',
    ...Object.entries(catalog.groups).map(([key, g]) => `| \`aws:${key}\` | ${g.title} |`),
    '',
    '## Service icons (`icon`)',
  ];
  const byCategory = new Map();
  for (const [name, icon] of Object.entries(catalog.icons)) {
    if (!byCategory.has(icon.category)) byCategory.set(icon.category, []);
    byCategory.get(icon.category).push([name, icon]);
  }
  for (const category of [...byCategory.keys()].sort()) {
    out.push('', `### ${category}`, '', '| Value | Service |', '|---|---|');
    for (const [name, icon] of byCategory.get(category)) out.push(`| \`aws:${name}\` | ${icon.title} |`);
  }
  if (Object.keys(catalog.logos ?? {}).length > 0) {
    out.push('', '## Product logos (`icon`)', '', 'From draw.io\'s GCP library, for a product an AWS system talks to.', '', '| Value | Product |', '|---|---|');
    for (const [name, logo] of Object.entries(catalog.logos)) out.push(`| \`gcp:${name}\` | ${logo.title} |`);
  }
  out.push(...aliasSection('aws', 'aws'));
  return `${out.join('\n')}\n`;
}

/** The lookup page of the GCP names: frames, service icons by category, resource figures, product logos. */
export function renderGcpReference(catalog) {
  const gcp = catalog.gcp ?? { icons: {}, groups: {} };
  const out = [
    '# GCP icons and group frames',
    '',
    '<!-- Generated by scripts/tools/generate-aws-icons.mjs from scripts/src/aws-icons.json and scripts/src/cloud-aliases.json; do not edit. -->',
    '',
    'Names for the `icon` field of an architecture component and the `group` field of a boundary',
    'when the system runs on Google Cloud. They are the stencil names of draw.io\'s built-in GCP',
    `library (${catalog.source.repo} ${catalog.source.tag}). Write the value exactly as listed; a name that is not in this`,
    'file fails validation. A service with no entry here keeps its generic shape: leave `icon`',
    'out. The AWS names are in `aws-icons.md`; the rules of `SKILL.md` (AWS icons, GCP icons) hold for both.',
    '',
    '## Choosing',
    '',
    '- Frames nest from the outside in: Google Cloud or project, region, VPC network, zone or',
    '  subnet. Draw only the levels the request or the code names. The outermost frame is',
    '  `gcp:project` when a project is named or several projects are shown, else',
    '  `gcp:google_cloud`, the frame with the Google Cloud mark; never both around the same',
    '  content. Add `gcp:region` inside it only when the region is named. A system said to run',
    '  on Google Cloud always gets that outermost frame; a region, a network or a subnet the',
    '  user cannot name is not drawn and not invented, and `meta.notes` says so in one',
    '  `assumed:` entry.',
    '- A VPC network is global and a subnet belongs to one region. Nest the way the diagram is',
    '  read: `gcp:region` around `gcp:vpc_network` around `gcp:subnet` for a system in one',
    '  region; `gcp:vpc_network` around one `gcp:region` per region when the network spans',
    '  several. draw.io\'s library has no frame of its own for a VPC network: `gcp:vpc_network`',
    '  is its frame for a logical grouping, which `gcp:logical_group` names for any other use.',
    '- A service that runs outside the VPC network (Cloud Storage, Pub/Sub, BigQuery, Firestore,',
    '  Cloud Run or Cloud Functions, Cloud CDN, Cloud DNS) goes in the region or the outer',
    '  frame, not in a subnet. It goes in the region frame when it is regional (Cloud Run, a',
    '  regional bucket) and also when it is global but only components of that region use it',
    '  (a Pub/Sub topic between two services of one region): the frame shows where the system',
    '  runs, and a component drawn outside the frame of everything it talks to sends its',
    '  connections round that frame. It goes in the outer frame when the regions share it or',
    '  it stands in front of them (Cloud CDN, Cloud DNS, a global load balancer). Cloud Run',
    '  with a VPC connector or direct VPC egress still stands outside the network: draw its',
    '  connection into the network.',
    '- Supporting resources are not components: a Cloud Router or Cloud NAT, a route, a',
    '  firewall rule, a service account or an IAM binding, a serverless VPC access connector',
    '  and its subnet, the reserved range and peering of private services access, a backend',
    '  service or URL map of a load balancer, a GKE node pool, a Pub/Sub subscription (it is',
    '  the connection from its topic to its subscriber). Leave them out unless the user asks',
    '  for the network or permission detail.',
    '- A VPC network, a subnet, a zone or a GKE cluster is a frame (`group`), not a component:',
    '  `gcp:virtual_private_cloud` is also in the icon list, for the rare diagram that shows',
    '  the VPC service as one box.',
    '- GKE workloads take `gcp:container_engine` (Kubernetes Engine), Compute Engine instances',
    '  `gcp:compute_engine`, a managed instance group one `gcp:compute_engine` in a',
    '  `gcp:instance_group` frame only when the group itself matters.',
    '- Names follow draw.io, which keeps some older product names: Cloud Build is',
    '  `gcp:container_builder`, Artifact Registry takes `gcp:container_registry`, Cloud',
    '  Monitoring and Cloud Logging take `gcp:stackdriver` and `gcp:logging`, Memorystore is',
    '  `gcp:cloud_memorystore`, Cloud Scheduler takes the resource figure `gcp:scheduled_tasks`.',
    '  A service draw.io has no stencil for (Secret Manager, Eventarc, Workflows, AlloyDB,',
    '  Cloud Composer) keeps its generic shape.',
    '- `kind` beside an icon is what the other targets draw: `database` for a store (Cloud SQL,',
    '  Spanner, Firestore, Bigtable, BigQuery, Cloud Storage), `queue` for a Pub/Sub topic or a',
    '  Cloud Tasks queue, `cache` for Memorystore, `service` (the default) for the rest.',
    '- A system outside Google Cloud (`kind` `external`: a third-party API, the customer\'s own',
    '  system, a SaaS product) gets an icon too, so it reads as a system and not as a note. Use',
    '  its product logo when one is listed under "Product logos" (`gcp:firebase`), else a grey',
    '  resource figure: `gcp:application` for an API or a SaaS product, `gcp:database` or',
    '  `gcp:storage` for a store, `gcp:users`, `gcp:desktop`, `gcp:laptop` or `gcp:phone` for',
    '  people and their devices. The general resources of `aws-icons.md` may stand in a GCP',
    '  diagram as well. A resource figure is grey, a service icon is the blue hexagon, so the',
    '  two never look alike; a resource figure never stands for a GCP service that has an icon.',
    '- A diagram of a system on both clouds uses both lists: each component takes the icon of',
    '  the cloud it runs on, and each cloud gets its own outer frame.',
    '',
    '## Group frames (`group`)',
    '',
    '| Value | Frame |',
    '|---|---|',
    ...Object.entries(gcp.groups).map(([key, g]) => `| \`gcp:${key}\` | ${g.title} |`),
    '',
    '## Service icons and resource figures (`icon`)',
  ];
  const byCategory = new Map();
  for (const [name, icon] of Object.entries(gcp.icons)) {
    if (!byCategory.has(icon.category)) byCategory.set(icon.category, []);
    byCategory.get(icon.category).push([name, icon]);
  }
  // The service categories in alphabetical order, the resource figures (grey, not hexagons) after them.
  const serviceFill = Object.values(gcp.icons)[0]?.fill;
  const isResource = (category) => byCategory.get(category)[0][1].fill !== serviceFill;
  const categories = [...byCategory.keys()].sort((a, b) => Number(isResource(a)) - Number(isResource(b)) || a.localeCompare(b));
  for (const category of categories) {
    out.push('', `### ${category}${isResource(category) ? ' (resource figures)' : ''}`, '', `| Value | ${isResource(category) ? 'Figure' : 'Service'} |`, '|---|---|');
    for (const [name, icon] of byCategory.get(category)) out.push(`| \`gcp:${name}\` | ${icon.title} |`);
  }
  if (Object.keys(catalog.logos ?? {}).length > 0) {
    out.push('', '## Product logos (`icon`)', '', 'For a product a system talks to; each is drawn in its own shape.', '', '| Value | Product |', '|---|---|');
    for (const [name, logo] of Object.entries(catalog.logos)) out.push(`| \`gcp:${name}\` | ${logo.title} |`);
  }
  out.push(...aliasSection('gcp', 'gcp'));
  return `${out.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, tag = DEFAULT_TAG, logoInput, shapesInput] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node tools/generate-aws-icons.mjs <path to Sidebar-AWS4.js> [tag] [path to Sidebar-GCP2.js] [path to mxGCP2.js]');
    process.exit(2);
  }
  const target = join(here, '..', 'src', 'aws-icons.json');
  const existing = JSON.parse(readFileSync(target, 'utf8'));
  const logos = logoInput ? { source: readFileSync(logoInput, 'utf8') } : { kept: { source: existing.source.logos, logos: existing.logos } };
  const gcp = logoInput && shapesInput ? { shapes: readFileSync(shapesInput, 'utf8') } : { kept: { source: existing.source.gcp, gcp: existing.gcp } };
  const { catalog, conflicts } = buildCatalog(readFileSync(input, 'utf8'), tag, logos, gcp);
  const iconCount = Object.keys(catalog.icons).length;
  const groupCount = Object.keys(catalog.groups).length;
  const gcpIconCount = Object.keys(catalog.gcp?.icons ?? {}).length;
  const gcpGroupCount = Object.keys(catalog.gcp?.groups ?? {}).length;
  // A changed sidebar layout shows up as a short catalog; refuse to write one.
  if (iconCount < 300 || groupCount < 20) {
    console.error(`found ${iconCount} icons and ${groupCount} groups; expected at least 300 and 20. The sidebar format may have changed.`);
    process.exit(1);
  }
  if (catalog.gcp && (gcpIconCount < 100 || gcpGroupCount < 15)) {
    console.error(`found ${gcpIconCount} GCP icons and ${gcpGroupCount} GCP groups; expected at least 100 and 15. The GCP sidebar or shape format may have changed.`);
    process.exit(1);
  }
  writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(join(here, '..', '..', 'references', 'aws-icons.md'), renderReference(catalog));
  writeFileSync(join(here, '..', '..', 'references', 'gcp-icons.md'), renderGcpReference(catalog));
  for (const c of conflicts) console.log(`colour differs between palettes, first kept: ${c}`);
  console.log(`wrote ${iconCount} icons, ${groupCount} groups and ${Object.keys(catalog.logos).length} product logos, ${gcpIconCount} GCP icons and ${gcpGroupCount} GCP groups from ${catalog.source.repo} ${tag}`);
}
