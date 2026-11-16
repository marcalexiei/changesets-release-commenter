import { info, warning } from '@actions/core';

import type { CommentOn, ReleaseEntry, Released } from './types.js';
import { byNumber, errorMessage } from './util.js';

interface CommentApi {
  listCommentBodies: (issue: number) => Promise<Array<string>>;
  createComment: (issue: number, body: string) => Promise<void>;
  /** `repo` is the issue's `owner/name`: a PR can close issues in other repositories. */
  closingIssues: (pr: number) => Promise<Array<{ number: number; repo: string }>>;
}

interface CommentOptions {
  released: Released;
  api: CommentApi;
  commentOn: CommentOn;
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

/** What happened on one thread, so a failure does not stop the rest and can be reported after. */
interface Outcome {
  kind: 'PR' | 'issue';
  number: number;
  result: 'commented' | 'already-commented' | 'dry-run' | 'failed';
  error?: string;
}

interface PostRequest {
  kind: Outcome['kind'];
  number: number;
  lead: string;
  entry: ReleaseEntry;
}

/** Credits the action, so a reader can tell what posted the comment and turn it off. */
const FOOTER =
  '<sub>🤖 Posted by [changesets-release-commenter](https://github.com/marcalexiei/changesets-release-commenter)</sub>';

/** The marker carries the package set, so re-running the same release is a no-op. */
function markerFor(markerId: string, refs: ReadonlyArray<string>): string {
  return `<!-- ${markerId}:${refs.toSorted().join(',')} -->`;
}

/**
 * Whether a comment already names every one of `direct`. Dependents are left out of the match,
 * so a change in how they resolve, or `include-dependents`, does not post the release again.
 */
function alreadyCommented(
  bodies: ReadonlyArray<string>,
  markerId: string,
  direct: ReadonlyArray<string>,
): boolean {
  const prefix = `<!-- ${markerId}:`;
  return bodies.some((body) =>
    body
      .split(prefix)
      .slice(1)
      .some((rest) => {
        const end = rest.indexOf(' -->');
        if (end === -1) {
          return false;
        }
        const refs = new Set(rest.slice(0, end).split(','));
        return direct.every((ref) => refs.has(ref));
      }),
  );
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

async function post(options: CommentOptions, request: PostRequest): Promise<Outcome> {
  const { kind, number, entry } = request;
  try {
    const existing = await options.api.listCommentBodies(number);
    if (alreadyCommented(existing, options.markerId, [...entry.direct])) {
      info(`  ${kind} #${number}: already commented, skipping`);
      return { kind, number, result: 'already-commented' };
    }
    const body = renderBody(options, request.lead, entry);
    if (options.dryRun) {
      info(`  ${kind} #${number}: DRY RUN, would post:\n${body}`);
      return { kind, number, result: 'dry-run' };
    }
    await options.api.createComment(number, body);
    info(`  ${kind} #${number}: commented`);
    return { kind, number, result: 'commented' };
  } catch (error: unknown) {
    const message = errorMessage(error);
    warning(`${kind} #${number}: ${message}`);
    return { kind, number, result: 'failed', error: message };
  }
}

async function commentOnPullRequests(options: CommentOptions): Promise<Array<Outcome>> {
  info('Commenting on PRs:');
  const outcomes: Array<Outcome> = [];
  for (const [pr, entry] of byNumber(options.released)) {
    const lead = '🚀 This pull request has been released in:';
    // Serialized on purpose: parallel posting would trip secondary rate limits.
    // oxlint-disable-next-line no-await-in-loop
    outcomes.push(await post(options, { kind: 'PR', number: pr, lead, entry }));
  }
  return outcomes;
}

interface IssueEntry extends ReleaseEntry {
  prs: Set<number>;
}

/**
 * issue -> the packages and PRs that closed it, unioned across every PR in the release. A PR
 * whose closing issues cannot be read is reported in `failures`, and its issues go uncommented.
 */
async function groupIssues(
  options: CommentOptions,
  failures: Array<Outcome>,
): Promise<Map<number, IssueEntry>> {
  const issues = new Map<number, IssueEntry>();
  for (const [pr, released] of options.released) {
    let closed: Array<{ number: number; repo: string }> = [];
    try {
      // oxlint-disable-next-line no-await-in-loop
      closed = await options.api.closingIssues(pr);
      if (closed.length === 0) {
        info(`  PR #${pr} closes no issues`);
      }
    } catch (error: unknown) {
      const message = `reading the issues it closes: ${errorMessage(error)}`;
      warning(`PR #${pr}: ${message}`);
      failures.push({ kind: 'PR', number: pr, result: 'failed', error: message });
    }
    for (const { number: issue, repo } of closed) {
      if (repo.toLowerCase() === options.repo.toLowerCase()) {
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
      } else {
        info(`  PR #${pr} closes ${repo}#${issue}, outside this repository — skipping`);
      }
    }
  }
  return issues;
}

async function commentOnIssues(options: CommentOptions): Promise<Array<Outcome>> {
  info('Resolving closed issues:');
  const outcomes: Array<Outcome> = [];
  const issues = await groupIssues(options, outcomes);
  if (issues.size > 0) {
    info('Commenting on issues:');
  }
  for (const [issue, entry] of byNumber(issues)) {
    const by = [...entry.prs]
      .toSorted((one, two) => one - two)
      .map((pr) => `#${pr}`)
      .join(', ');
    const lead = `🚀 Fixed by ${by}, released in:`;
    // oxlint-disable-next-line no-await-in-loop
    outcomes.push(await post(options, { kind: 'issue', number: issue, lead, entry }));
  }
  return outcomes;
}

/** Every thread is attempted even when one fails; the caller decides what a failure means. */
async function comment(options: CommentOptions): Promise<Array<Outcome>> {
  if (options.released.size === 0) {
    info('Nothing released to comment on.');
    return [];
  }
  const outcomes: Array<Outcome> = [];
  if (options.commentOn === 'both' || options.commentOn === 'prs') {
    outcomes.push(...(await commentOnPullRequests(options)));
  }
  if (options.commentOn === 'both' || options.commentOn === 'issues') {
    outcomes.push(...(await commentOnIssues(options)));
  }
  return outcomes;
}

export { alreadyCommented, comment, FOOTER, markerFor, releaseUrl, renderBody };
export type { CommentApi, Outcome, RenderOptions };
