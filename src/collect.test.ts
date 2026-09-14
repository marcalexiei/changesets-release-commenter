import { describe, expect, it } from 'vitest';

import { parseChangelogDiff } from './collect.js';

describe('parseChangelogDiff', () => {
  it('attributes each PR link to the changelog it landed in', () => {
    const diff = [
      '--- a/packages/utils/CHANGELOG.md',
      '+++ b/packages/utils/CHANGELOG.md',
      '+- [#421](https://github.com/o/r/pull/421) [`940c4fd`](https://github.com/o/r/commit/940c4fd) - refactor',
      '--- a/plugins/zod/CHANGELOG.md',
      '+++ b/plugins/zod/CHANGELOG.md',
      '+- [#427](https://github.com/o/r/pull/427) - fix',
    ].join('\n');
    expect(parseChangelogDiff(diff)).toEqual([
      { path: 'packages/utils/CHANGELOG.md', pr: 421 },
      { path: 'plugins/zod/CHANGELOG.md', pr: 427 },
    ]);
  });

  it('ignores dependency bumps, which carry commit links but no PR link', () => {
    const diff = [
      '+++ b/plugins/zod/CHANGELOG.md',
      '+- Updated dependencies [[`d6ddf69`](https://github.com/o/r/commit/d6ddf69)]:',
      '+  - fixture-utils@1.1.0',
    ].join('\n');
    expect(parseChangelogDiff(diff)).toEqual([]);
  });

  it('ignores removed lines', () => {
    const diff = ['+++ b/CHANGELOG.md', '-- [#1](https://github.com/o/r/pull/1) - gone'].join('\n');
    expect(parseChangelogDiff(diff)).toEqual([]);
  });

  it('handles a root-level changelog', () => {
    const diff = ['+++ b/CHANGELOG.md', '+- [#12](https://github.com/o/r/pull/12) - feat'].join(
      '\n',
    );
    expect(parseChangelogDiff(diff)).toEqual([{ path: 'CHANGELOG.md', pr: 12 }]);
  });
});
