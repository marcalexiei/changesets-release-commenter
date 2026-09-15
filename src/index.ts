import { getBooleanInput, getInput, info, setFailed, setOutput } from '@actions/core';
import { context, getOctokit } from '@actions/github';

import { collect, resolveTags } from './collect.js';
import { comment } from './comment.js';
import type { CommentApi } from './comment.js';
import type { PublishedPackage } from './types.js';

function isPublishedPackage(value: unknown): value is PublishedPackage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'version' in value &&
    typeof value.version === 'string'
  );
}

function parsePublished(raw: string): Array<PublishedPackage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('published-packages is not valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('published-packages must be a JSON array.');
  }
  const packages: Array<PublishedPackage> = [];
  for (const entry of parsed as Array<unknown>) {
    if (!isPublishedPackage(entry)) {
      throw new TypeError('each published package needs a string `name` and `version`.');
    }
    packages.push(entry);
  }
  return packages;
}

const RESOLVE_VIA = ['auto', 'changesets', 'changelog'] as const;
const COMMENT_ON = ['both', 'prs', 'issues'] as const;

/** Narrow a raw input to one of `allowed`, failing with a message that names the options. */
function oneOf<Option extends string>(
  allowed: ReadonlyArray<Option>,
  value: string,
  input: string,
): Option {
  const match = allowed.find((option) => option === value);
  if (!match) {
    throw new Error(`${input} must be ${allowed.join(', ')} (got '${value}').`);
  }
  return match;
}

async function run(): Promise<void> {
  const token = getInput('github-token', { required: true });
  const published = parsePublished(getInput('published-packages', { required: true }));
  const resolveVia = oneOf(RESOLVE_VIA, getInput('resolve-via'), 'resolve-via');
  const commentOn = oneOf(COMMENT_ON, getInput('comment-on'), 'comment-on');
  if (published.length === 0) {
    info('published-packages is empty — nothing was released.');
    return;
  }

  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;
  const cwd = process.cwd();

  const released = await collect({
    cwd,
    published,
    resolveVia,
    includeDependents: getBooleanInput('include-dependents'),
    commitToPullRequest: async (sha) => {
      const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: sha,
      });
      return data[0]?.number ?? null;
    },
  });

  const summary = [...released].map(([pr, entry]) => [
    pr,
    { direct: [...entry.direct].toSorted(), dependents: [...entry.dependents].toSorted() },
  ]);
  setOutput('released', JSON.stringify(Object.fromEntries(summary)));

  if (released.size > 0) {
    info('resolved:');
    for (const [pr, entry] of released) {
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
      await octokit.rest.issues.createComment({ owner, repo, issue_number: issue, body });
    },
    closingIssues: async (pr) => {
      const res = await octokit.graphql<{
        repository: {
          pullRequest: { closingIssuesReferences: { nodes: Array<{ number: number }> } };
        };
      }>(
        `query($owner:String!,$repo:String!,$pr:Int!){
           repository(owner:$owner,name:$repo){
             pullRequest(number:$pr){ closingIssuesReferences(first:50){ nodes{ number } } }
           }
         }`,
        { owner, repo, pr },
      );
      return res.repository.pullRequest.closingIssuesReferences.nodes.map((node) => node.number);
    },
  };

  await comment({
    released,
    api,
    commentOn,
    markerId: getInput('marker-id'),
    dryRun: getBooleanInput('dry-run'),
    linkReleases: getBooleanInput('link-releases'),
    footer: getBooleanInput('footer'),
    serverUrl: process.env.GITHUB_SERVER_URL ?? 'https://github.com',
    repo: `${owner}/${repo}`,
    tags: await resolveTags(cwd, published),
  });
}

try {
  await run();
} catch (error: unknown) {
  setFailed(error instanceof Error ? error.message : String(error));
}
