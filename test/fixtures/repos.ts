import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { initRepo, openRepo } from './git.js';
import type { Repo } from './git.js';

/** One temp root for every fixture in the run, removed when the process ends. */
const root = mkdtempSync(path.join(tmpdir(), 'commenter-fixtures-'));
process.on('exit', () => {
  rmSync(root, { recursive: true, force: true });
});

const SERVER = 'https://github.com/o/r';

/**
 * Each shape is built once and then copied per test: the history is identical every time, and
 * only the copy is cheap enough to do in a `beforeEach`.
 */
const bases = new Map<string, string>();

function base(name: string, populate: (repo: Repo) => void): string {
  const existing = bases.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const cwd = path.join(root, `base-${name}`);
  populate(initRepo(cwd));
  bases.set(name, cwd);
  return cwd;
}

let copies = 0;

/** A working copy of a base, free to commit and tag without disturbing the original. */
function checkout(baseCwd: string): Repo {
  copies += 1;
  const cwd = path.join(root, `copy-${String(copies)}`);
  cpSync(baseCwd, cwd, { recursive: true });
  return openRepo(cwd);
}

/**
 * A single-package repository stopped just after the version commit, with no tag: the tests that
 * use it place the tag themselves, which is the thing they are about.
 */
function singlePackageBase(): string {
  return base('single-package', (repo) => {
    repo.write('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }));
    repo.write('.changeset/README.md', 'Changesets folder');
    repo.commit('chore: initial');

    repo.write(
      '.changeset/tidy-pandas-clap.md',
      "---\n'fixture': patch\n---\n\nSomething happened\n",
    );
    repo.commit('fix: something');

    rmSync(path.join(repo.cwd, '.changeset/tidy-pandas-clap.md'));
    repo.write('package.json', JSON.stringify({ name: 'fixture', version: '1.0.1' }));
    repo.write('CHANGELOG.md', '# fixture\n\n## 1.0.1\n');
    repo.commit('chore: release');
  });
}

/**
 * A workspace where one changeset lands on a shared package and a second on a consumer, so a
 * release carries both a direct change and a transitive bump — tagged, ready to collect.
 */
function workspaceBase(): string {
  return base('workspace', (repo) => {
    repo.write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    repo.write('package.json', JSON.stringify({ name: 'root', private: true }));
    repo.write(
      'packages/utils/package.json',
      JSON.stringify({ name: 'fixture-utils', version: '1.0.0' }),
    );
    repo.write(
      'packages/plugin-a/package.json',
      JSON.stringify({
        name: 'fixture-plugin-a',
        version: '1.0.0',
        dependencies: { 'fixture-utils': '1.0.0' },
      }),
    );
    repo.write('.changeset/README.md', 'Changesets folder');
    repo.commit('chore: initial');

    repo.write(
      '.changeset/brave-otters-sing.md',
      "---\n'fixture-utils': minor\n---\n\nAdd a helper\n",
    );
    const utilsSha = repo.commit('feat(utils): add a helper (#5)');

    repo.write(
      '.changeset/lazy-moths-run.md',
      "---\n'fixture-plugin-a': patch\n---\n\nCorrect a path\n",
    );
    repo.commit('fix(plugin-a): correct a path (#6)');

    rmSync(path.join(repo.cwd, '.changeset/brave-otters-sing.md'));
    rmSync(path.join(repo.cwd, '.changeset/lazy-moths-run.md'));
    repo.write(
      'packages/utils/package.json',
      JSON.stringify({ name: 'fixture-utils', version: '1.1.0' }),
    );
    repo.write(
      'packages/plugin-a/package.json',
      JSON.stringify({
        name: 'fixture-plugin-a',
        version: '1.0.1',
        dependencies: { 'fixture-utils': '1.1.0' },
      }),
    );
    repo.write(
      'packages/utils/CHANGELOG.md',
      `# fixture-utils\n\n## 1.1.0\n\n### Minor Changes\n\n- [#5](${SERVER}/pull/5) - Add a helper\n`,
    );
    // The dependency-bump line carries a commit link and no PR link, exactly as changesets writes it.
    repo.write(
      'packages/plugin-a/CHANGELOG.md',
      `# fixture-plugin-a\n\n## 1.0.1\n\n### Patch Changes\n\n- [#6](${SERVER}/pull/6) - Correct a path\n` +
        `- Updated dependencies [[\`${utilsSha}\`](${SERVER}/commit/${utilsSha})]:\n  - fixture-utils@1.1.0\n`,
    );
    repo.commit('chore: release');
    repo.tag('fixture-utils@1.1.0');
    repo.tag('fixture-plugin-a@1.0.1');
  });
}

export { checkout, singlePackageBase, workspaceBase };
