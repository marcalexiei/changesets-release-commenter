import { exec } from '@actions/exec';

/** Run git and return trimmed stdout, throwing on a non-zero exit. */
async function git(args: ReadonlyArray<string>, cwd: string): Promise<string> {
  let stdout = '';
  let stderr = '';
  const code = await exec('git', [...args], {
    cwd,
    silent: true,
    ignoreReturnCode: true,
    listeners: {
      stdout: (chunk) => {
        stdout += chunk.toString();
      },
      stderr: (chunk) => {
        stderr += chunk.toString();
      },
    },
  });
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
}

/** Same, but `null` instead of throwing — for lookups that are allowed to miss. */
async function gitOrNull(args: ReadonlyArray<string>, cwd: string): Promise<string | null> {
  try {
    return await git(args, cwd);
  } catch {
    return null;
  }
}

/** Whether git exited zero — for probes like `cat-file -e` that print nothing on success. */
async function gitSucceeds(args: ReadonlyArray<string>, cwd: string): Promise<boolean> {
  try {
    await git(args, cwd);
    return true;
  } catch {
    return false;
  }
}

export { git, gitOrNull, gitSucceeds };
