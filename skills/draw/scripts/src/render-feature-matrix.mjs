import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import matrix from './feature-matrix.json' with { type: 'json' };

/** Render feature-matrix.json as the Markdown page docs/feature-matrix.md. */
export function renderFeatureMatrix() {
  const targets = matrix.targets;
  const cell = (entry, target) => {
    const v = entry?.[target];
    if (v === undefined) return 'missing';
    if (typeof v === 'string') return v;
    return v.note ? `${v.status} (${v.note})` : v.status;
  };
  const lines = [
    '# Feature matrix',
    '',
    'Generated from `skills/draw/scripts/src/feature-matrix.json` by `npm run docs:matrix`',
    'in `skills/draw/scripts`. A test fails when this page drifts from the JSON.',
    '',
    'For each diagram kind, target and feature the value is one of:',
    '',
    '- `supported`: emitted natively.',
    '- `degraded`: emitted with an explicit warning that names the element and what was lost.',
    '- `unsupported`: validation fails for that target with the full error list.',
    '',
  ];
  for (const [kind, entry] of Object.entries(matrix.kinds)) {
    lines.push(`## ${kind}`, '');
    lines.push(`| Feature | ${targets.join(' | ')} |`);
    lines.push(`|---|${targets.map(() => '---').join('|')}|`);
    lines.push(`| kind | ${targets.map((t) => cell(entry.kind, t)).join(' | ')} |`);
    for (const [feature, f] of Object.entries(entry.features)) {
      lines.push(`| \`${feature}\` | ${targets.map((t) => cell(f, t)).join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('## bundle', '', 'Options of `bundle`, the combined file of a run (`figjam` has no bundle).', '');
  lines.push(`| Feature | ${targets.join(' | ')} |`);
  lines.push(`|---|${targets.map(() => '---').join('|')}|`);
  for (const [feature, f] of Object.entries(matrix.bundle)) {
    lines.push(`| \`${feature}\` | ${targets.map((t) => cell(f, t)).join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export const docsPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', 'feature-matrix.md');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(docsPath, renderFeatureMatrix(), 'utf8');
  console.log(`wrote ${docsPath}`);
}
