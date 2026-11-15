import { beforeEach, describe, expect, it } from 'vitest';

import { collect, resolveTags } from '../src/collect.js';

import type { Repo } from './fixtures/git.js';
import { checkout, shallowClone, singlePackageBase } from './fixtures/repos.js';

/**
 * A repository shaped like one that ships a built artifact: the version commit consumes the
 * changesets, a later commit adds the build, and the tag names that later commit.
 */

let repo: Repo;

/** Every commit maps to the same PR, which is all these tests need to tell resolution apart. */
const commitToPullRequest = async (): Promise<number | null> => Promise.resolve(42);

/** The `name@version` list each PR shipped in, as a plain object the assertions can read. */
const shipped = async (version = '1.0.1'): Promise<Record<string, Array<string>>> => {
  const published = [{ name: 'fixture', version }];
  const released = await collect({
    cwd: repo.cwd,
    published,
    tags: await resolveTags(repo.cwd, published),
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

describe('a shallow clone', () => {
  it('deepens before deciding the release commit has no parent', async () => {
    repo.tag('v1.0.1');
    repo = shallowClone(repo, 1);

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

  it('walks back past several commits to the version commit', async () => {
    for (let index = 0; index < 8; index += 1) {
      repo.write(`filler-${String(index)}.txt`, 'filler\n');
      repo.commit(`chore: filler ${String(index)}`);
    }
    repo.tag('v1.0.1');

    expect(await shipped()).toEqual({ 42: ['fixture@1.0.1'] });
  });

  it('stops at a version commit that bumped nothing to the published version', async () => {
    repo.write('filler.txt', 'filler\n');
    repo.commit('chore: filler');
    repo.tag('v1.0.2');

    expect(await shipped('1.0.2')).toEqual({});
  });
});

describe('a version that was never tagged', () => {
  it('names the newest tags of the same package', async () => {
    repo.tag('v1.0.1');
    repo.tag('unrelated');
    const published = [{ name: 'fixture', version: '9.9.9' }];

    await expect(
      collect({
        cwd: repo.cwd,
        published,
        tags: await resolveTags(repo.cwd, published),
        resolveVia: 'changesets',
        includeDependents: false,
        commitToPullRequest,
      }),
    ).rejects.toThrow('Tried: fixture@9.9.9, v9.9.9. Newest tags for these packages: v1.0.1');
  });
});
