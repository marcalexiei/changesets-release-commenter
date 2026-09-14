import * as core from '@actions/core';
import parseChangeset from '@changesets/parse';
import { getAllTags, isRepoShallow, deepenCloneBy } from '@changesets/git';
import { git, gitOrNull, gitSucceeds } from './git.js';
import type { PublishedPackage, Released, ResolveVia } from './types.js';

export interface CollectOptions {
  cwd: string;
  published: PublishedPackage[];
  resolveVia: ResolveVia;
  /** commit sha -> PR number, or null when the commit has no PR. */
  commitToPullRequest: (sha: string) => Promise<number | null>;
}

/**
 * The release commit is whatever a tag from this publish points at — never HEAD, which on a
 * workflow_run checkout follows the default branch and may have moved past the release.
 * Workspaces tag `<name>@<version>`; single-package repos tag `v<version>`.
 */
export async function resolveReleaseSha(
  cwd: string,
  published: PublishedPackage[],
): Promise<string> {
  // changesets/action pushes the release tags; they are not necessarily in the local clone.
  await gitOrNull(['fetch', '--tags', '--quiet'], cwd);

  const tags = await getAllTags(cwd);
  for (const { name, version } of published) {
    for (const tag of [`${name}@${version}`, `v${version}`]) {
      if (!tags.has(tag)) continue;
      const sha = await gitOrNull(['rev-list', '-n1', tag], cwd);
      if (sha) {
        core.info(`Release commit ${sha} (from tag ${tag})`);
        return sha;
      }
    }
  }
  const tried = published.flatMap(({ name, version }) => [`${name}@${version}`, `v${version}`]);
  throw new Error(
    `No tag from published-packages resolves to a commit. Tried: ${tried.join(', ')}. ` +
      `Repository has ${tags.size} tag(s): ${[...tags].slice(0, 10).join(', ')}`,
  );
}

/**
 * The commit that added `file`, searched from `ref` where it still exists.
 * Deliberately not `@changesets/git`'s getCommitsThatAddFiles: that passes `--follow`, which
 * requires the path to exist in the starting commit, so it finds nothing for a changeset the
 * release has already consumed. Changesets calls it before versioning; we run after.
 */
async function commitThatAddedFile(cwd: string, ref: string, file: string): Promise<string | null> {
  return gitOrNull(
    ['log', '--diff-filter=A', '--max-count=1', '--format=%H', ref, '--', file],
    cwd,
  );
}

function add(released: Released, pr: number, ref: string): void {
  const refs = released.get(pr) ?? new Set<string>();
  refs.add(ref);
  released.set(pr, refs);
}

/**
 * Route A: the `.changeset/*.md` files this release consumed. They are deleted by the release
 * commit but readable at its parent, and their front matter names the packages exactly as the
 * author declared them. Works with any changelog generator.
 */
async function collectViaChangesets(
  opts: CollectOptions,
  releaseSha: string,
  refFor: (name: string) => string | null,
): Promise<Released> {
  const { cwd } = opts;
  const released: Released = new Map();

  const deleted = (
    await git(
      ['diff', '--diff-filter=D', '--name-only', `${releaseSha}~1`, releaseSha, '--', '.changeset/*.md'],
      cwd,
    )
  )
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.endsWith('/README.md'));

  if (deleted.length === 0) return released;

  for (const file of deleted) {
    const contents = await gitOrNull(['show', `${releaseSha}~1:${file}`], cwd);
    if (!contents) {
      core.warning(`${file}: unreadable at ${releaseSha}~1`);
      continue;
    }
    const names = parseChangeset(contents).releases.map((r) => r.name);
    if (names.length === 0) {
      core.info(`  ${file}: no packages in front matter`);
      continue;
    }
    const sha = await commitThatAddedFile(cwd, `${releaseSha}~1`, file);
    if (!sha) {
      core.info(`  ${file}: no commit added it`);
      continue;
    }
    const pr = await opts.commitToPullRequest(sha);
    if (pr === null) {
      core.info(`  ${file}: ${sha.slice(0, 8)} has no associated PR`);
      continue;
    }
    for (const name of names) {
      const ref = refFor(name);
      if (ref) add(released, pr, ref);
      else core.info(`  ${file}: ${name} not in published-packages`);
    }
  }
  return released;
}

/** Pull `/pull/N` links out of a changelog diff, keyed by the changelog file they landed in. */
export function parseChangelogDiff(diff: string): Array<{ path: string; pr: number }> {
  const out: Array<{ path: string; pr: number }> = [];
  let path = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      path = line.slice('+++ b/'.length).trim();
      continue;
    }
    if (!line.startsWith('+')) continue;
    for (const m of line.matchAll(/\/pull\/(\d+)/g)) {
      const pr = Number(m[1]);
      if (!out.some((e) => e.path === path && e.pr === pr)) out.push({ path, pr });
    }
  }
  return out;
}

/**
 * Route B: `/pull/N` links in the changelog diff. Zero API calls, but needs a generator that
 * writes them. Dependency-bump lines carry only commit links, so transitive bumps self-exclude.
 */
async function collectViaChangelog(
  opts: CollectOptions,
  releaseSha: string,
  refFor: (name: string) => string | null,
): Promise<Released> {
  const { cwd } = opts;
  const released: Released = new Map();
  const diff = await git(
    ['diff', `${releaseSha}~1`, releaseSha, '--', '*CHANGELOG.md'],
    cwd,
  );

  for (const { path, pr } of parseChangelogDiff(diff)) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    const pkgJson = dir === '.' ? 'package.json' : `${dir}/package.json`;
    const raw = await gitOrNull(['show', `${releaseSha}:${pkgJson}`], cwd);
    if (!raw) continue;
    let name: string;
    try {
      name = JSON.parse(raw).name;
    } catch {
      continue;
    }
    const ref = refFor(name);
    if (ref) add(released, pr, ref);
  }
  return released;
}

export async function collect(opts: CollectOptions): Promise<Released> {
  const { cwd, published, resolveVia } = opts;

  const versions = new Map(published.map((p) => [p.name, `${p.name}@${p.version}`]));
  const refFor = (name: string) => versions.get(name) ?? null;

  const releaseSha = await resolveReleaseSha(cwd, published);

  const parents = (await git(['rev-list', '--parents', '-n1', releaseSha], cwd)).split(/\s+/);
  if (parents.length <= 1) {
    core.info('Release commit is the repository root — no earlier state to compare against.');
    return new Map();
  }

  // A shallow clone can be deepened rather than failing the run.
  if (await isRepoShallow({ cwd })) {
    core.info('Shallow clone — deepening to reach the release commit history.');
    await deepenCloneBy({ by: 50, cwd });
  }

  if (!(await gitSucceeds(['cat-file', '-e', `${releaseSha}~1`], cwd))) {
    throw new Error(`${releaseSha}~1 is unreachable. Use fetch-depth: 0.`);
  }

  if (resolveVia === 'changelog') {
    core.info('Resolving via changelog PR links:');
    return collectViaChangelog(opts, releaseSha, refFor);
  }

  core.info('Resolving via consumed changeset files:');
  const viaChangesets = await collectViaChangesets(opts, releaseSha, refFor);
  if (viaChangesets.size > 0 || resolveVia === 'changesets') return viaChangesets;

  core.info('No changesets resolved — falling back to changelog PR links:');
  return collectViaChangelog(opts, releaseSha, refFor);
}
