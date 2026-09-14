# changesets-release-commenter

Comments on the pull requests a [Changesets](https://github.com/changesets/changesets) release
shipped, and on the issues those PRs close — naming **which package at which version** each one
shipped in.

```
🚀 Fixed by #433, released in:

- `eslint-plugin-zod-mini@1.9.1`
- `eslint-plugin-zod@4.12.1`
```

## Why another one

Existing tools treat a release as one whole-repo event, so the most they can say is "released".
Changesets versions each package separately, so that answer is wrong in a monorepo — the person
who opened a `zod-mini` rule request wants the `zod-mini` version, not a list of four.

- `apexskier/github-release-commenter` needs a `release` event. Changesets emits one per package,
  so a four-package publish comments four times on the same thread.
- `changesets/action/pr-comment` only addresses the PR of the triggering event, not merged ones.
- [changesets#511](https://github.com/changesets/changesets/issues/511) has wanted this since 2021;
  [changesets/action#80](https://github.com/changesets/action/pull/80) stalled in 2021 and does no
  per-package attribution either.

This action reads the release commit's `CHANGELOG.md` diff instead. Changesets writes one changelog
per package, so the diff *is* the per-package attribution, for free.

## Usage

```yaml
- name: Checkout
  uses: actions/checkout@v4
  with:
    fetch-depth: 0 # required: the diff needs <tag>~1

- id: changesets
  uses: changesets/action@v2
  with:
    publish-script: 'npm run release'

- name: Comment on shipped PRs and issues
  if: steps.changesets.outputs.published == 'true'
  continue-on-error: true # packages are already published; a failed comment must not fail the release
  uses: marcalexiei/changesets-release-commenter@v1
  with:
    published-packages: ${{ steps.changesets.outputs.published-packages }}
```

The job needs `pull-requests: write` and `issues: write`.

## Inputs

| Input                | Default                        | Description                                                        |
| -------------------- | ------------------------------ | ------------------------------------------------------------------ |
| `published-packages` | —, required                    | The `published-packages` output of `changesets/action`.             |
| `github-token`       | `${{ github.token }}`          | Needs `pull-requests: write` and `issues: write`.                   |
| `comment-on`         | `both`                         | `both`, `prs`, or `issues`.                                         |
| `marker-id`          | `changesets-release-commenter` | Hidden marker used to avoid double-posting.                         |
| `dry-run`            | `false`                        | Resolve and log everything, post nothing.                           |

## Outputs

| Output     | Description                                                          |
| ---------- | -------------------------------------------------------------------- |
| `released` | JSON, `{ "<pr>": ["name@version", …] }` — what each PR shipped in.    |

## How it works

1. Resolves the release commit from a tag this publish pushed (`name@version`, or `v<version>`).
   Never `HEAD`: on a `workflow_run` checkout that follows the default branch, which may have moved
   past the release, and the diff would silently come back empty.
2. Diffs `<tag>~1..<tag>` for `*CHANGELOG.md`. Each `+` line carrying a `/pull/N` link is attributed
   to the package owning that changelog file. Dependency-bump lines carry only commit links, so they
   exclude themselves with no filtering.
3. Comments on each PR, then resolves `closingIssuesReferences` per PR and comments on each issue,
   unioning the packages when several PRs close the same one.

Re-running is a no-op: each comment carries a marker holding the exact package set, and a thread
already carrying it is skipped.

## Requirements and limits

- Requires a changelog generator that writes PR links, i.e. `@changesets/changelog-github`.
  With the default generator there are no links and nothing is found.
- `closingIssuesReferences` only sees closing keywords in the PR body. Issues closed by hand, or
  referenced only in a commit message, are missed.
- `fetch-depth: 0`, so `<tag>~1` exists.
