import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const installer = join(repoRoot, 'install.ps1');
const shInstaller = join(repoRoot, 'install.sh');
const version = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const NAMES = ['zukai', 'zukai-labs', 'zukai-recook', 'zukai-report', 'zukai-revise', 'zukai-sync'];

/**
 * PowerShell 7 to run the installer with: the executable `ZUKAI_PWSH` names, else `pwsh` on
 * PATH. Without one the tests are skipped; one that is named and does not start is an error.
 */
function findPwsh() {
  const starts = (bin) => {
    const r = spawnSync(bin, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { timeout: 60_000 });
    return !r.error && r.status === 0;
  };
  const named = process.env.ZUKAI_PWSH;
  if (named) {
    if (!starts(named)) throw new Error(`ZUKAI_PWSH names ${named}, which does not start`);
    return named;
  }
  return starts('pwsh') ? 'pwsh' : null;
}
// The installer ships with the repository, not with a copied skill.
const pwsh = existsSync(installer) ? findPwsh() : null;
const posix = process.platform !== 'win32';

const made = [];
const tempDir = (prefix = 'zukai-install-ps1-') => {
  // The real path: install.sh reports the folder as `pwd -P` names it.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** Run install.ps1 (of this repository, or of a copy of it) and return status, stdout and stderr. */
function ps(args, { script = installer, cwd } = {}) {
  const r = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, ...args], { encoding: 'utf8', cwd, timeout: 120_000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function sh(args) {
  const r = spawnSync('sh', [shInstaller, ...args], { encoding: 'utf8', timeout: 120_000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const install = (target, dest) => {
  const r = ps(['-Target', target, '-Dest', dest]);
  expect(r, r.stderr).toMatchObject({ status: 0 });
  return r;
};

const frontmatterName = (file) => readFileSync(file, 'utf8').match(/^name: (.+)$/m)?.[1];
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const STAMP = /\d{14}/g;

/** Every folder and file under `root`: its path with forward slashes, and a hash of a file's bytes. */
function tree(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      const name = `${rel}${entry.name}`.replace(STAMP, 'STAMP');
      if (entry.isDirectory()) { out[`${name}/`] = 'folder'; walk(path, `${name}/`); }
      else out[name] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  walk(root, '');
  return out;
}

/** What a project holds before the installer runs: one case per decision the installer takes. */
const projects = {
  'an empty project': () => {},
  'an install of an older version': (dest) => {
    put(join(dest, '.agents/skills/zukai/.zukai-version'), '1.0.0\n');
    put(join(dest, '.agents/skills/zukai/SKILL.md'), '---\nname: zukai\n---\n');
  },
  'an older install of all six, with a marker that ends in CRLF': (dest) => {
    for (const name of NAMES) {
      put(join(dest, `.agents/skills/${name}/.${name}-version`), '2.2.2\r\n');
      put(join(dest, `.agents/skills/${name}/SKILL.md`), `---\nname: ${name}\n---\n`);
    }
  },
  'a folder named zukai without a version marker': (dest) => {
    put(join(dest, '.agents/skills/zukai/SKILL.md'), '---\nname: zukai\n---\nmine\n');
  },
  'an install under the old name': (dest) => {
    put(join(dest, '.agents/skills/it-diagrams/.it-diagrams-version'), '1.0.0\n');
    put(join(dest, '.agents/skills/it-diagrams/SKILL.md'), '---\nname: it-diagrams\n---\n');
  },
  'a folder with the old name and no version marker': (dest) => {
    put(join(dest, '.agents/skills/it-diagrams/SKILL.md'), '---\nname: it-diagrams\n---\n');
  },
  'a backup left inside the skills folder': (dest) => {
    put(join(dest, '.agents/skills/zukai.bak-20260101000000/SKILL.md'), '---\nname: zukai\n---\n');
    put(join(dest, '.agents/skills/zukai/.zukai-version'), '1.0.0\n');
  },
  'a copy newer than the source': (dest) => {
    put(join(dest, '.agents/skills/zukai-revise/.zukai-revise-version'), '99.0.0\n');
  },
  'a prerelease version marker': (dest) => {
    put(join(dest, '.agents/skills/zukai/.zukai-version'), '2.0.0-rc1\n');
  },
  'an empty version marker': (dest) => {
    put(join(dest, '.agents/skills/zukai/.zukai-version'), '');
  },
  'a temporary folder of a run that was killed': (dest) => {
    put(join(dest, '.agents/skills/.zukai.tmp-123/zukai/SKILL.md'), 'half a copy\n');
  },
};

describe.skipIf(!pwsh)('install.ps1', () => {
  for (const [target, subdir] of [['codex', '.agents/skills'], ['claude-project', '.claude/skills']]) {
    it(`installs the ${target} copies as zukai, zukai-revise, zukai-recook, zukai-sync, zukai-labs and zukai-report, in folder and in name`, () => {
      const dest = tempDir();
      const r = install(target, dest);
      const skills = join(dest, subdir);
      expect(readdirSync(skills).sort()).toEqual(NAMES);
      for (const name of NAMES) {
        expect(frontmatterName(join(skills, name, 'SKILL.md'))).toBe(name);
        // The same bytes on every platform: one line, ended by a line feed alone.
        expect(readFileSync(join(skills, name, `.${name}-version`), 'utf8')).toBe(`${version}\n`);
        // No byte-order mark before the frontmatter, and the line ends the source has.
        expect(readFileSync(join(skills, name, 'SKILL.md')).subarray(0, 4).toString('latin1')).toBe('---\n');
      }
      expect(existsSync(join(skills, 'zukai-revise', 'references', 'consult-protocol.md'))).toBe(true);
      expect(readFileSync(join(skills, 'zukai-revise', 'SKILL.md'), 'utf8')).toContain('<revise-dir>/../zukai');
      expect(readFileSync(join(skills, 'zukai-recook', 'SKILL.md'), 'utf8')).toContain('<recook-dir>/../zukai');
      const syncText = readFileSync(join(skills, 'zukai-sync', 'SKILL.md'), 'utf8');
      expect(syncText).toContain('<sync-dir>/../zukai');
      expect(syncText).toContain('<sync-dir>/../zukai-revise');
      // labs is instructions only and reaches the CLI and the four skills it follows through its siblings.
      expect(readdirSync(join(skills, 'zukai-labs')).sort()).toEqual(['.zukai-labs-version', 'SKILL.md']);
      const labsText = readFileSync(join(skills, 'zukai-labs', 'SKILL.md'), 'utf8');
      for (const sibling of ['zukai', 'zukai-revise', 'zukai-sync', 'zukai-recook']) expect(labsText).toContain(`<labs-dir>/../${sibling}`);
      // The installed CLI answers, from another working directory.
      const help = execFileSync(process.execPath, [join(skills, 'zukai', 'scripts', 'bin', 'cli.mjs'), 'help'], { cwd: dest, encoding: 'utf8' });
      expect(help).toContain('cli.mjs stale <run-dir>...');
      expect(help).toContain('cli.mjs sources <run-dir>');
      // report carries the built-in templates, which the installed CLI finds through its version marker.
      expect(readdirSync(join(skills, 'zukai-report', 'templates')).sort()).toEqual(['feature', 'issue-investigation', 'tech-research']);
      expect(readFileSync(join(skills, 'zukai-report', 'SKILL.md'), 'utf8')).toContain('<report-dir>/../zukai');
      const list = JSON.parse(execFileSync(process.execPath, [join(skills, 'zukai', 'scripts', 'bin', 'cli.mjs'), 'template', 'list'], { cwd: dest, encoding: 'utf8' }));
      expect(list.templates.filter((t) => t.scope === 'built-in' && t.valid).map((t) => t.id)).toEqual(['feature', 'issue-investigation', 'tech-research']);
      // The warning about the fallback channel is no part of the list of what was done.
      expect(r.stdout).not.toMatch(/fallback channel/);
      if (target === 'claude-project') expect(r.stderr).toMatch(/fallback channel/);
      else expect(r.stderr).toBe('');
    });
  }

  it('copies what the skills run with and leaves the CLI sources, tests and fixtures behind', () => {
    const dest = tempDir();
    install('codex', dest);
    const scripts = join(dest, '.agents/skills/zukai/scripts');
    expect(readdirSync(scripts).sort()).toEqual(['bin', 'package.json', 'src']);
    expect(readdirSync(join(scripts, 'src'))).toEqual(['feature-matrix.json']);
    expect(readFileSync(join(scripts, 'bin', 'cli.mjs')).equals(readFileSync(join(repoRoot, 'skills/draw/scripts/bin/cli.mjs')))).toBe(true);
    const out = execFileSync(process.execPath, [join(scripts, 'bin', 'cli.mjs'), 'validate', join(repoRoot, 'skills/draw/scripts/fixtures/flowchart/valid.json')], { cwd: dest, encoding: 'utf8' });
    expect(JSON.parse(out)).toMatchObject({ ok: true, kind: 'flowchart' });
  });

  it('reports an existing install of the same version and leaves it alone', () => {
    const dest = tempDir();
    install('codex', dest);
    const before = tree(dest);
    expect(install('codex', dest).stdout).toMatch(/already up to date/);
    expect(tree(dest)).toEqual(before);
  });

  it('upgrades an older copy, adds the missing ones and moves the old copy out of the skills folder', () => {
    const dest = tempDir();
    projects['an install of an older version'](dest);
    const r = install('codex', dest);
    expect(r.stdout).toMatch(/Upgrading zukai -> /);
    expect(r.stdout).toMatch(/Previous install of zukai moved to /);
    // The backup leaves the skills folder: there it would still be a skill named zukai.
    expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(NAMES);
    const backups = readdirSync(join(dest, '.agents/zukai-backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^zukai-\d{14}$/);
    expect(readFileSync(join(dest, '.agents/zukai-backups', backups[0], '.zukai-version'), 'utf8')).toBe('1.0.0\n');
    expect(readFileSync(join(dest, '.agents/skills/zukai/.zukai-version'), 'utf8')).toBe(`${version}\n`);
  });

  it('backs up a folder that has the name of a skill and no version marker', () => {
    const dest = tempDir();
    projects['a folder named zukai without a version marker'](dest);
    expect(install('codex', dest).stdout).toMatch(/without a version marker/);
    const backups = readdirSync(join(dest, '.agents/zukai-backups'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dest, '.agents/zukai-backups', backups[0], 'SKILL.md'), 'utf8')).toBe('---\nname: zukai\n---\nmine\n');
    expect(frontmatterName(join(dest, '.agents/skills/zukai/SKILL.md'))).toBe('zukai');
    expect(existsSync(join(dest, '.agents/skills/zukai/scripts/bin/cli.mjs'))).toBe(true);
  });

  it('moves a backup that an earlier installer left inside the skills folder out of it', () => {
    const dest = tempDir();
    install('codex', dest);
    put(join(dest, '.agents/skills/zukai.bak-20260101000000/SKILL.md'), '---\nname: zukai\n---\n');
    expect(install('codex', dest).stdout).toMatch(/already up to date/);
    expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(NAMES);
    expect(readdirSync(join(dest, '.agents/zukai-backups'))).toEqual(['zukai-20260101000000']);
  });

  it('touches nothing and exits 3 when one installed copy is newer than the source', () => {
    const dest = tempDir();
    projects['a copy newer than the source'](dest);
    const before = tree(dest);
    const r = ps(['-Target', 'codex', '-Dest', dest]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/Installed zukai-revise at .* is newer than this source \(\d+\.\d+\.\d+\); not downgrading\.\n$/);
    expect(tree(dest)).toEqual(before);
  });

  for (const [name, marker] of [['a prerelease version marker', '2.0.0-rc1'], ['an empty version marker', '']]) {
    it(`refuses to compare ${name}, in one line and with exit code 1`, () => {
      const dest = tempDir();
      projects[name](dest);
      const before = tree(dest);
      const r = ps(['-Target', 'codex', '-Dest', dest]);
      expect(r.status).toBe(1);
      // The message and nothing else: no error record with the script's source around it.
      expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
      expect(r.stderr).toContain(`Installed version marker '${marker}' at `);
      expect(r.stderr).toContain('is not a release version; refusing to compare.');
      expect(tree(dest)).toEqual(before);
    });
  }

  it('moves aside a copy this installer wrote under the old name', () => {
    const dest = tempDir();
    projects['an install under the old name'](dest);
    install('codex', dest);
    expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(NAMES);
    const backups = readdirSync(join(dest, '.agents/zukai-backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^it-diagrams-\d{14}$/);
  });

  it('leaves a folder with the old name alone when it carries no version marker', () => {
    const dest = tempDir();
    projects['a folder with the old name and no version marker'](dest);
    install('codex', dest);
    expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(['it-diagrams', ...NAMES]);
    expect(existsSync(join(dest, '.agents/zukai-backups'))).toBe(false);
  });

  for (const added of ['zukai-sync', 'zukai-labs', 'zukai-report']) {
    it(`installs only the missing ${added} and leaves a same-version copy alone`, () => {
      const dest = tempDir();
      install('codex', dest);
      rmSync(join(dest, '.agents/skills', added), { recursive: true });
      const out = install('codex', dest).stdout;
      expect(out).toMatch(new RegExp(`Installing ${added} `));
      expect(out).not.toMatch(/Previous install of/);
      expect(out).not.toMatch(/Installed zukai \d/);
      expect(existsSync(join(dest, '.agents/skills', added, 'SKILL.md'))).toBe(true);
      expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(NAMES);
      expect(existsSync(join(dest, '.agents/zukai-backups'))).toBe(false);
    });
  }

  it('drops the temporary folder of a run that was killed and leaves none of its own', () => {
    const dest = tempDir();
    projects['a temporary folder of a run that was killed'](dest);
    install('codex', dest);
    expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(NAMES);
  });

  it('takes the working directory as the project when -Dest is left out, and a relative -Dest from it', () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, 'sub project'));
    expect(ps(['-Target', 'codex'], { cwd })).toMatchObject({ status: 0 });
    expect(readdirSync(join(cwd, '.agents/skills')).sort()).toEqual(NAMES);
    expect(ps(['-Target', 'codex', '-Dest', 'sub project'], { cwd })).toMatchObject({ status: 0 });
    expect(readdirSync(join(cwd, 'sub project', '.agents/skills')).sort()).toEqual(NAMES);
  });

  it('installs into a project whose path holds square brackets', () => {
    // PowerShell reads "[...]" in a path as a wildcard unless the path is passed as a literal one.
    const dest = join(tempDir(), '[client] app');
    mkdirSync(dest);
    const r = ps(['-Target', 'codex', '-Dest', dest]);
    expect(r, r.stderr).toMatchObject({ status: 0 });
    expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(NAMES);
    // And a second run finds the copies it wrote there.
    expect(install('codex', dest).stdout).toMatch(/already up to date/);
  });

  it.each([
    ['an unknown target', ['-Target', 'nope']],
    ['no target', []],
    ['a target in another case than the one documented', ['-Target', 'Codex']],
    ['an argument it does not know', ['-Target', 'codex', '-Bogus', 'x']],
  ])('prints its usage and exits 1 for %s', (_, args) => {
    const cwd = tempDir();
    const r = ps(args, { cwd });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Usage: install.ps1 -Target codex|claude-project [-Dest <project-dir>]');
    expect(r.stdout).toBe('');
    expect(readdirSync(cwd)).toEqual([]);
  });

  it('exits 1 for a destination that does not exist and creates nothing', () => {
    const parent = tempDir();
    const r = ps(['-Target', 'codex', '-Dest', join(parent, 'missing')]);
    expect(r.status).toBe(1);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('Destination project directory does not exist: ');
    expect(readdirSync(parent)).toEqual([]);
  });

  describe('run from a copy of the repository', () => {
    /** The installer with what it reads, in a folder whose name PowerShell could take for a pattern. */
    const checkout = () => {
      const root = join(tempDir('zukai-checkout-'), 'zukai [fork]');
      mkdirSync(root);
      cpSync(installer, join(root, 'install.ps1'));
      cpSync(join(repoRoot, '.claude-plugin'), join(root, '.claude-plugin'), { recursive: true });
      cpSync(join(repoRoot, 'skills'), join(root, 'skills'), { recursive: true, filter: (from) => !/[\\/](node_modules|tests|fixtures)$/.test(from) });
      return root;
    };

    it('finds its skills when the checkout path holds square brackets', () => {
      const root = checkout();
      const dest = tempDir();
      const r = ps(['-Target', 'codex', '-Dest', dest], { script: join(root, 'install.ps1') });
      expect(r, r.stderr).toMatchObject({ status: 0 });
      expect(readdirSync(join(dest, '.agents/skills')).sort()).toEqual(NAMES);
    });

    it.skipIf(!posix)('never reads the dependency folder of the CLI', () => {
      // A link to nowhere stands for what a dependency tree holds and a copy trips over
      // (links, paths too long for Windows): the folder is left out, not copied and removed.
      const root = checkout();
      const deps = join(root, 'skills', 'draw', 'scripts', 'node_modules');
      mkdirSync(join(deps, '.bin'), { recursive: true });
      symlinkSync(join(root, 'nowhere'), join(deps, '.bin', 'tool'));
      const dest = tempDir();
      const r = ps(['-Target', 'codex', '-Dest', dest], { script: join(root, 'install.ps1') });
      expect(r, r.stderr).toMatchObject({ status: 0 });
      expect(readdirSync(join(dest, '.agents/skills/zukai/scripts')).sort()).toEqual(['bin', 'package.json', 'src']);
    });

    it('installs nothing and leaves no temporary folder when a skill does not carry its name', () => {
      const root = checkout();
      const skill = join(root, 'skills', 'sync', 'SKILL.md');
      writeFileSync(skill, readFileSync(skill, 'utf8').replace(/^name: sync$/m, 'name: other'));
      const dest = tempDir();
      const r = ps(['-Target', 'codex', '-Dest', dest], { script: join(root, 'install.ps1') });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/does not declare 'name: sync'; refusing to install a copy with the wrong name\.\n$/);
      expect(readdirSync(join(dest, '.agents/skills'))).toEqual([]);
    });
  });

  // The two installers are one installer in two languages: for the same project they must
  // leave the same folders and the same bytes, say the same and end with the same code.
  describe.skipIf(!posix || !existsSync(shInstaller))('against install.sh', () => {
    const cases = Object.keys(projects).map((name) => [name, 'codex']);
    cases.push(['an empty project', 'claude-project']);
    it.each(cases)('leaves the same tree for %s (%s)', (name, target) => {
      const byPs = tempDir();
      const bySh = tempDir();
      // The claude-project copies live under .claude; the cases are written for .agents.
      const prepare = (dest) => { projects[name](dest); if (target === 'claude-project' && existsSync(join(dest, '.agents'))) throw new Error('case not written for this target'); };
      prepare(byPs);
      prepare(bySh);
      const a = ps(['-Target', target, '-Dest', byPs]);
      const b = sh(['--target', target, '--dest', bySh]);
      const said = (r, dest) => ({ status: r.status, stdout: r.stdout.replaceAll(dest, '<project>').replace(STAMP, 'STAMP'), stderr: r.stderr.replaceAll(dest, '<project>') });
      expect(said(a, byPs)).toEqual(said(b, bySh));
      expect(tree(byPs)).toEqual(tree(bySh));
      // Something was compared: the project is not empty unless the installer refused to run.
      if (a.status === 0) expect(Object.keys(tree(byPs)).filter((p) => p.endsWith('/scripts/bin/cli.mjs'))).toHaveLength(1);
    });

    it('leaves the same tree for a second run over its own install', () => {
      const byPs = tempDir();
      const bySh = tempDir();
      install('codex', byPs);
      sh(['--target', 'codex', '--dest', bySh]);
      // Each installer over the other's copies: neither finds anything to do.
      expect(ps(['-Target', 'codex', '-Dest', bySh]).stdout).toMatch(/already up to date/);
      expect(sh(['--target', 'codex', '--dest', byPs]).stdout).toMatch(/already up to date/);
      expect(tree(byPs)).toEqual(tree(bySh));
    });
  });
});
