// An action ships as a git ref, not an npm package: commit the built `dist` on a detached
// commit, tag it, and force the major release line at it. `dist` stays gitignored on main.
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from '@actions/exec';

process.chdir(path.join(import.meta.dirname, '..'));

const pkgJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
const tag = `v${pkgJson.version}`;
const releaseLine = `v${pkgJson.version.split('.')[0]}`;
const isPrerelease = pkgJson.version.includes('-');

// The checkout persists no credentials, so authenticate the push with the app token — it is the
// identity the branch/tag protection bypass is granted to.
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) throw new Error('GITHUB_TOKEN is required');
const basic = Buffer.from(`x-access-token:${githubToken}`).toString('base64');
const gitEnv = {
  ...process.env,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
};

await exec('git', ['checkout', '--detach']);
await exec('git', ['add', '--force', 'dist']);
await exec('git', ['commit', '-m', tag]);
// Annotated, not lightweight: `git push --follow-tags` below only pushes annotated tags.
await exec('git', ['tag', tag, '-m', tag]);

if (isPrerelease) {
  await exec('git', ['push', 'origin', `refs/tags/${tag}`], { env: gitEnv });
} else {
  await exec('git', ['push', '--force', '--follow-tags', 'origin', `HEAD:refs/heads/${releaseLine}`], {
    env: gitEnv,
  });
}
