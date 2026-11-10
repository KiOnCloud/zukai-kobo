/**
 * Build the AWS icon catalog from draw.io's own AWS palette definition, so every name the
 * emitter writes is a stencil draw.io really ships. draw.io draws an unknown stencil name as
 * an empty box without an error, which is why the names are taken from the source and
 * checked at validation time instead of being written from memory.
 *
 * Usage: node tools/generate-aws-icons.mjs <path to Sidebar-AWS4.js> [tag]
 *
 * The input is a local file; nothing is fetched. Download it for the pinned tag from
 *   https://raw.githubusercontent.com/jgraph/drawio/<tag>/src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js
 * The file is read as text and never evaluated.
 *
 * Writes src/aws-icons.json (bundled, read by the validator and the emitter) and
 * ../references/aws-icons.md (the list the model looks names up in).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TAG = 'v32.6.10';
const SOURCE_PATH = 'src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js';

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

const sorted = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

export function buildCatalog(source, tag) {
  const { icons, groups, conflicts } = parseSidebar(source);
  const catalog = {
    source: { repo: 'jgraph/drawio', tag, path: SOURCE_PATH, sha256: createHash('sha256').update(source).digest('hex') },
    icons: sorted(icons),
    groups: sorted(groups),
  };
  return { catalog, conflicts };
}

export function renderReference(catalog) {
  const out = [
    '# AWS icons and group frames',
    '',
    '<!-- Generated by scripts/tools/generate-aws-icons.mjs from scripts/src/aws-icons.json; do not edit. -->',
    '',
    `Names for the \`icon\` field of an architecture component and the \`group\` field of a boundary.`,
    `They are the stencil names of draw.io's built-in AWS library (${catalog.source.repo} ${catalog.source.tag}).`,
    'Write the value exactly as listed; a name that is not in this file fails validation.',
    'A service with no entry here keeps its generic shape: leave `icon` out.',
    '',
    '## Choosing',
    '',
    '- Frames nest from the outside in: AWS Cloud or account, region, VPC, Availability Zone or',
    '  subnet. Draw only the levels the request or the code names. The outermost frame is',
    '  `aws:aws_account` when an account is named or several accounts are shown, else',
    '  `aws:aws_cloud`; never both around the same content. Add `aws:region` inside it only',
    '  when the region is named.',
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
  return `${out.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, tag = DEFAULT_TAG] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node tools/generate-aws-icons.mjs <path to Sidebar-AWS4.js> [tag]');
    process.exit(2);
  }
  const { catalog, conflicts } = buildCatalog(readFileSync(input, 'utf8'), tag);
  const iconCount = Object.keys(catalog.icons).length;
  const groupCount = Object.keys(catalog.groups).length;
  // A changed sidebar layout shows up as a short catalog; refuse to write one.
  if (iconCount < 300 || groupCount < 20) {
    console.error(`found ${iconCount} icons and ${groupCount} groups; expected at least 300 and 20. The sidebar format may have changed.`);
    process.exit(1);
  }
  writeFileSync(join(here, '..', 'src', 'aws-icons.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(join(here, '..', '..', 'references', 'aws-icons.md'), renderReference(catalog));
  for (const c of conflicts) console.log(`colour differs between palettes, first kept: ${c}`);
  console.log(`wrote ${iconCount} icons and ${groupCount} groups from ${catalog.source.repo} ${tag}`);
}
