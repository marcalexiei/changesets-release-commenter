import { describe, expect, it } from 'vitest';

import { markerFor, releaseUrl, renderBody } from './comment.js';
import type { RenderOptions } from './comment.js';

const base: RenderOptions = {
  markerId: 'changesets-release-commenter',
  serverUrl: 'https://github.com',
  repo: 'o/r',
  linkReleases: true,
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
