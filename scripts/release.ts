// An action ships as a git ref, not an npm package: commit the built `dist` on a detached
// commit, tag it, and force the major release line at it. `dist` stays gitignored on main.
import fs from 'node:fs';
import path from 'node:path';
import { exec } from '@actions/exec';

process.chdir(path.join(import.meta.dirname, '..'));

const pkgJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
const tag = `v${pkgJson.version}`;
const releaseLine = `v${pkgJson.version.split('.')[0]}`;
const isPrerelease = pkgJson.version.includes('-');

await exec('git', ['checkout', '--detach']);
await exec('git', ['add', '--force', 'dist']);
await exec('git', ['commit', '-m', tag]);
await exec('git', ['tag', tag]);

if (isPrerelease) {
  await exec('git', ['push', 'origin', `refs/tags/${tag}`]);
} else {
  await exec('git', ['push', '--force', '--follow-tags', 'origin', `HEAD:refs/heads/${releaseLine}`]);
}
