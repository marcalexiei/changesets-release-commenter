import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collect } from './collect.js';

/**
 * A repository shaped like one that ships a built artifact: the version commit consumes the
 * changesets, a later commit adds the build, and the tag names that later commit.
 */

let cwd: string;

const run = (...args: Array<string>): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });

const write = (file: string, contents: string): void => {
  const target = path.join(cwd, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

const commit = (message: string): void => {
  run('add', '--all');
  run('commit', '--quiet', '--message', message);
};

/** Every commit maps to the same PR, which is all these tests need to tell resolution apart. */
const commitToPullRequest = (): Promise<number | null> => Promise.resolve(42);

/** The `name@version` list each PR shipped in, as a plain object the assertions can read. */
const shipped = async (): Promise<Record<string, Array<string>>> => {
  const released = await collect({
    cwd,
    published: [{ name: 'fixture', version: '1.0.1' }],
    resolveVia: 'changesets',
    includeDependents: false,
    commitToPullRequest,
  });
  return Object.fromEntries([...released].map(([pr, entry]) => [pr, [...entry.direct].toSorted()]));
};

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'commenter-'));
  run('init', '--quiet', '--initial-branch=main');
  write('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  write('.changeset/README.md', 'Changesets folder');
  commit('chore: initial');

  write('.changeset/tidy-pandas-clap.md', "---\n'fixture': patch\n---\n\nSomething happened\n");
  commit('fix: something');

  rmSync(path.join(cwd, '.changeset/tidy-pandas-clap.md'));
  write('package.json', JSON.stringify({ name: 'fixture', version: '1.0.1' }));
  write('CHANGELOG.md', '# fixture\n\n## 1.0.1\n');
  commit('chore: release');
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('a tag that names the version commit', () => {
  it('resolves the changesets that commit consumed', async () => {
    run('tag', 'v1.0.1');

    expect(await shipped()).toEqual({ 42: ['fixture@1.0.1'] });
  });
});

describe('a tag that names a commit built on top of the version commit', () => {
  it('walks back to the version commit', async () => {
    write('dist/index.js', 'console.log("built");\n');
    commit('v1.0.1');
    run('tag', 'v1.0.1');

    expect(await shipped()).toEqual({ 42: ['fixture@1.0.1'] });
  });

  it('gives up rather than reaching an unrelated earlier release', async () => {
    for (let index = 0; index < 8; index += 1) {
      write(`filler-${String(index)}.txt`, 'filler\n');
      commit(`chore: filler ${String(index)}`);
    }
    run('tag', 'v1.0.1');

    expect(await shipped()).toEqual({});
  });
});
