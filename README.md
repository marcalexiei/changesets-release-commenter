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
| `resolve-via`        | `auto`                         | `auto`, `changesets`, or `changelog`. See **How it works**.         |
| `marker-id`          | `changesets-release-commenter` | Hidden marker used to avoid double-posting.                         |
| `dry-run`            | `false`                        | Resolve and log everything, post nothing.                           |

## Outputs

| Output     | Description                                                          |
| ---------- | -------------------------------------------------------------------- |
| `released` | JSON, `{ "<pr>": ["name@version", …] }` — what each PR shipped in.    |

## How it works

1. Resolves the release commit from a tag this publish pushed — `<name>@<version>` in a workspace,
   `v<version>` in a single-package repo.
   Never `HEAD`: on a `workflow_run` checkout that follows the default branch, which may have moved
   past the release, and the diff would silently come back empty.
2. Finds the PRs the release shipped, by one of two routes (`resolve-via`):
   - **`changesets`** — the `.changeset/*.md` files the release consumed. They are deleted by the
     release commit but readable at its parent; the front matter names the packages exactly as the
     author declared them, and the commit that added each file resolves to its PR.
     Works with **any** changelog generator. Costs one API call per changeset.
   - **`changelog`** — `/pull/N` links in the `*CHANGELOG.md` diff, attributed to the package owning
     each changelog file. Zero API calls, but needs a generator that writes PR links
     (`@changesets/changelog-github`). Dependency-bump lines carry only commit links, so transitive
     bumps exclude themselves with no filtering.
   - **`auto`** (default) — try `changesets`, fall back to `changelog`.
3. Comments on each PR, then resolves `closingIssuesReferences` per PR and comments on each issue,
   unioning the packages when several PRs close the same one.

Both routes are verified to produce identical output on the same release.

Re-running is a no-op: each comment carries a marker holding the exact package set, and a thread
already carrying it is skipped.

## Requirements and limits

- `fetch-depth: 0`, so `<tag>~1` and the changesets' own history are reachable.
- Works with both workspace monorepos and single-package repos.
- `closingIssuesReferences` only sees closing keywords in the PR body. Issues closed by hand, or
  referenced only in a commit message, are missed.
- A changeset committed straight to the default branch has no PR, so it is skipped.
- `resolve-via: changelog` additionally requires `@changesets/changelog-github`; the default `auto`
  does not.
