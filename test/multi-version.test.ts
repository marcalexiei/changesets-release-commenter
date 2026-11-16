import { rmSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { collect, resolveTags } from '../src/collect.js';
import type { PublishedPackage, ResolveVia } from '../src/types.js';

import { pullRequestFromSubject } from './fixtures/git.js';
import type { Repo } from './fixtures/git.js';
import { checkout, workspaceBase } from './fixtures/repos.js';

/**
 * The workspace's version commit is left unpublished because another changeset landed first, as
 * changesets/action does while one is pending. The next version commit's publish ships both.
 */

const SERVER = 'https://github.com/o/r';

let repo: Repo;

const shipped = async (
  published: ReadonlyArray<PublishedPackage>,
  resolveVia: ResolveVia,
): Promise<Record<string, { direct: Array<string>; dependents: Array<string> }>> => {
  const released = await collect({
    cwd: repo.cwd,
    published,
    tags: await resolveTags(repo.cwd, published),
    resolveVia,
    includeDependents: true,
    commitToPullRequest: pullRequestFromSubject(repo),
  });
  return Object.fromEntries(
    [...released].map(([pr, entry]) => [
      pr,
      { direct: [...entry.direct].toSorted(), dependents: [...entry.dependents].toSorted() },
    ]),
  );
};

beforeEach(() => {
  repo = checkout(workspaceBase());
  repo.git('tag', '-d', 'fixture-utils@1.1.0', 'fixture-plugin-a@1.0.1');

  repo.write('.changeset/quiet-foxes-hum.md', "---\n'fixture-plugin-a': patch\n---\n\nTidy up\n");
  repo.commit('fix(plugin-a): tidy up (#7)');

  rmSync(path.join(repo.cwd, '.changeset/quiet-foxes-hum.md'));
  repo.write(
    'packages/plugin-a/package.json',
    JSON.stringify({
      name: 'fixture-plugin-a',
      version: '1.0.2',
      dependencies: { 'fixture-utils': '1.1.0' },
    }),
  );
  repo.write(
    'packages/plugin-a/CHANGELOG.md',
    `# fixture-plugin-a\n\n## 1.0.2\n\n### Patch Changes\n\n- [#7](${SERVER}/pull/7) - Tidy up\n`,
  );
  repo.commit('chore: release');
  repo.tag('fixture-utils@1.1.0');
  repo.tag('fixture-plugin-a@1.0.2');
});

describe('a publish that ships two version commits', () => {
  const published = [
    { name: 'fixture-utils', version: '1.1.0' },
    { name: 'fixture-plugin-a', version: '1.0.2' },
  ];
  const expected = {
    5: { direct: ['fixture-utils@1.1.0'], dependents: ['fixture-plugin-a@1.0.2'] },
    6: { direct: ['fixture-plugin-a@1.0.2'], dependents: [] },
    7: { direct: ['fixture-plugin-a@1.0.2'], dependents: [] },
  };

  it('attributes the earlier one too, via changesets', async () => {
    expect(await shipped(published, 'changesets')).toEqual(expected);
  });

  it('attributes the earlier one too, via the changelog', async () => {
    expect(await shipped(published, 'changelog')).toEqual(expected);
  });

  it('stops at a version commit that bumped nothing to a published version', async () => {
    expect(await shipped([{ name: 'fixture-plugin-a', version: '1.0.2' }], 'changesets')).toEqual({
      7: { direct: ['fixture-plugin-a@1.0.2'], dependents: [] },
    });
  });
});
