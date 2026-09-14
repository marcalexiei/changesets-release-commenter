import { exec } from '@actions/exec';

/** Run git and return trimmed stdout, throwing on a non-zero exit. */
export async function git(args: string[], cwd: string): Promise<string> {
  let stdout = '';
  let stderr = '';
  const code = await exec('git', args, {
    cwd,
    silent: true,
    ignoreReturnCode: true,
    listeners: {
      stdout: (d) => (stdout += d.toString()),
      stderr: (d) => (stderr += d.toString()),
    },
  });
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  return stdout.trim();
}

/** Same, but `null` instead of throwing — for lookups that are allowed to miss. */
export async function gitOrNull(args: string[], cwd: string): Promise<string | null> {
  try {
    return await git(args, cwd);
  } catch {
    return null;
  }
}

/** Whether git exited zero — for probes like `cat-file -e` that print nothing on success. */
export async function gitSucceeds(args: string[], cwd: string): Promise<boolean> {
  try {
    await git(args, cwd);
    return true;
  } catch {
    return false;
  }
}
