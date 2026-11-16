import type { PublishedPackage } from './types.js';

function isPublishedPackage(value: unknown): value is PublishedPackage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'version' in value &&
    typeof value.version === 'string'
  );
}

function parsePublished(raw: string): Array<PublishedPackage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('published-packages is not valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('published-packages must be a JSON array.');
  }
  const packages: Array<PublishedPackage> = [];
  for (const entry of parsed as Array<unknown>) {
    if (!isPublishedPackage(entry)) {
      throw new TypeError('each published package needs a string `name` and `version`.');
    }
    packages.push(entry);
  }
  return packages;
}

const RESOLVE_VIA = ['auto', 'changesets', 'changelog'] as const;
const COMMENT_ON = ['both', 'prs', 'issues'] as const;

/** Narrow a raw input to one of `allowed`, failing with a message that names the options. */
function oneOf<Option extends string>(
  allowed: ReadonlyArray<Option>,
  value: string,
  input: string,
): Option {
  const match = allowed.find((option) => option === value);
  if (!match) {
    throw new Error(`${input} must be ${allowed.join(', ')} (got '${value}').`);
  }
  return match;
}

export { COMMENT_ON, oneOf, parsePublished, RESOLVE_VIA };
