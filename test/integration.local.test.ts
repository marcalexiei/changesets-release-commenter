import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Local-only: drives collect() against the playground checkout when it is present.
import { describe, expect, it } from 'vitest';

import { collect, resolveTags } from '../src/collect.js';

const REPO = 'marcalexiei/changesets-release-commenter-playground';
const cwd = `${process.env.HOME}/development/changesets-release-commenter-playground`;

// The playground is private, so a checkout alone is not enough: `gh` must be able to read it.
const reachable =
  existsSync(cwd) && spawnSync('gh', ['api', `repos/${REPO}`, '--silent']).status === 0;

const releases = [
  {
    name: 'one version commit',
    published: [
      { name: 'fixture-utils', version: '1.1.0' },
      { name: 'fixture-plugin-a', version: '1.0.1' },
      { name: 'fixture-plugin-b', version: '1.0.1' },
    ],
    expected: {
      4: ['fixture-plugin-a@1.0.1'],
      5: ['fixture-utils@1.1.0'],
      6: ['fixture-plugin-a@1.0.1', 'fixture-plugin-b@1.0.1'],
      7: ['fixture-plugin-b@1.0.1'],
    },
  },
  {
    name: 'two version commits in one publish',
    published: [
      { name: 'fixture-plugin-a', version: '1.1.1' },
      { name: 'fixture-plugin-b', version: '1.1.5' },
      { name: 'fixture-utils', version: '1.1.5' },
    ],
    expected: {
      36: ['fixture-utils@1.1.5'],
      37: ['fixture-plugin-b@1.1.5'],
    },
  },
];

/** The same lookup the action makes: the merged PR, not an open one sharing the commit. */
const commitToPullRequest = async (sha: string): Promise<number | null> => {
  const out = execFileSync(
    'gh',
    [
      'api',
      `repos/${REPO}/commits/${sha}/pulls`,
      '--jq',
      'map(select(.merged_at != null))[0].number // empty',
    ],
    { encoding: 'utf8' },
  ).trim();
  return Promise.resolve(out ? Number(out) : null);
};

describe.runIf(reachable)('collect against the playground', () => {
  for (const { name, published, expected } of releases) {
    for (const resolveVia of ['changesets', 'changelog'] as const) {
      it(`resolves ${name} via ${resolveVia}`, async () => {
        const released = await collect({
          cwd,
          published,
          tags: await resolveTags(cwd, published),
          resolveVia,
          includeDependents: false,
          commitToPullRequest,
        });
        const obj = Object.fromEntries(
          [...released].map(([pr, entry]) => [pr, [...entry.direct].toSorted()]),
        );
        expect(obj).toEqual(expected);
      }, 60_000);
    }
  }
});
