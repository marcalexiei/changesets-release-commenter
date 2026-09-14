// Version the package, then keep the README's `@vN` references in step with the new major line.
import fs from 'node:fs';
import path from 'node:path';

import { exec } from '@actions/exec';

/** package.json's version, read without asserting a shape onto JSON.parse. */
function readVersion(): string {
  const parsed: unknown = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    throw new Error('package.json has no version');
  }
  if (typeof parsed.version !== 'string') {
    throw new TypeError('package.json version is not a string');
  }
  return parsed.version;
}

process.chdir(path.join(import.meta.dirname, '..'));

await exec('changeset', ['version']);

const version = readVersion();

const releaseLine = `v${version.split('.')[0]}`;

const readmePath = path.join(process.cwd(), 'README.md');
fs.writeFileSync(
  readmePath,
  fs
    .readFileSync(readmePath, 'utf8')
    .replaceAll(
      /marcalexiei\/changesets-release-commenter@[^\s)]+/g,
      `marcalexiei/changesets-release-commenter@${releaseLine}`,
    ),
);
