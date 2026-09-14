import { info } from '@actions/core';
import { deepenCloneBy, getAllTags, isRepoShallow } from '@changesets/git';
import { parseChangesetFile } from '@changesets/parse';

import { git, gitOrNull, gitSucceeds } from './git.js';
import type { PublishedPackage, ReleaseEntry, Released, ResolveVia } from './types.js';

/** How far back to look for the version commit when the tag names a later one. */
const VERSION_SEARCH_DEPTH = 5;

interface CollectOptions {
  cwd: string;
  published: ReadonlyArray<PublishedPackage>;
  resolveVia: ResolveVia;
  /** Also report packages republished only because they depend on a directly-changed one. */
  includeDependents: boolean;
  /** commit sha -> PR number, or null when the commit has no PR. */
  commitToPullRequest: (sha: string) => Promise<number | null>;
}

/** name -> `name@version`, for packages this run actually published. */
type RefFor = (name: string) => string | null;

/** Everything a resolution pass needs, threaded through instead of repeated as parameters. */
interface Pass {
  options: CollectOptions;
  /** The commit that consumed the changesets, which is not always the tagged one. */
  versionSha: string;
  refFor: RefFor;
}

interface ChangelogEntry {
  path: string;
  pr: number;
}

/** The two shapes a release tag takes: workspaces tag `<name>@<version>`, single packages `v<version>`. */
function tagCandidates({ name, version }: PublishedPackage): Array<string> {
  return [`${name}@${version}`, `v${version}`];
}

/**
 * The tag each published package actually carries, keyed by `<name>@<version>` — which is how
 * the rest of the run names a package, and not always how the repository tags it.
 */
async function resolveTags(
  cwd: string,
  published: ReadonlyArray<PublishedPackage>,
): Promise<Map<string, string>> {
  // changesets/action pushes the release tags; they are not necessarily in the local clone.
  await gitOrNull(['fetch', '--tags', '--quiet'], cwd);
  const tags = await getAllTags(cwd);

  const resolved = new Map<string, string>();
  for (const pkg of published) {
    const tag = tagCandidates(pkg).find((candidate) => tags.has(candidate));
    if (tag !== undefined) {
      resolved.set(`${pkg.name}@${pkg.version}`, tag);
    }
  }
  return resolved;
}

/**
 * The release commit is whatever a tag from this publish points at — never HEAD, which on a
 * workflow_run checkout follows the default branch and may have moved past the release.
 */
async function resolveReleaseSha(
  cwd: string,
  published: ReadonlyArray<PublishedPackage>,
  tags: ReadonlyMap<string, string>,
): Promise<string> {
  for (const tag of tags.values()) {
    // oxlint-disable-next-line no-await-in-loop
    const sha = await gitOrNull(['rev-list', '-n1', tag], cwd);
    if (sha !== null) {
      info(`Release commit ${sha} (from tag ${tag})`);
      return sha;
    }
  }

  const all = await getAllTags(cwd);
  const known = [...all].slice(0, 10).join(', ');
  throw new Error(
    `No tag from published-packages resolves to a commit. ` +
      `Tried: ${published.flatMap((pkg) => tagCandidates(pkg)).join(', ')}. ` +
      `Repository has ${String(all.size)} tag(s): ${known}`,
  );
}

function entryFor(released: Released, pr: number): ReleaseEntry {
  const existing = released.get(pr);
  if (existing !== undefined) {
    return existing;
  }
  const created: ReleaseEntry = { direct: new Set<string>(), dependents: new Set<string>() };
  released.set(pr, created);
  return created;
}

function add(released: Released, pr: number, ref: string): void {
  entryFor(released, pr).direct.add(ref);
}

