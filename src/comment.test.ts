import { describe, expect, it } from 'vitest';

import { alreadyCommented, comment, FOOTER, markerFor, releaseUrl, renderBody } from './comment.js';
import type { CommentApi, RenderOptions } from './comment.js';

const base: RenderOptions = {
  markerId: 'changesets-release-commenter',
  serverUrl: 'https://github.com',
  repo: 'o/r',
  linkReleases: true,
  footer: false,
  tags: new Map(),
};

describe('releaseUrl', () => {
  it('encodes @ but leaves the scope slash literal, as GitHub does', () => {
    expect(releaseUrl('https://github.com', 'o/r', '@scope/pkg@1.0.0')).toBe(
      'https://github.com/o/r/releases/tag/%40scope/pkg%401.0.0',
    );
  });
});

describe('markerFor', () => {
  it('is stable regardless of package order', () => {
    expect(markerFor('m', ['b@2', 'a@1'])).toBe(markerFor('m', ['a@1', 'b@2']));
  });
});

describe('alreadyCommented', () => {
  const id = 'changesets-release-commenter';

  it('matches a marker that also lists dependents', () => {
    expect(alreadyCommented([`x\n\n${markerFor(id, ['a@1', 'b@1'])}`], id, ['a@1'])).toBe(true);
  });

  it('matches a marker posted before dependents were listed', () => {
    expect(alreadyCommented([markerFor(id, ['a@1'])], id, ['a@1'])).toBe(true);
  });

  it('posts again when a direct package is missing from every marker', () => {
    expect(alreadyCommented([markerFor(id, ['a@1'])], id, ['a@1', 'b@1'])).toBe(false);
  });

  it('ignores markers with another id', () => {
    expect(alreadyCommented([markerFor('other', ['a@1'])], id, ['a@1'])).toBe(false);
  });

  it('ignores a version that only shares a prefix', () => {
    expect(alreadyCommented([markerFor(id, ['a@1.0.10'])], id, ['a@1.0.1'])).toBe(false);
  });
});

describe('renderBody', () => {
  it('links each version to its release', () => {
    expect(
      renderBody(base, '🚀 Released in:', {
        direct: new Set(['pkg@1.0.0']),
        dependents: new Set(),
      }),
    ).toBe(
      '🚀 Released in:\n\n- [`pkg@1.0.0`](https://github.com/o/r/releases/tag/pkg%401.0.0)\n\n' +
        '<!-- changesets-release-commenter:pkg@1.0.0 -->',
    );
  });

  it('links the tag the repository carries, which a single-package repo spells differently', () => {
    expect(
      renderBody({ ...base, tags: new Map([['pkg@1.0.0', 'v1.0.0']]) }, '🚀 Released in:', {
        direct: new Set(['pkg@1.0.0']),
        dependents: new Set(),
      }),
    ).toContain('- [`pkg@1.0.0`](https://github.com/o/r/releases/tag/v1.0.0)');
  });

  it('falls back to plain code spans when links are off', () => {
    expect(
      renderBody({ ...base, linkReleases: false }, 'x', {
        direct: new Set(['pkg@1.0.0']),
        dependents: new Set(),
      }),
    ).toContain('- `pkg@1.0.0`');
  });
});

describe('the footer', () => {
  it('sits between the packages and the marker, so the marker still ends the body', () => {
    expect(
      renderBody({ ...base, footer: true }, '🚀 Released in:', {
        direct: new Set(['pkg@1.0.0']),
        dependents: new Set(),
      }),
    ).toBe(
      '🚀 Released in:\n\n- [`pkg@1.0.0`](https://github.com/o/r/releases/tag/pkg%401.0.0)\n\n' +
        `${FOOTER}\n\n` +
        '<!-- changesets-release-commenter:pkg@1.0.0 -->',
    );
  });

  it('is absent when turned off', () => {
    const body = renderBody({ ...base, footer: false }, '🚀 Released in:', {
      direct: new Set(['pkg@1.0.0']),
      dependents: new Set(),
    });
    expect(body).not.toContain(FOOTER);
  });

  it('leaves the marker unchanged, so a comment posted before it is still deduplicated', () => {
    const entry = { direct: new Set(['pkg@1.0.0']), dependents: new Set<string>() };
    const marker = markerFor('changesets-release-commenter', ['pkg@1.0.0']);
    expect(renderBody({ ...base, footer: true }, 'x', entry)).toContain(marker);
    expect(renderBody({ ...base, footer: false }, 'x', entry)).toContain(marker);
  });
});

describe('a thread that fails', () => {
  const released = new Map([
    [1, { direct: new Set(['pkg@1.0.0']), dependents: new Set<string>() }],
    [2, { direct: new Set(['pkg@1.0.0']), dependents: new Set<string>() }],
    [3, { direct: new Set(['pkg@1.0.0']), dependents: new Set<string>() }],
  ]);

  const run = async (api: CommentApi): ReturnType<typeof comment> =>
    comment({ ...base, released, api, commentOn: 'both', dryRun: false });

  it('does not stop the threads after it', async () => {
    const posted: Array<number> = [];
    const outcomes = await run({
      listCommentBodies: async () => Promise.resolve([]),
      createComment: async (issue) => {
        if (issue === 2) {
          throw new Error('Resource not accessible by integration');
        }
        posted.push(issue);
        return Promise.resolve();
      },
      closingIssues: async () => Promise.resolve([]),
    });

    expect(posted).toEqual([1, 3]);
    expect(outcomes.filter((outcome) => outcome.result === 'failed')).toEqual([
      { kind: 'PR', number: 2, result: 'failed', error: 'Resource not accessible by integration' },
    ]);
  });

  it('reports a PR whose closing issues cannot be read, and comments on the others', async () => {
    const posted: Array<number> = [];
    const outcomes = await run({
      listCommentBodies: async () => Promise.resolve([]),
      createComment: async (issue) => {
        posted.push(issue);
        return Promise.resolve();
      },
      closingIssues: async (pr) =>
        pr === 1
          ? Promise.reject(new Error('timeout'))
          : Promise.resolve([{ number: pr * 10, repo: 'o/r' }]),
    });

    expect(posted).toEqual([1, 2, 3, 20, 30]);
    expect(outcomes.filter((outcome) => outcome.result === 'failed')).toEqual([
      {
        kind: 'PR',
        number: 1,
        result: 'failed',
        error: 'reading the issues it closes: timeout',
      },
    ]);
  });
});
