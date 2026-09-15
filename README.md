# changesets-release-commenter

Comments on the pull requests a [Changesets](https://github.com/changesets/changesets) release
shipped, and on the issues those PRs close — naming **which package at which version** each one
shipped in, each version linked to its GitHub release.

> 🚀 Fixed by #42, released in:
>
> - [`@acme/core@2.4.0`](https://github.com/acme/acme/releases/tag/%40acme%2Fcore%402.4.0)
> - [`@acme/cli@1.9.2`](https://github.com/acme/acme/releases/tag/%40acme%2Fcli%401.9.2)

## Why another one

Other tools treat a release as one whole-repo event, so the most they can say is "released".
Changesets versions each package separately, so in a monorepo that answer is wrong — the person who
opened a `cli` bug report wants the `cli` version, not a list of four.

- [`apexskier/github-release-commenter`](https://github.com/apexskier/github-release-commenter)
  needs a `release` event. Changesets emits one per package, so a four-package publish comments
  four times on the same thread.
- [`changesets/action/pr-comment`](https://github.com/changesets/action/tree/main/pr-comment) only
  addresses the PR of the triggering event, not merged ones.
- [changesets#511](https://github.com/changesets/changesets/issues/511) has wanted this since 2021;
  [changesets/action#80](https://github.com/changesets/action/pull/80) stalled that year and does
  no per-package attribution either.

It reads the changesets the release consumed, so the attribution is the one Changesets itself
used — no guessing from file paths, no dependency on a particular changelog generator.

## Usage

Run it as its own job, after the one that runs `changesets/action`:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions: {}

jobs:
  release:
    runs-on: ubuntu-latest

    permissions:
      contents: write # release commits and tags
      pull-requests: write # the version PR

    outputs:
      published: ${{ steps.changesets.outputs.published }}
      publishedPackages: ${{ steps.changesets.outputs['published-packages'] }}

    steps:
      - uses: actions/checkout@v7

      - id: changesets
        uses: changesets/action@v2
        with:
          publish-script: 'pnpm release'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  comment:
    needs: release
    if: ${{ needs.release.outputs.published == 'true' }}
    runs-on: ubuntu-latest

    permissions:
      contents: read # checking out the repository
      pull-requests: write # commenting on shipped PRs
      issues: write # commenting on the issues those PRs close

    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # the action reads the history before the release commit

      - uses: marcalexiei/changesets-release-commenter@v0
        with:
          published-packages: ${{ needs.release.outputs.publishedPackages }}
```

Its own job rather than a step in the release one, for two reasons:

- It runs _after_ the packages are on npm. As a separate job, a failed comment is a red job to
  re-run — not an error swallowed inside a green release, and not a `continue-on-error: true`
  that hides it entirely.
- The release job never needs `issues: write`.

`published-packages` contains a dash, so it has to be read as `outputs['published-packages']`;
dot notation parses as a subtraction.

## Inputs

| Input                | Default                        | Description                                                            |
| -------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `published-packages` | —, required                    | The `published-packages` output of `changesets/action`.                |
| `github-token`       | `${{ github.token }}`          | Needs `pull-requests: write` and `issues: write`.                      |
| `comment-on`         | `both`                         | `both`, `prs`, or `issues`.                                            |
| `resolve-via`        | `auto`                         | `auto`, `changesets`, or `changelog`. See **How it works**.            |
| `include-dependents` | `true`                         | Also report packages republished because they depend on a changed one. |
| `link-releases`      | `true`                         | Link each `package@version` to its GitHub release page.                |
| `footer`             | `true`                         | Add a line crediting this action at the end of each comment.           |
| `marker-id`          | `changesets-release-commenter` | Hidden marker used to avoid double-posting.                            |
| `dry-run`            | `false`                        | Resolve and log everything, post nothing.                              |

## Outputs

| Output     | Description                                                                             |
| ---------- | --------------------------------------------------------------------------------------- |
| `released` | JSON, `{ "<pr>": { "direct": [...], "dependents": [...] } }` — what each PR shipped in. |

## How it works

1. Resolves the release commit from a tag this publish pushed — `<name>@<version>` in a workspace,
   `v<version>` otherwise. Never `HEAD`, which on a `workflow_run` checkout may have moved past the
   release.
2. Finds the PRs the release shipped (`resolve-via`):
   - **`changesets`** — the `.changeset/*.md` files the release consumed, read at the release
     commit's parent. Their front matter names the packages as the author declared them, so this
     works with **any** changelog generator; one API call per changeset.
   - **`changelog`** — `/pull/N` links in the `*CHANGELOG.md` diff, attributed to the package
     owning each file. Zero API calls, but needs `@changesets/changelog-github`.
   - **`auto`** (default) — `changesets`, falling back to `changelog`. Both give identical output,
     so `auto` changes only the number of API calls.
3. With `include-dependents` (default), also attributes packages republished _because_ of the
   change, listed separately.
4. Comments on each PR, then on the issues those PRs close, unioning the packages when several PRs
   close the same one.

Re-running is a no-op: each comment carries a marker holding the exact package set, and a thread
already carrying it is skipped.

## Limits

- `closingIssuesReferences` only sees closing keywords in the PR body. Issues closed by hand, or
  referenced only in a commit message, are missed.
- A changeset committed straight to the default branch has no PR, so it is skipped.
- A shallow clone is deepened automatically, but `fetch-depth: 0` starts deep and is faster.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