/** A dependent never shadows a direct mention of the same package. */
function addDependent(released: Released, pr: number, ref: string): void {
  const entry = entryFor(released, pr);
  if (!entry.direct.has(ref)) {
    entry.dependents.add(ref);
  }
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
  pass: Pass,
  file: string,
): Promise<{ pr: number; names: ReadonlyArray<string> } | null> {
  const { options, versionSha } = pass;
  const { cwd } = options;
  const contents = await gitOrNull(['show', `${versionSha}~1:${file}`], cwd);
  if (contents === null) {
    info(`  ${file}: unreadable at ${versionSha}~1`);
    return null;
  }

  const names = parseChangesetFile(contents).releases.map((release) => release.name);
  if (names.length === 0) {
    info(`  ${file}: no packages in front matter`);
    return null;
  }

  const sha = await commitThatAddedFile(cwd, `${versionSha}~1`, file);
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
 * Nothing between two releases deletes changeset files, so the nearest ancestor that does is this
 * release's, and the search stops there.
 */
async function resolveVersionSha(cwd: string, releaseSha: string): Promise<string> {
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

  return releaseSha;
}

/**
 * Route A: the `.changeset/*.md` files this release consumed. They are deleted by the release
 * commit but readable at its parent, and their front matter names the packages exactly as the
 * author declared them. Works with any changelog generator.
 */
async function collectViaChangesets(pass: Pass): Promise<Released> {
  const { options, versionSha, refFor } = pass;
  const released: Released = new Map();
  const deleted = await deletedChangesets(options.cwd, versionSha);

  for (const file of deleted) {
    // One API call per changeset, serialized so a large release does not trip rate limits.
    // oxlint-disable-next-line no-await-in-loop
    const resolved = await resolveChangeset(pass, file);
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

/**
 * `Updated dependencies [[`sha`](…/commit/sha), …]:` lines, keyed by the changelog they landed in.
 * The commit identifies the change that caused the bump, which resolves to the PR that made it.
 * Only `@changesets/changelog-github` writes those links; other generators yield nothing here.
 */
function parseDependencyBumps(diff: string): Array<{ path: string; sha: string }> {
  const out: Array<{ path: string; sha: string }> = [];
  const seen = new Set<string>();
  let path = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      path = line.slice('+++ b/'.length).trim();
    } else if (line.startsWith('+') && line.includes('Updated dependencies')) {
      for (const match of line.matchAll(/\/commit\/(?<sha>[0-9a-f]{7,40})/gu)) {
        const sha = match.groups?.sha ?? '';
        const key = `${path}#${sha}`;
        if (sha !== '' && !seen.has(key)) {
          seen.add(key);
          out.push({ path, sha });
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

/** The published `name@version` of the package owning a changelog path, or null. */
async function refForChangelog(pass: Pass, path: string): Promise<string | null> {
  const { options, versionSha, refFor } = pass;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
  const pkgJson = dir === '.' ? 'package.json' : `${dir}/package.json`;
  const raw = await gitOrNull(['show', `${versionSha}:${pkgJson}`], options.cwd);
  const name = raw === null ? null : packageNameOf(raw);
  return name === null ? null : refFor(name);
}

/**
 * Attribute every transitively-bumped package back to the PR that caused the bump, so a
 * changeset on a shared package still tells the reader which consumer versions carry it.
 */
async function collectDependents(pass: Pass, released: Released): Promise<void> {
  const { options, versionSha } = pass;
  const diff = await git(
    ['diff', `${versionSha}~1`, versionSha, '--', '*CHANGELOG.md'],
    options.cwd,
  );
  const bumps = parseDependencyBumps(diff);
  if (bumps.length === 0) {
    return;
  }

  const prBySha = new Map<string, number | null>();
  for (const { path, sha } of bumps) {
    if (!prBySha.has(sha)) {
      // oxlint-disable-next-line no-await-in-loop
      prBySha.set(sha, await options.commitToPullRequest(sha));
    }
    const pr = prBySha.get(sha) ?? null;
    if (pr !== null) {
      // oxlint-disable-next-line no-await-in-loop
      const ref = await refForChangelog(pass, path);
      if (ref !== null) {
        addDependent(released, pr, ref);
      }
    }
  }
}

/**
 * Route B: `/pull/N` links in the changelog diff. Zero API calls, but needs a generator that
 * writes them. Dependency-bump lines carry only commit links, so transitive bumps self-exclude.
 */
async function collectViaChangelog(pass: Pass): Promise<Released> {
  const { options, versionSha } = pass;
  const { cwd } = options;
  const released: Released = new Map();
  const diff = await git(['diff', `${versionSha}~1`, versionSha, '--', '*CHANGELOG.md'], cwd);

  for (const { path, pr } of parseChangelogDiff(diff)) {
    // oxlint-disable-next-line no-await-in-loop
    const ref = await refForChangelog(pass, path);
    if (ref !== null) {
      add(released, pr, ref);
    }
  }
  return released;
}

/** The packages each PR's own changeset named, by whichever route is configured. */
async function collectDirect(pass: Pass): Promise<Released> {
  if (pass.options.resolveVia === 'changelog') {
    info('Resolving via changelog PR links:');
    return collectViaChangelog(pass);
  }

  info('Resolving via consumed changeset files:');
  const viaChangesets = await collectViaChangesets(pass);
  if (viaChangesets.size > 0 || pass.options.resolveVia === 'changesets') {
    return viaChangesets;
  }

  info('No changesets resolved — falling back to changelog PR links:');
  return collectViaChangelog(pass);
}

async function collect(options: CollectOptions): Promise<Released> {
  const { cwd, published } = options;

  const versions = new Map(published.map((pkg) => [pkg.name, `${pkg.name}@${pkg.version}`]));
  const refFor: RefFor = (name) => versions.get(name) ?? null;

  const releaseSha = await resolveReleaseSha(cwd, published, await resolveTags(cwd, published));

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

  const pass: Pass = { options, versionSha: await resolveVersionSha(cwd, releaseSha), refFor };
  const released = await collectDirect(pass);

  // Dependents always come from the changelog: only it records why a package was republished.
  if (options.includeDependents && released.size > 0) {
    await collectDependents(pass, released);
  }

  return released;
}

export { collect, parseChangelogDiff, parseDependencyBumps, resolveReleaseSha, resolveTags };
export type { CollectOptions };
