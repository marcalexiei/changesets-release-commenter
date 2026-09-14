import { info } from '@actions/core';
import { deepenCloneBy, getAllTags, isRepoShallow } from '@changesets/git';
import { parseChangesetFile } from '@changesets/parse';

import { git, gitOrNull, gitSucceeds } from './git.js';
import type { PublishedPackage, Released, ResolveVia } from './types.js';

interface CollectOptions {
  cwd: string;
  published: ReadonlyArray<PublishedPackage>;
  resolveVia: ResolveVia;
  /** commit sha -> PR number, or null when the commit has no PR. */
  commitToPullRequest: (sha: string) => Promise<number | null>;
}

/** name -> `name@version`, for packages this run actually published. */
type RefFor = (name: string) => string | null;

interface ChangelogEntry {
  path: string;
  pr: number;
}

/**
 * The release commit is whatever a tag from this publish points at — never HEAD, which on a
 * workflow_run checkout follows the default branch and may have moved past the release.
 * Workspaces tag `<name>@<version>`; single-package repos tag `v<version>`.
 */
async function resolveReleaseSha(
  cwd: string,
  published: ReadonlyArray<PublishedPackage>,
): Promise<string> {
  // changesets/action pushes the release tags; they are not necessarily in the local clone.
  await gitOrNull(['fetch', '--tags', '--quiet'], cwd);

  const tags = await getAllTags(cwd);
  const candidates = published.flatMap(({ name, version }) => [
    `${name}@${version}`,
    `v${version}`,
  ]);

  for (const tag of candidates) {
    if (tags.has(tag)) {
      // oxlint-disable-next-line no-await-in-loop
      const sha = await gitOrNull(['rev-list', '-n1', tag], cwd);
      if (sha !== null) {
        info(`Release commit ${sha} (from tag ${tag})`);
        return sha;
      }
    }
  }

  const known = [...tags].slice(0, 10).join(', ');
  throw new Error(
    `No tag from published-packages resolves to a commit. Tried: ${candidates.join(', ')}. ` +
      `Repository has ${String(tags.size)} tag(s): ${known}`,
  );
}

function add(released: Released, pr: number, ref: string): void {
  const refs = released.get(pr) ?? new Set<string>();
  refs.add(ref);
  released.set(pr, refs);
}

/**
 * The commit that added `file`, searched from `ref` where it still exists.
 * Deliberately not `@changesets/git`'s getCommitsThatAddFiles: that passes `--follow`, which
 * requires the path to exist in the starting commit, so it finds nothing for a changeset the
 * release has already consumed. Changesets calls it before versioning; we run after.
 */
function commitThatAddedFile(cwd: string, ref: string, file: string): Promise<string | null> {
  return gitOrNull(
    ['log', '--diff-filter=A', '--max-count=1', '--format=%H', ref, '--', file],
    cwd,
  );
}

/** The packages one consumed changeset shipped, keyed by the PR that introduced it. */
async function resolveChangeset(
  options: CollectOptions,
  releaseSha: string,
  file: string,
): Promise<{ pr: number; names: ReadonlyArray<string> } | null> {
  const { cwd } = options;
  const contents = await gitOrNull(['show', `${releaseSha}~1:${file}`], cwd);
  if (contents === null) {
    info(`  ${file}: unreadable at ${releaseSha}~1`);
    return null;
  }

  const names = parseChangesetFile(contents).releases.map((release) => release.name);
  if (names.length === 0) {
    info(`  ${file}: no packages in front matter`);
    return null;
  }

  const sha = await commitThatAddedFile(cwd, `${releaseSha}~1`, file);
  if (sha === null) {
    info(`  ${file}: no commit added it`);
    return null;
  }

  const pr = await options.commitToPullRequest(sha);
  if (pr === null) {
    info(`  ${file}: ${sha.slice(0, 8)} has no associated PR`);
    return null;
  }

  return { pr, names };
}

/**
 * Route A: the `.changeset/*.md` files this release consumed. They are deleted by the release
 * commit but readable at its parent, and their front matter names the packages exactly as the
 * author declared them. Works with any changelog generator.
 */
