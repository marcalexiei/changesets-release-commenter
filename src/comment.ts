import { info } from '@actions/core';

import type { Released } from './types.js';

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
  serverUrl: string;
  repo: string;
}

type RenderOptions = Pick<CommentOptions, 'markerId' | 'serverUrl' | 'repo' | 'linkReleases'>;

interface PostRequest {
  number: number;
  body: string;
  marker: string;
  kind: string;
}

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

function renderBody(options: RenderOptions, lead: string, refs: ReadonlyArray<string>): string {
  const sorted = refs.toSorted();
  const items = sorted.map((ref) =>
    options.linkReleases
      ? `- [\`${ref}\`](${releaseUrl(options.serverUrl, options.repo, ref)})`
      : `- \`${ref}\``,
  );
  return `${lead}\n\n${items.join('\n')}\n\n${markerFor(options.markerId, sorted)}`;
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
  for (const [pr, refs] of [...options.released].toSorted((one, two) => one[0] - two[0])) {
    const list = [...refs];
    const body = renderBody(options, '🚀 This pull request has been released in:', list);
    // Serialized on purpose: parallel posting would trip secondary rate limits.
    // oxlint-disable-next-line no-await-in-loop
    await post(options, {
      number: pr,
      body,
      marker: markerFor(options.markerId, list),
      kind: 'PR',
    });
  }
}

interface IssueEntry {
  refs: Set<string>;
  prs: Set<number>;
}

/** issue -> the packages and PRs that closed it, unioned across every PR in the release. */
async function groupIssues(options: CommentOptions): Promise<Map<number, IssueEntry>> {
  const issues = new Map<number, IssueEntry>();
  for (const [pr, refs] of options.released) {
    // oxlint-disable-next-line no-await-in-loop
    const closed = await options.api.closingIssues(pr);
    if (closed.length === 0) {
      info(`  PR #${pr} closes no issues`);
    }
    for (const issue of closed) {
      info(`  PR #${pr} closes issue #${issue}`);
      const entry = issues.get(issue) ?? { refs: new Set<string>(), prs: new Set<number>() };
      for (const ref of refs) {
        entry.refs.add(ref);
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
    const list = [...entry.refs];
    const by = [...entry.prs]
      .toSorted((one, two) => one - two)
      .map((pr) => `#${pr}`)
      .join(', ');
    const body = renderBody(options, `🚀 Fixed by ${by}, released in:`, list);
    // oxlint-disable-next-line no-await-in-loop
    await post(options, {
      number: issue,
      body,
      marker: markerFor(options.markerId, list),
      kind: 'issue',
    });
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

export { comment, markerFor, releaseUrl, renderBody };
export type { CommentApi, CommentOptions, RenderOptions };
