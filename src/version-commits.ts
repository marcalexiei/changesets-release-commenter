import { info, warning } from '@actions/core';
import { deepenCloneBy, isRepoShallow } from '@changesets/git';

import { gitLines, gitOrNull } from './git.js';
import type { PublishedPackage } from './types.js';

/** How far back from the tag to look for the version commits this publish shipped. */
const VERSION_SEARCH_DEPTH = 100;

/** The `.changeset/*.md` files a commit consumed, ignoring the folder's own README. */
async function deletedChangesets(cwd: string, sha: string): Promise<Array<string>> {
  const files = await gitLines(
    ['diff', '--diff-filter=D', '--name-only', `${sha}~1`, sha, '--', '.changeset/*.md'],
    cwd,
  );
  return files.filter((file) => !file.endsWith('/README.md'));
}

/** The `name` and `version` fields of a package.json, empty when it is missing or unparseable. */
function readManifest(raw: string | null): { name?: string; version?: string } {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  return {
    name: 'name' in parsed && typeof parsed.name === 'string' ? parsed.name : undefined,
    version: 'version' in parsed && typeof parsed.version === 'string' ? parsed.version : undefined,
  };
}

/** name -> new version, for every package.json whose version a commit changed. */
async function versionBumps(cwd: string, sha: string): Promise<Map<string, string>> {
  const files = await gitLines(
    ['diff', '--name-only', `${sha}~1`, sha, '--', '*package.json'],
    cwd,
  );
  const bumps = new Map<string, string>();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    const [after, before] = await Promise.all([
      gitOrNull(['show', `${sha}:${file}`], cwd),
      gitOrNull(['show', `${sha}~1:${file}`], cwd),
    ]);
    const { name, version } = readManifest(after);
    if (name !== undefined && version !== undefined && version !== readManifest(before).version) {
      bumps.set(name, version);
    }
  }
  return bumps;
}

/** `sha`'s first parent, deepening a shallow clone that ends at `sha`; null at the root. */
async function parentOf(cwd: string, sha: string): Promise<string | null> {
  const args = ['rev-parse', '--verify', '--quiet', `${sha}~1`];
  const parent = await gitOrNull(args, cwd);
  if (parent !== null || !(await isRepoShallow({ cwd }))) {
    return parent;
  }
  try {
    await deepenCloneBy({ by: 50, cwd });
  } catch {
    return null;
  }
  return gitOrNull(args, cwd);
}

/**
 * Every version commit this publish shipped, newest first, or the tagged commit when none is found.
 *
 * The tag names the version commit, or a build committed on top of it. A version commit also
 * publishes nothing while another changeset is pending, so the next publish ships its bumps too.
 * Walking back from the tag, a commit that consumed changesets belongs to this publish if it
 * bumped a package to the exact version published now; the first that bumped none is an earlier
 * release, and the walk stops there.
 */
async function resolveVersionShas(
  cwd: string,
  releaseSha: string,
  published: ReadonlyArray<PublishedPackage>,
): Promise<Array<string>> {
  const pending = new Map(published.map((pkg) => [pkg.name, pkg.version]));
  const shas: Array<string> = [];
  let sha = releaseSha;
  for (let depth = 0; depth < VERSION_SEARCH_DEPTH && pending.size > 0; depth += 1) {
    // oxlint-disable-next-line no-await-in-loop
    const parent = await parentOf(cwd, sha);
    if (parent === null) {
      // oxlint-disable-next-line no-await-in-loop
      if (await isRepoShallow({ cwd })) {
        warning(
          `The shallow history ends at ${sha} before ${[...pending.keys()].join(', ')} reached ` +
            'its version commit, so PRs from an earlier one may go uncredited. Use fetch-depth: 0.',
        );
      }
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    const consumed = await deletedChangesets(cwd, sha);
    if (consumed.length > 0) {
      // oxlint-disable-next-line no-await-in-loop
      const bumps = await versionBumps(cwd, sha);
      const explained = [...bumps.keys()].filter((name) => pending.get(name) === bumps.get(name));
      if (explained.length === 0) {
        break;
      }
      for (const name of explained) {
        pending.delete(name);
      }
      if (shas.length > 0) {
        info(`Version commit ${sha}: published only now, with ${shas[0] ?? ''}`);
      } else if (sha !== releaseSha) {
        info(`Version commit ${sha}: the tag names a commit built on top of it`);
      }
      shas.push(sha);
    }
    sha = parent;
  }
  return shas.length === 0 ? [releaseSha] : shas;
}

export { deletedChangesets, readManifest, resolveVersionShas };
