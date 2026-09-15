import { info } from '@actions/core';

import type { ReleaseEntry, Released } from './types.js';

interface CommentApi {
  listCommentBodies: (issue: number) => Promise<Array<string>>;
  createComment: (issue: number, body: string) => Promise<void>;
  closingIssues: (pr: number) => Promise<Array<number>>;
}

interface CommentOptions {
  released: Released;
  api: CommentApi;
  commentOn: 'both' | 'prs' | 'issues';
  markerId: string;
  dryRun: boolean;
  linkReleases: boolean;
  footer: boolean;
  serverUrl: string;
  repo: string;
  /** `<name>@<version>` -> the tag the repository actually carries for it. */
  tags: ReadonlyMap<string, string>;
}

type RenderOptions = Pick<
  CommentOptions,
  'markerId' | 'serverUrl' | 'repo' | 'linkReleases' | 'footer' | 'tags'
>;

interface PostRequest {
  number: number;
  body: string;
  marker: string;
  kind: string;
}

/** Credits the action, so a reader can tell what posted the comment and turn it off. */
const FOOTER =
  '<sub>🤖 Posted by [changesets-release-commenter](https://github.com/marcalexiei/changesets-release-commenter)</sub>';

/** The marker carries the exact package set, so re-running the same release is a no-op. */
function markerFor(markerId: string, refs: ReadonlyArray<string>): string {
  return `<!-- ${markerId}:${refs.toSorted().join(',')} -->`;
}

/**
 * GitHub encodes `@` in a release tag URL but leaves `/` literal, so a scoped tag reads
 * .../releases/tag/%40scope/name%401.0.0 — mirror that rather than fully percent-encoding.
 */
function releaseUrl(serverUrl: string, repo: string, ref: string): string {
  return `${serverUrl}/${repo}/releases/tag/${ref.replaceAll('@', '%40')}`;
}

/**
 * The label names the package, the link points at the tag. They differ in a single-package
 * repository, which is released as `<name>@<version>` but tagged `v<version>`.
 */
function renderList(options: RenderOptions, refs: ReadonlyArray<string>): string {
  return refs
    .toSorted()
    .map((ref) =>
      options.linkReleases
        ? `- [\`${ref}\`](${releaseUrl(options.serverUrl, options.repo, options.tags.get(ref) ?? ref)})`
        : `- \`${ref}\``,
    )
    .join('\n');
}

/**
 * Direct and dependent packages are listed separately: the direct ones are what the change *is*,
 * the dependents are how it reaches people. Merging them would overstate what changed in each.
 */
function renderBody(options: RenderOptions, lead: string, entry: ReleaseEntry): string {
  const direct = [...entry.direct];
  const dependents = [...entry.dependents];
  const sections = [`${lead}\n\n${renderList(options, direct)}`];
  if (dependents.length > 0) {
    sections.push(`Also republished with this change:\n\n${renderList(options, dependents)}`);
  }
  if (options.footer) {
    sections.push(FOOTER);
  }
  const marker = markerFor(options.markerId, [...direct, ...dependents]);
  return `${sections.join('\n\n')}\n\n${marker}`;
}

async function post(options: CommentOptions, request: PostRequest): Promise<void> {
  const existing = await options.api.listCommentBodies(request.number);
  if (existing.some((body) => body.includes(request.marker))) {
    info(`  ${request.kind} #${request.number}: already commented, skipping`);
    return;
  }
  if (options.dryRun) {
    info(`  ${request.kind} #${request.number}: DRY RUN, would post:\n${request.body}`);
    return;
  }
  await options.api.createComment(request.number, request.body);
  info(`  ${request.kind} #${request.number}: commented`);
}

async function commentOnPullRequests(options: CommentOptions): Promise<void> {
  info('Commenting on PRs:');
  for (const [pr, entry] of [...options.released].toSorted((one, two) => one[0] - two[0])) {
    const body = renderBody(options, '🚀 This pull request has been released in:', entry);
    const marker = markerFor(options.markerId, [...entry.direct, ...entry.dependents]);
    // Serialized on purpose: parallel posting would trip secondary rate limits.
    // oxlint-disable-next-line no-await-in-loop
    await post(options, { number: pr, body, marker, kind: 'PR' });
  }
}

interface IssueEntry {
  direct: Set<string>;
  dependents: Set<string>;
  prs: Set<number>;
}

/** issue -> the packages and PRs that closed it, unioned across every PR in the release. */
async function groupIssues(options: CommentOptions): Promise<Map<number, IssueEntry>> {
  const issues = new Map<number, IssueEntry>();
  for (const [pr, released] of options.released) {
    // oxlint-disable-next-line no-await-in-loop
    const closed = await options.api.closingIssues(pr);
    if (closed.length === 0) {
      info(`  PR #${pr} closes no issues`);
    }
    for (const issue of closed) {
      info(`  PR #${pr} closes issue #${issue}`);
      const entry = issues.get(issue) ?? {
        direct: new Set<string>(),
        dependents: new Set<string>(),
        prs: new Set<number>(),
      };
      for (const ref of released.direct) {
        entry.direct.add(ref);
      }
      for (const ref of released.dependents) {
        entry.dependents.add(ref);
      }
      entry.prs.add(pr);
      issues.set(issue, entry);
    }
  }
  return issues;
}

async function commentOnIssues(options: CommentOptions): Promise<void> {
  info('Resolving closed issues:');
  const issues = await groupIssues(options);
  if (issues.size > 0) {
    info('Commenting on issues:');
  }
  for (const [issue, entry] of [...issues].toSorted((one, two) => one[0] - two[0])) {
    const by = [...entry.prs]
      .toSorted((one, two) => one - two)
      .map((pr) => `#${pr}`)
      .join(', ');
    const body = renderBody(options, `🚀 Fixed by ${by}, released in:`, entry);
    const marker = markerFor(options.markerId, [...entry.direct, ...entry.dependents]);
    // oxlint-disable-next-line no-await-in-loop
    await post(options, { number: issue, body, marker, kind: 'issue' });
  }
}

async function comment(options: CommentOptions): Promise<void> {
  if (options.released.size === 0) {
    info('Nothing released to comment on.');
    return;
  }
  if (options.commentOn === 'both' || options.commentOn === 'prs') {
    await commentOnPullRequests(options);
  }
  if (options.commentOn === 'both' || options.commentOn === 'issues') {
    await commentOnIssues(options);
  }
}

export { comment, FOOTER, markerFor, releaseUrl, renderBody };
export type { CommentApi, CommentOptions, RenderOptions };
