import { info, warning } from '@actions/core';
import { isRepoShallow } from '@changesets/git';

import { git, gitOrNull, gitSucceeds } from './git.js';
import type { PublishedPackage } from './types.js';

/** How far back to look for the version commit when the tag names a later one. */
const VERSION_SEARCH_DEPTH = 5;

/** How far past the version commit to look for an earlier one the same publish shipped. */
const EARLIER_VERSION_SEARCH_DEPTH = 100;

/** The `.changeset/*.md` files a commit consumed, ignoring the folder's own README. */
async function deletedChangesets(cwd: string, sha: string): Promise<Array<string>> {
  const diff = await git(
    ['diff', '--diff-filter=D', '--name-only', `${sha}~1`, sha, '--', '.changeset/*.md'],
    cwd,
  );
  return diff
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.endsWith('/README.md'));
}

/**
 * The commit that consumed the changesets, which the tag usually names directly.
 *
 * A repository that ships a built artifact does not: it commits the build on top of the version
 * commit and tags that child, so the tag names the build and an ancestor consumed the changesets.
 * The nearest ancestor that deletes changeset files is this release's, and the search stops there.
 */
async function resolveVersionSha(cwd: string, releaseSha: string): Promise<string | null> {
  const walk = await git(
    ['rev-list', '--first-parent', `--max-count=${String(VERSION_SEARCH_DEPTH)}`, releaseSha],
    cwd,
  );

  for (const sha of walk.split('\n').filter((line) => line !== '')) {
    // oxlint-disable-next-line no-await-in-loop
    if (!(await gitSucceeds(['cat-file', '-e', `${sha}~1`], cwd))) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    const consumed = await deletedChangesets(cwd, sha);
    if (consumed.length > 0) {
      if (sha !== releaseSha) {
        info(`Version commit ${sha}: the tag names a commit built on top of it`);
      }
      return sha;
    }
  }

  return null;
}

/** The `name` and `version` fields of a package.json, or null when it is unparseable. */
function readManifest(raw: string): { name: string | null; version: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const name = 'name' in parsed && typeof parsed.name === 'string' ? parsed.name : null;
  const version = 'version' in parsed && typeof parsed.version === 'string' ? parsed.version : null;
  return { name, version };
}

/** name -> new version, for every package.json whose version a commit changed. */
async function versionBumps(cwd: string, sha: string): Promise<Map<string, string>> {
  const files = await git(['diff', '--name-only', `${sha}~1`, sha, '--', '*package.json'], cwd);
  const bumps = new Map<string, string>();
  for (const file of files.split('\n').filter((line) => line !== '')) {
    // oxlint-disable-next-line no-await-in-loop
    const [after, before] = await Promise.all([
      gitOrNull(['show', `${sha}:${file}`], cwd),
      gitOrNull(['show', `${sha}~1:${file}`], cwd),
    ]);
    const next = after === null ? null : readManifest(after);
    const previous = before === null ? null : readManifest(before);
    if (
      next !== null &&
      next.name !== null &&
      next.version !== null &&
      next.version !== previous?.version
    ) {
      bumps.set(next.name, next.version);
    }
  }
  return bumps;
}

/**
 * Every version commit this publish shipped, newest first.
 *
 * A version commit publishes nothing while another changeset is pending, so the next one's
 * publish also ships its bumps. An earlier version commit belongs to this publish only if it
 * bumped a package to the exact version being published; the first that does not is an earlier
 * release, and the search stops there.
 */
async function resolveVersionShas(
  cwd: string,
  releaseSha: string,
  published: ReadonlyArray<PublishedPackage>,
): Promise<Array<string>> {
  const first = await resolveVersionSha(cwd, releaseSha);
  if (first === null) {
    return [releaseSha];
  }

  const wanted = new Map(published.map((pkg) => [pkg.name, pkg.version]));
  const unexplained = new Set(wanted.keys());
  const explain = (bumps: ReadonlyMap<string, string>): boolean => {
    let explainedAny = false;
    for (const [name, version] of bumps) {
      if (unexplained.has(name) && wanted.get(name) === version) {
        unexplained.delete(name);
        explainedAny = true;
      }
    }
    return explainedAny;
  };

  /** A shallow clone can end before the earlier version commit; say so rather than stop silently. */
  const endsHere = async (sha: string): Promise<boolean> => {
    if (await gitSucceeds(['cat-file', '-e', `${sha}~1`], cwd)) {
      return false;
    }
    if (unexplained.size > 0 && (await isRepoShallow({ cwd }))) {
      warning(
        `The shallow history ends at ${sha} before ${[...unexplained].join(', ')} reached its ` +
          'version commit, so PRs from an earlier one may go uncredited. Use fetch-depth: 0.',
      );
    }
    return true;
  };

  explain(await versionBumps(cwd, first));
  const shas = [first];
  if (unexplained.size === 0 || (await endsHere(first))) {
    return shas;
  }

  const walk = await git(
    [
      'rev-list',
      '--first-parent',
      `--max-count=${String(EARLIER_VERSION_SEARCH_DEPTH)}`,
      `${first}~1`,
    ],
    cwd,
  );
  for (const sha of walk.split('\n').filter((line) => line !== '')) {
    // oxlint-disable-next-line no-await-in-loop
    if (unexplained.size === 0 || (await endsHere(sha))) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    const consumed = await deletedChangesets(cwd, sha);
    if (consumed.length > 0) {
      // oxlint-disable-next-line no-await-in-loop
      if (!explain(await versionBumps(cwd, sha))) {
        break;
      }
      info(`Version commit ${sha}: published only now, with ${first}`);
      shas.push(sha);
    }
  }
  return shas;
}

export { deletedChangesets, readManifest, resolveVersionShas };
