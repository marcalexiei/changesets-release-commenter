import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { collect } from './collect.js';
import { comment, type CommentApi } from './comment.js';
import type { PublishedPackage, ResolveVia } from './types.js';

function parsePublished(raw: string): PublishedPackage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('published-packages is not valid JSON.');
  }
  if (!Array.isArray(parsed)) throw new Error('published-packages must be a JSON array.');
  return parsed.map((p) => {
    if (
      typeof p !== 'object' || p === null ||
      typeof (p as PublishedPackage).name !== 'string' ||
      typeof (p as PublishedPackage).version !== 'string'
    ) {
      throw new Error('each published package needs a string `name` and `version`.');
    }
    return p as PublishedPackage;
  });
}

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true });
  const published = parsePublished(core.getInput('published-packages', { required: true }));
  const resolveVia = core.getInput('resolve-via') as ResolveVia;
  const commentOn = core.getInput('comment-on') as 'both' | 'prs' | 'issues';

  if (!['auto', 'changesets', 'changelog'].includes(resolveVia)) {
    throw new Error(`resolve-via must be auto, changesets or changelog (got '${resolveVia}').`);
  }
  if (!['both', 'prs', 'issues'].includes(commentOn)) {
    throw new Error(`comment-on must be both, prs or issues (got '${commentOn}').`);
  }
  if (published.length === 0) {
    core.info('published-packages is empty — nothing was released.');
    return;
  }

  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;
  const cwd = process.cwd();

  const released = await collect({
    cwd,
    published,
    resolveVia,
    commitToPullRequest: async (sha) => {
      const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner, repo, commit_sha: sha,
      });
      return data[0]?.number ?? null;
    },
  });

  core.setOutput(
    'released',
    JSON.stringify(Object.fromEntries([...released].map(([pr, refs]) => [pr, [...refs].sort()]))),
  );

  if (released.size > 0) {
    core.info('resolved:');
    for (const [pr, refs] of released) core.info(`  PR #${pr} -> ${[...refs].sort().join(', ')}`);
  }

  const api: CommentApi = {
    listCommentBodies: async (issue) => {
      const data = await octokit.paginate(octokit.rest.issues.listComments, {
        owner, repo, issue_number: issue, per_page: 100,
      });
      return data.map((c) => c.body ?? '');
    },
    createComment: async (issue, body) => {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: issue, body });
    },
    closingIssues: async (pr) => {
      const res = await octokit.graphql<{
        repository: { pullRequest: { closingIssuesReferences: { nodes: Array<{ number: number }> } } };
      }>(
        `query($owner:String!,$repo:String!,$pr:Int!){
           repository(owner:$owner,name:$repo){
             pullRequest(number:$pr){ closingIssuesReferences(first:50){ nodes{ number } } }
           }
         }`,
        { owner, repo, pr },
      );
      return res.repository.pullRequest.closingIssuesReferences.nodes.map((n) => n.number);
    },
  };

  await comment({
    released,
    api,
    commentOn,
    markerId: core.getInput('marker-id'),
    dryRun: core.getBooleanInput('dry-run'),
    linkReleases: core.getBooleanInput('link-releases'),
    serverUrl: process.env.GITHUB_SERVER_URL ?? 'https://github.com',
    repo: `${owner}/${repo}`,
  });
}

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
