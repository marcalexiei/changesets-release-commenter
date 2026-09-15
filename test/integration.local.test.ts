import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Local-only: drives collect() against the playground checkout when it is present.
import { describe, expect, it } from 'vitest';

import { collect } from '../src/collect.js';

const cwd = `${process.env.HOME}/development/changesets-release-commenter-playground`;
const published = [
  { name: 'fixture-utils', version: '1.1.0' },
  { name: 'fixture-plugin-a', version: '1.0.1' },
  { name: 'fixture-plugin-b', version: '1.0.1' },
];
const expected = {
  4: ['fixture-plugin-a@1.0.1'],
  5: ['fixture-utils@1.1.0'],
  6: ['fixture-plugin-a@1.0.1', 'fixture-plugin-b@1.0.1'],
  7: ['fixture-plugin-b@1.0.1'],
};
const commitToPullRequest = (sha: string): Promise<number | null> => {
  const out = execSync(
    `gh api repos/marcalexiei/changesets-release-commenter-playground/commits/${sha}/pulls --jq '.[0].number'`,
    { encoding: 'utf8' },
  ).trim();
  return Promise.resolve(out ? Number(out) : null);
};

describe.runIf(existsSync(cwd))('collect against the playground', () => {
  for (const resolveVia of ['changesets', 'changelog'] as const) {
    it(`resolves the same map via ${resolveVia}`, async () => {
      const released = await collect({
        cwd,
        published,
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
});
