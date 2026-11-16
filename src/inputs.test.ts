import { describe, expect, it } from 'vitest';

import { COMMENT_ON, oneOf, parsePublished } from './inputs.js';

describe('parsePublished', () => {
  it('reads the changesets/action output', () => {
    expect(parsePublished('[{"name":"pkg","version":"1.0.0"}]')).toEqual([
      { name: 'pkg', version: '1.0.0' },
    ]);
  });

  it('accepts an empty release', () => {
    expect(parsePublished('[]')).toEqual([]);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parsePublished('pkg@1.0.0')).toThrow('published-packages is not valid JSON.');
  });

  it('rejects JSON that is not an array', () => {
    expect(() => parsePublished('{"name":"pkg","version":"1.0.0"}')).toThrow(
      'published-packages must be a JSON array.',
    );
  });

  it('rejects an entry without a string version', () => {
    expect(() => parsePublished('[{"name":"pkg","version":1}]')).toThrow(
      'each published package needs a string `name` and `version`.',
    );
  });
});

describe('oneOf', () => {
  it('returns an allowed value', () => {
    expect(oneOf(COMMENT_ON, 'prs', 'comment-on')).toBe('prs');
  });

  it('names the options when the value is not one of them', () => {
    expect(() => oneOf(COMMENT_ON, 'all', 'comment-on')).toThrow(
      "comment-on must be both, prs, issues (got 'all').",
    );
  });
});
