// Version the package, then keep the README's `@vN` references in step with the new major line.
import fs from 'node:fs';
import path from 'node:path';
import { exec } from '@actions/exec';

process.chdir(path.join(import.meta.dirname, '..'));

await exec('changeset', ['version']);

const pkgJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
const releaseLine = `v${pkgJson.version.split('.')[0]}`;

const readmePath = path.join(process.cwd(), 'README.md');
fs.writeFileSync(
  readmePath,
  fs
    .readFileSync(readmePath, 'utf8')
    .replace(/marcalexiei\/changesets-release-commenter@[^\s)]+/g, `marcalexiei/changesets-release-commenter@${releaseLine}`),
);
