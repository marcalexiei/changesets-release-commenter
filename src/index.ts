import {
  getBooleanInput,
  getInput,
  info,
  setFailed,
  setOutput,
  summary,
  warning,
} from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';

import { collect, resolveTags } from './collect.js';
import { comment } from './comment.js';
import type { CommentApi } from './comment.js';
import { COMMENT_ON, oneOf, parsePublished, RESOLVE_VIA } from './inputs.js';
import { renderSummary } from './summary.js';
import { byNumber, errorMessage, serializeReleased } from './util.js';

/** Wait out a rate limit twice before giving up, so a large release does not fail on one. */
// oxlint-disable-next-line max-params -- the throttling plugin's handler signature
function onLimit(
  retryAfter: number,
  request: { method: string; url: string },
  _octokit: unknown,
  retryCount: number,
): boolean {
  warning(`Rate limited on ${request.method} ${request.url}, retrying in ${String(retryAfter)}s`);
  return retryCount < 2;
}

async function run(): Promise<void> {
  const token = getInput('github-token', { required: true });
  const published = parsePublished(getInput('published-packages', { required: true }));
  const resolveVia = oneOf(RESOLVE_VIA, getInput('resolve-via'), 'resolve-via');
  const commentOn = oneOf(COMMENT_ON, getInput('comment-on'), 'comment-on');
  if (published.length === 0) {
    info('published-packages is empty — nothing was released.');
    setOutput('released', '{}');
    return;
  }

  const octokit = getOctokit(
    token,
    // oxlint-disable-next-line typescript/strict-void-return -- it retries on `true`, though typed void
    { throttle: { onRateLimit: onLimit, onSecondaryRateLimit: onLimit } },
    retry,
    throttling,
  );
  const { owner, repo } = context.repo;
  const cwd = process.cwd();

  const tags = await resolveTags(cwd, published);

  const released = await collect({
    cwd,
    published,
    tags,
    resolveVia,
    includeDependents: getBooleanInput('include-dependents'),
    commitToPullRequest: async (sha) => {
      const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: sha,
      });
      // Open PRs whose branch contains the commit are listed too; only a merged one shipped it.
      return data.find((pr) => pr.merged_at !== null)?.number ?? null;
    },
  });

  setOutput('released', JSON.stringify(serializeReleased(released)));

  if (released.size > 0) {
    info('resolved:');
    for (const [pr, entry] of byNumber(released)) {
      const extra =
        entry.dependents.size === 0 ? '' : ` (+${String(entry.dependents.size)} dependent)`;
      info(`  PR #${pr} -> ${[...entry.direct].toSorted().join(', ')}${extra}`);
    }
  }

  const api: CommentApi = {
    listCommentBodies: async (issue) => {
      const data = await octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: issue,
        per_page: 100,
      });
      return data.map((entry) => entry.body ?? '');
    },
    createComment: async (issue, body) => {
      // A 5xx after the comment was created would post it twice if retried.
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue,
        body,
        request: { retries: 0 },
      });
    },
    closingIssues: async (pr) => {
      const res = await octokit.graphql<{
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: Array<{ number: number; repository: { nameWithOwner: string } }>;
            };
          };
        };
      }>(
        `query($owner:String!,$repo:String!,$pr:Int!){
           repository(owner:$owner,name:$repo){
             pullRequest(number:$pr){ closingIssuesReferences(first:50){ nodes{ number repository{ nameWithOwner } } } }
           }
         }`,
        { owner, repo, pr },
      );
      return res.repository.pullRequest.closingIssuesReferences.nodes.map((node) => ({
        number: node.number,
        repo: node.repository.nameWithOwner,
      }));
    },
  };

  const outcomes = await comment({
    released,
    api,
    commentOn,
    markerId: getInput('marker-id'),
    dryRun: getBooleanInput('dry-run'),
    linkReleases: getBooleanInput('link-releases'),
    footer: getBooleanInput('footer'),
    serverUrl: process.env.GITHUB_SERVER_URL ?? 'https://github.com',
    repo: `${owner}/${repo}`,
    tags,
  });

  // Only set inside a workflow run; writing without it throws.
  if (released.size > 0 && (process.env.GITHUB_STEP_SUMMARY ?? '') !== '') {
    await summary.addRaw(renderSummary(released, outcomes)).write();
  }

  const failed = outcomes.filter((outcome) => outcome.result === 'failed');
  if (failed.length > 0) {
    const list = failed.map((outcome) => `${outcome.kind} #${String(outcome.number)}`).join(', ');
    throw new Error(
      `${String(failed.length)} thread(s) failed: ${list}. Re-running retries only those.`,
    );
  }
}

try {
  await run();
} catch (error: unknown) {
  setFailed(errorMessage(error));
}
