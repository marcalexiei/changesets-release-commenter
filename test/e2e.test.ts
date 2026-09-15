import { beforeAll, describe, expect, it } from 'vitest';

import { collect, resolveTags } from '../src/collect.js';
import { comment } from '../src/comment.js';
import type { CommentApi } from '../src/comment.js';
import type { Released } from '../src/types.js';

import { pullRequestFromSubject } from './fixtures/git.js';
import type { Repo } from './fixtures/git.js';
import { checkout, workspaceBase } from './fixtures/repos.js';

const PUBLISHED = [
  { name: 'fixture-utils', version: '1.1.0' },
  { name: 'fixture-plugin-a', version: '1.0.1' },
];

/** PR 5 closes issue 99; PR 6 closes nothing. */
const CLOSING = new Map([
  [5, [99]],
  [6, []],
]);

/** The direct packages each PR shipped in, as a plain object the assertions can read. */
function directsOf(map: Released): Record<string, Array<string>> {
  return Object.fromEntries([...map].map(([pr, entry]) => [pr, [...entry.direct].toSorted()]));
}

/** Records what was posted, and replays it so a second run sees its own comments. */
function recordingApi(): CommentApi & { posted: Map<number, Array<string>> } {
  const posted = new Map<number, Array<string>>();
  return {
    posted,
    listCommentBodies: (issue) => Promise.resolve(posted.get(issue) ?? []),
    createComment: (issue, body) => {
      posted.set(issue, [...(posted.get(issue) ?? []), body]);
      return Promise.resolve();
    },
    closingIssues: (pr) => Promise.resolve(CLOSING.get(pr) ?? []),
  };
}

describe('a release, from the repository to the comments it posts', () => {
  let repo: Repo;
  let released: Released;
  let api: ReturnType<typeof recordingApi>;

  beforeAll(async () => {
    repo = checkout(workspaceBase());
    released = await collect({
      cwd: repo.cwd,
      published: PUBLISHED,
      resolveVia: 'changesets',
      includeDependents: true,
      commitToPullRequest: pullRequestFromSubject(repo),
    });
    api = recordingApi();
    await comment({
      released,
      api,
      commentOn: 'both',
      markerId: 'changesets-release-commenter',
      dryRun: false,
      linkReleases: true,
      footer: true,
      serverUrl: 'https://github.com',
      repo: 'o/r',
      tags: await resolveTags(repo.cwd, PUBLISHED),
    });
  });

  it('attributes the shared package to its own PR and the consumer to both', () => {
    expect(
      Object.fromEntries(
        [...released].map(([pr, entry]) => [
          pr,
          { direct: [...entry.direct].toSorted(), dependents: [...entry.dependents].toSorted() },
        ]),
      ),
    ).toEqual({
      5: { direct: ['fixture-utils@1.1.0'], dependents: ['fixture-plugin-a@1.0.1'] },
      6: { direct: ['fixture-plugin-a@1.0.1'], dependents: [] },
    });
  });

  it('writes the PR comment that carries a transitive bump', () => {
    expect(api.posted.get(5)).toEqual([
      '🚀 This pull request has been released in:\n\n' +
        '- [`fixture-utils@1.1.0`](https://github.com/o/r/releases/tag/fixture-utils%401.1.0)\n\n' +
        'Also republished with this change:\n\n' +
        '- [`fixture-plugin-a@1.0.1`](https://github.com/o/r/releases/tag/fixture-plugin-a%401.0.1)\n\n' +
        '<sub>🤖 Posted by [changesets-release-commenter](https://github.com/marcalexiei/changesets-release-commenter)</sub>\n\n' +
        '<!-- changesets-release-commenter:fixture-plugin-a@1.0.1,fixture-utils@1.1.0 -->',
    ]);
  });

  it('names the PR that fixed the issue it closes', () => {
    expect(api.posted.get(99)?.[0]).toContain('🚀 Fixed by #5, released in:');
    expect(api.posted.get(99)?.[0]).toContain('- [`fixture-utils@1.1.0`]');
  });

  it('leaves an issue nobody closed alone', () => {
    expect(api.posted.has(6)).toBe(true);
    expect([...api.posted.keys()].toSorted((one, two) => one - two)).toEqual([5, 6, 99]);
  });

  it('resolves the same packages through either route', async () => {
    const viaChangelog = await collect({
      cwd: repo.cwd,
      published: PUBLISHED,
      resolveVia: 'changelog',
      includeDependents: true,
      commitToPullRequest: pullRequestFromSubject(repo),
    });
    expect(directsOf(viaChangelog)).toEqual(directsOf(released));
  });

  it('posts nothing the second time, because the marker is already on the thread', async () => {
    const before = new Map([...api.posted].map(([key, value]) => [key, value.length]));
    await comment({
      released,
      api,
      commentOn: 'both',
      markerId: 'changesets-release-commenter',
      dryRun: false,
      linkReleases: true,
      footer: true,
      serverUrl: 'https://github.com',
      repo: 'o/r',
      tags: await resolveTags(repo.cwd, PUBLISHED),
    });
    expect(new Map([...api.posted].map(([key, value]) => [key, value.length]))).toEqual(before);
  });
});
