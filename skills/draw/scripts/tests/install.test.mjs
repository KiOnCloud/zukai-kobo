import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const installer = join(repoRoot, 'install.sh');
// The installer ships with the repository, not with a copied skill, and needs a POSIX shell.
const runnable = existsSync(installer) && process.platform !== 'win32';

const run = (target, dest) => execFileSync('sh', [installer, '--target', target, '--dest', dest], { encoding: 'utf8', stdio: 'pipe' });
const frontmatterName = (file) => readFileSync(file, 'utf8').match(/^name: (.+)$/m)?.[1];

describe.skipIf(!runnable)('install.sh', () => {
  it('keeps the plugin skills named draw and revise in the source', () => {
    expect(frontmatterName(join(repoRoot, 'skills', 'draw', 'SKILL.md'))).toBe('draw');
    expect(frontmatterName(join(repoRoot, 'skills', 'revise', 'SKILL.md'))).toBe('revise');
  });

  for (const [target, subdir] of [['codex', '.agents/skills'], ['claude-project', '.claude/skills']]) {
    it(`installs the ${target} copies as zukai and zukai-revise, in folder and in name`, () => {
      const dest = mkdtempSync(join(tmpdir(), 'zukai-install-'));
      run(target, dest);
      const skill = join(dest, subdir, 'zukai');
      const revise = join(dest, subdir, 'zukai-revise');
      expect(readdirSync(join(dest, subdir)).sort()).toEqual(['zukai', 'zukai-revise']);
      expect(frontmatterName(join(skill, 'SKILL.md'))).toBe('zukai');
      expect(frontmatterName(join(revise, 'SKILL.md'))).toBe('zukai-revise');
      expect(existsSync(join(skill, 'scripts', 'bin', 'cli.mjs'))).toBe(true);
      expect(existsSync(join(skill, '.zukai-version'))).toBe(true);
      expect(existsSync(join(revise, '.zukai-revise-version'))).toBe(true);
      expect(existsSync(join(revise, 'references', 'consult-protocol.md'))).toBe(true);
      // revise reaches the draw skill's CLI through its sibling folder, as its SKILL.md says.
      expect(existsSync(join(revise, '..', 'zukai', 'scripts', 'bin', 'cli.mjs'))).toBe(true);
      expect(readFileSync(join(revise, 'SKILL.md'), 'utf8')).toContain('<revise-dir>/../zukai');
    });
  }

  it('reports an existing install of the same version and leaves it alone', () => {
    const dest = mkdtempSync(join(tmpdir(), 'zukai-install-'));
    run('codex', dest);
    expect(run('codex', dest)).toMatch(/already up to date/);
    expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(['zukai', 'zukai-revise']);
  });

  it('adds zukai-revise next to an older zukai install and backs the old one up', () => {
    const dest = mkdtempSync(join(tmpdir(), 'zukai-install-'));
    const old = join(dest, '.agents/skills/zukai');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, '.zukai-version'), '1.0.0\n');
    writeFileSync(join(old, 'SKILL.md'), '---\nname: zukai\n---\n');
    expect(run('codex', dest)).toMatch(/Upgrading zukai -> /);
    const names = readdirSync(join(dest, '.agents/skills')).sort();
    expect(names).toHaveLength(3);
    expect(names[0]).toBe('zukai');
    expect(names[1]).toBe('zukai-revise');
    expect(names[2]).toMatch(/^zukai\.bak-\d{14}$/);
  });

  it('touches nothing when one installed copy is newer than the source', () => {
    const dest = mkdtempSync(join(tmpdir(), 'zukai-install-'));
    const newer = join(dest, '.agents/skills/zukai-revise');
    mkdirSync(newer, { recursive: true });
    writeFileSync(join(newer, '.zukai-revise-version'), '99.0.0\n');
    expect(() => run('codex', dest)).toThrow();
    expect(readdirSync(join(dest, '.agents/skills'))).toEqual(['zukai-revise']);
  });

  it('moves aside a copy this installer wrote under the old name', () => {
    const dest = mkdtempSync(join(tmpdir(), 'zukai-install-'));
    const legacy = join(dest, '.agents/skills/it-diagrams');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, '.it-diagrams-version'), '1.0.0\n');
    writeFileSync(join(legacy, 'SKILL.md'), '---\nname: it-diagrams\n---\n');
    run('codex', dest);
    const names = readdirSync(join(dest, '.agents/skills')).sort();
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/^it-diagrams\.bak-\d{14}$/);
    expect(names.slice(1)).toEqual(['zukai', 'zukai-revise']);
  });

  it('leaves a folder with the old name alone when it carries no version marker', () => {
    const dest = mkdtempSync(join(tmpdir(), 'zukai-install-'));
    const other = join(dest, '.agents/skills/it-diagrams');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'SKILL.md'), '---\nname: it-diagrams\n---\n');
    run('codex', dest);
    expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(['it-diagrams', 'zukai', 'zukai-revise']);
  });
});
