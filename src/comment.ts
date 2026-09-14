import * as core from '@actions/core';
import type { Released } from './types.js';

export interface CommentApi {
  listCommentBodies: (issue: number) => Promise<string[]>;
  createComment: (issue: number, body: string) => Promise<void>;
  closingIssues: (pr: number) => Promise<number[]>;
}

export interface CommentOptions {
  released: Released;
  api: CommentApi;
  commentOn: 'both' | 'prs' | 'issues';
  markerId: string;
  dryRun: boolean;
  linkReleases: boolean;
  serverUrl: string;
  repo: string;
}

/** The marker carries the exact package set, so re-running the same release is a no-op. */
export function markerFor(markerId: string, refs: string[]): string {
  return `<!-- ${markerId}:${[...refs].sort().join(',')} -->`;
}

/**
 * GitHub encodes `@` in a release tag URL but leaves `/` literal, so a scoped tag reads
 * .../releases/tag/%40scope/name%401.0.0 — mirror that rather than fully percent-encoding.
 */
export function releaseUrl(serverUrl: string, repo: string, ref: string): string {
  return `${serverUrl}/${repo}/releases/tag/${ref.replaceAll('@', '%40')}`;
}

export function renderBody(opts: CommentOptions, lead: string, refs: string[]): string {
  const sorted = [...refs].sort();
  const items = sorted.map((ref) =>
    opts.linkReleases
      ? `- [\`${ref}\`](${releaseUrl(opts.serverUrl, opts.repo, ref)})`
      : `- \`${ref}\``,
  );
  return `${lead}\n\n${items.join('\n')}\n\n${markerFor(opts.markerId, sorted)}`;
}

async function post(
  opts: CommentOptions,
  number: number,
  body: string,
  marker: string,
  kind: string,
): Promise<void> {
  const existing = await opts.api.listCommentBodies(number);
  if (existing.some((b) => b.includes(marker))) {
    core.info(`  ${kind} #${number}: already commented, skipping`);
    return;
  }
  if (opts.dryRun) {
    core.info(`  ${kind} #${number}: DRY RUN, would post:\n${body}`);
    return;
  }
  await opts.api.createComment(number, body);
  core.info(`  ${kind} #${number}: commented`);
}

export async function comment(opts: CommentOptions): Promise<void> {
  const { released, commentOn } = opts;
  if (released.size === 0) {
    core.info('Nothing released to comment on.');
    return;
  }

  if (commentOn === 'both' || commentOn === 'prs') {
    core.info('Commenting on PRs:');
    for (const [pr, refs] of [...released].sort((a, b) => a[0] - b[0])) {
      const list = [...refs];
      const body = renderBody(opts, '🚀 This pull request has been released in:', list);
      await post(opts, pr, body, markerFor(opts.markerId, list), 'PR');
    }
  }

  if (commentOn === 'both' || commentOn === 'issues') {
    core.info('Resolving closed issues:');
    // issue -> { packages, prs }, unioned across every PR that closes it
    const issues = new Map<number, { refs: Set<string>; prs: Set<number> }>();
    for (const [pr, refs] of released) {
      const closed = await opts.api.closingIssues(pr);
      if (closed.length === 0) core.info(`  PR #${pr} closes no issues`);
      for (const issue of closed) {
        core.info(`  PR #${pr} closes issue #${issue}`);
        const entry = issues.get(issue) ?? { refs: new Set<string>(), prs: new Set<number>() };
        refs.forEach((r) => entry.refs.add(r));
        entry.prs.add(pr);
        issues.set(issue, entry);
      }
    }

    if (issues.size > 0) core.info('Commenting on issues:');
    for (const [issue, { refs, prs }] of [...issues].sort((a, b) => a[0] - b[0])) {
      const list = [...refs];
      const by = [...prs].sort((a, b) => a - b).map((p) => `#${p}`).join(', ');
      const body = renderBody(opts, `🚀 Fixed by ${by}, released in:`, list);
      await post(opts, issue, body, markerFor(opts.markerId, list), 'issue');
    }
  }
}
