import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A fixed identity, so a fixture's commits do not depend on the machine building them. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

interface Repo {
  cwd: string;
  git: (...args: Array<string>) => string;
  write: (file: string, contents: string) => void;
  commit: (message: string) => string;
  tag: (name: string) => void;
}

function openRepo(cwd: string): Repo {
  const git = (...args: Array<string>): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } });

  const write = (file: string, contents: string): void => {
    const target = path.join(cwd, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  /** Returns the new sha, which fixtures need to write `Updated dependencies` links. */
  const commit = (message: string): string => {
    git('add', '--all');
    git('commit', '--quiet', '--message', message);
    return git('rev-parse', 'HEAD').trim();
  };

  const tag = (name: string): void => {
    git('tag', name);
  };

  return { cwd, git, write, commit, tag };
}

function initRepo(cwd: string): Repo {
  mkdirSync(cwd, { recursive: true });
  const repo = openRepo(cwd);
  repo.git('init', '--quiet', '--initial-branch=main');
  return repo;
}

/** Reads `(#N)` off a commit subject, standing in for the PR lookup the action does over the API. */
function pullRequestFromSubject(repo: Repo): (sha: string) => Promise<number | null> {
  return (sha) => {
    const subject = repo.git('log', '-1', '--format=%s', sha).trim();
    const match = /\(#(?<pr>\d+)\)$/u.exec(subject);
    const pr = match?.groups?.pr;
    return Promise.resolve(pr === undefined ? null : Number(pr));
  };
}

export { initRepo, openRepo, pullRequestFromSubject };
export type { Repo };