async function collectViaChangesets(
  options: CollectOptions,
  releaseSha: string,
  refFor: RefFor,
): Promise<Released> {
  const released: Released = new Map();
  const diff = await git(
    [
      'diff',
      '--diff-filter=D',
      '--name-only',
      `${releaseSha}~1`,
      releaseSha,
      '--',
      '.changeset/*.md',
    ],
    options.cwd,
  );
  const deleted = diff
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.endsWith('/README.md'));

  for (const file of deleted) {
    // One API call per changeset, serialized so a large release does not trip rate limits.
    // oxlint-disable-next-line no-await-in-loop
    const resolved = await resolveChangeset(options, releaseSha, file);
    if (resolved !== null) {
      for (const name of resolved.names) {
        const ref = refFor(name);
        if (ref === null) {
          info(`  ${file}: ${name} not in published-packages`);
        } else {
          add(released, resolved.pr, ref);
        }
      }
    }
  }
  return released;
}

/** Pull `/pull/N` links out of a changelog diff, keyed by the changelog file they landed in. */
function parseChangelogDiff(diff: string): Array<ChangelogEntry> {
  const out: Array<ChangelogEntry> = [];
  const seen = new Set<string>();
  let path = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      path = line.slice('+++ b/'.length).trim();
    } else if (line.startsWith('+')) {
      for (const match of line.matchAll(/\/pull\/(?<pr>\d+)/gu)) {
        const pr = Number(match.groups?.pr);
        const key = `${path}#${String(pr)}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ path, pr });
        }
      }
    }
  }
  return out;
}

/** The `name` field of a package.json, or null when it is absent or unparseable. */
function packageNameOf(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('name' in parsed)) {
    return null;
  }
  return typeof parsed.name === 'string' ? parsed.name : null;
}

/**
 * Route B: `/pull/N` links in the changelog diff. Zero API calls, but needs a generator that
 * writes them. Dependency-bump lines carry only commit links, so transitive bumps self-exclude.
 */
async function collectViaChangelog(
  options: CollectOptions,
  releaseSha: string,
  refFor: RefFor,
): Promise<Released> {
  const { cwd } = options;
  const released: Released = new Map();
  const diff = await git(['diff', `${releaseSha}~1`, releaseSha, '--', '*CHANGELOG.md'], cwd);

  for (const { path, pr } of parseChangelogDiff(diff)) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    const pkgJson = dir === '.' ? 'package.json' : `${dir}/package.json`;
    // oxlint-disable-next-line no-await-in-loop
    const raw = await gitOrNull(['show', `${releaseSha}:${pkgJson}`], cwd);
    const name = raw === null ? null : packageNameOf(raw);
    const ref = name === null ? null : refFor(name);
    if (ref !== null) {
      add(released, pr, ref);
    }
  }
  return released;
}

async function collect(options: CollectOptions): Promise<Released> {
  const { cwd, published, resolveVia } = options;

  const versions = new Map(published.map((pkg) => [pkg.name, `${pkg.name}@${pkg.version}`]));
  const refFor: RefFor = (name) => versions.get(name) ?? null;

  const releaseSha = await resolveReleaseSha(cwd, published);

  const revList = await git(['rev-list', '--parents', '-n1', releaseSha], cwd);
  if (revList.split(/\s+/u).length <= 1) {
    info('Release commit is the repository root — no earlier state to compare against.');
    return new Map();
  }

  // A shallow clone can be deepened rather than failing the run.
  if (await isRepoShallow({ cwd })) {
    info('Shallow clone — deepening to reach the release commit history.');
    await deepenCloneBy({ by: 50, cwd });
  }

  if (!(await gitSucceeds(['cat-file', '-e', `${releaseSha}~1`], cwd))) {
    throw new Error(`${releaseSha}~1 is unreachable. Use fetch-depth: 0.`);
  }

  if (resolveVia === 'changelog') {
    info('Resolving via changelog PR links:');
    return collectViaChangelog(options, releaseSha, refFor);
  }

  info('Resolving via consumed changeset files:');
  const viaChangesets = await collectViaChangesets(options, releaseSha, refFor);
  if (viaChangesets.size > 0 || resolveVia === 'changesets') {
    return viaChangesets;
  }

  info('No changesets resolved — falling back to changelog PR links:');
  return collectViaChangelog(options, releaseSha, refFor);
}

export { collect, parseChangelogDiff, resolveReleaseSha };
export type { CollectOptions };
