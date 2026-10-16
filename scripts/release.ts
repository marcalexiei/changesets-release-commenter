import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';

/**
 * Publish the release Changesets has already versioned.
 *
 * An action ships as a git ref, not an npm package, and `dist` stays gitignored on `main`. So the
 * workflow builds it and it is committed here as a child of `main`'s HEAD, and that commit is
 * what `vX.Y.Z` names. It is made through the API because GitHub signs what an app's token
 * commits there. `changesets/action` creates the GitHub release for each tag listed in
 * `CHANGESETS_OUTPUT`, and publishing it is what moves the `vX` tag.
 */

// `pnpm run` sets the `npm_package_*` ones, `changesets/action` sets `CHANGESETS_OUTPUT`.
const {
  CHANGESETS_OUTPUT,
  GITHUB_API_URL,
  GITHUB_REPOSITORY,
  GITHUB_TOKEN,
  npm_package_name,
  npm_package_version,
} = process.env;
if (CHANGESETS_OUTPUT === undefined) {
  throw new Error('CHANGESETS_OUTPUT is not set.');
}

const post = async (endpoint: string, body: object): Promise<string> => {
  const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${endpoint}: ${response.status} ${await response.text()}`);
  }
  const result = await response.json();
  // Creating a ref returns no `sha`, and nothing reads it.
  return typeof result === 'object' && result !== null && 'sha' in result ? String(result.sha) : '';
};

const rev = (spec: string): string => execFileSync('git', ['rev-parse', spec]).toString().trim();

const tag = `v${npm_package_version}`;

// Every push to `main` without changesets lands here, so skip a released version.
const released =
  execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]).length > 0;

// Missing output warns in `changesets/action`; an empty one just means nothing was published.
appendFileSync(CHANGESETS_OUTPUT, '');

if (!released) {
  const tree = await post('git/trees', {
    base_tree: rev('HEAD^{tree}'),
    tree: readdirSync('dist', { recursive: true, encoding: 'utf8' })
      .map((file) => `dist/${file}`)
      .filter((path) => statSync(path).isFile())
      .map((path) => ({ path, mode: '100644', type: 'blob', content: readFileSync(path, 'utf8') })),
  });
  // No author or committer: either would stop GitHub from signing it.
  const commit = await post('git/commits', { message: tag, tree, parents: [rev('HEAD')] });
  await post('git/refs', { ref: `refs/tags/${tag}`, sha: commit });

  appendFileSync(
    CHANGESETS_OUTPUT,
    `${JSON.stringify({ type: 'git-tag', tag, packageName: npm_package_name })}\n`,
  );
}
