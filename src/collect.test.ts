import { describe, expect, it } from 'vitest';

import { parseChangelogDiff, parseDependencyBumps } from './collect.js';

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

describe('parseDependencyBumps', () => {
  it('maps a dependency bump to the commit that caused it', () => {
    const diff = [
      '+++ b/plugins/fixture-plugin-a/CHANGELOG.md',
      '+- Updated dependencies [[`d6ddf69`](https://github.com/o/r/commit/d6ddf69)]:',
      '+  - fixture-utils@1.1.0',
    ].join('\n');
    expect(parseDependencyBumps(diff)).toEqual([
      { path: 'plugins/fixture-plugin-a/CHANGELOG.md', sha: 'd6ddf69' },
    ]);
  });

  it('handles several causing commits on one line', () => {
    const diff = [
      '+++ b/p/CHANGELOG.md',
      '+- Updated dependencies [[`aaaaaaa`](https://github.com/o/r/commit/aaaaaaa), [`bbbbbbb`](https://github.com/o/r/commit/bbbbbbb)]:',
    ].join('\n');
    expect(parseDependencyBumps(diff).map((bump) => bump.sha)).toEqual(['aaaaaaa', 'bbbbbbb']);
  });

  it('ignores direct entries, which are not dependency bumps', () => {
    const diff = [
      '+++ b/p/CHANGELOG.md',
      '+- [#5](https://github.com/o/r/pull/5) [`abc1234`](https://github.com/o/r/commit/abc1234) - feat',
    ].join('\n');
    expect(parseDependencyBumps(diff)).toEqual([]);
  });
});
