import { describe, expect, it } from 'vitest';

import { renderSummary } from './summary.js';

describe('renderSummary', () => {
  it('lists what each PR shipped in and what happened on each thread', () => {
    const released = new Map([
      [6, { direct: new Set(['b@1.0.1']), dependents: new Set<string>() }],
      [5, { direct: new Set(['a@1.1.0']), dependents: new Set(['b@1.0.1']) }],
    ]);
    expect(
      renderSummary(released, [
        { kind: 'PR', number: 5, result: 'commented' },
        { kind: 'PR', number: 6, result: 'already-commented' },
        { kind: 'issue', number: 9, result: 'failed', error: 'a | b\nc' },
      ]),
    ).toBe(
      [
        '## Changesets release commenter',
        '',
        '| PR | Released in | Also republished |',
        '| --- | --- | --- |',
        '| #5 | `a@1.1.0` | `b@1.0.1` |',
        '| #6 | `b@1.0.1` | — |',
        '',
        '| Thread | Result |',
        '| --- | --- |',
        '| PR #5 | commented |',
        '| PR #6 | skipped, already commented |',
        String.raw`| issue #9 | ❌ failed: a \| b c |`,
        '',
      ].join('\n'),
    );
  });
});
