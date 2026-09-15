import { beforeEach, describe, expect, it } from 'vitest';

import { collect } from '../src/collect.js';

import type { Repo } from './fixtures/git.js';
import { checkout, singlePackageBase } from './fixtures/repos.js';

/**
 * A repository shaped like one that ships a built artifact: the version commit consumes the
 * changesets, a later commit adds the build, and the tag names that later commit.
 */

let repo: Repo;

/** Every commit maps to the same PR, which is all these tests need to tell resolution apart. */
const commitToPullRequest = (): Promise<number | null> => Promise.resolve(42);

/** The `name@version` list each PR shipped in, as a plain object the assertions can read. */
const shipped = async (): Promise<Record<string, Array<string>>> => {
  const released = await collect({
    cwd: repo.cwd,
    published: [{ name: 'fixture', version: '1.0.1' }],
    resolveVia: 'changesets',
    includeDependents: false,
    commitToPullRequest,
  });
  return Object.fromEntries([...released].map(([pr, entry]) => [pr, [...entry.direct].toSorted()]));
};

beforeEach(() => {
  repo = checkout(singlePackageBase());
});

describe('a tag that names the version commit', () => {
  it('resolves the changesets that commit consumed', async () => {
    repo.tag('v1.0.1');

    expect(await shipped()).toEqual({ 42: ['fixture@1.0.1'] });
  });
});

describe('a tag that names a commit built on top of the version commit', () => {
  it('walks back to the version commit', async () => {
    repo.write('dist/index.js', 'console.log("built");\n');
    repo.commit('v1.0.1');
    repo.tag('v1.0.1');

    expect(await shipped()).toEqual({ 42: ['fixture@1.0.1'] });
  });

  it('gives up rather than reaching an unrelated earlier release', async () => {
    for (let index = 0; index < 8; index += 1) {
      repo.write(`filler-${String(index)}.txt`, 'filler\n');
      repo.commit(`chore: filler ${String(index)}`);
    }
    repo.tag('v1.0.1');

    expect(await shipped()).toEqual({});
  });
});
