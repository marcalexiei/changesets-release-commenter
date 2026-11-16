# changesets-release-commenter

## 0.4.0

### Minor Changes

- [#67](https://github.com/marcalexiei/changesets-release-commenter/pull/67) [`3f489ed`](https://github.com/marcalexiei/changesets-release-commenter/commit/3f489ede47b853edf7600d31f8916ebf59d3a24f) - feat: write a job summary of what each PR shipped in and what happened on each thread

### Patch Changes

- [#57](https://github.com/marcalexiei/changesets-release-commenter/pull/57) [`044d581`](https://github.com/marcalexiei/changesets-release-commenter/commit/044d581002a2965418e25a187777cb549135803d) - fix: skip a thread whose marker already names every directly-changed package, so a different set of dependents does not post the release again

- [#48](https://github.com/marcalexiei/changesets-release-commenter/pull/48) [`56ee0a8`](https://github.com/marcalexiei/changesets-release-commenter/commit/56ee0a8a5954647131243f02296202f4380217ac) - fix: deepen a shallow clone before deciding the release commit has no parent

- [#58](https://github.com/marcalexiei/changesets-release-commenter/pull/58) [`7a73946`](https://github.com/marcalexiei/changesets-release-commenter/commit/7a739463bf880f375227f09aea39c4932d492123) - fix: set the `released` output to `{}` when `published-packages` is empty

- [#63](https://github.com/marcalexiei/changesets-release-commenter/pull/63) [`5350c22`](https://github.com/marcalexiei/changesets-release-commenter/commit/5350c2221848f1f12058661915a7ff08147884c8) - fix: keep commenting on the remaining threads when one fails, then fail the run listing the ones that did

- [#56](https://github.com/marcalexiei/changesets-release-commenter/pull/56) [`e396166`](https://github.com/marcalexiei/changesets-release-commenter/commit/e3961660471945ee92788a19cd77e6b7d0779335) - fix: credit the PRs of an earlier version commit that the same publish shipped

- [#59](https://github.com/marcalexiei/changesets-release-commenter/pull/59) [`3500649`](https://github.com/marcalexiei/changesets-release-commenter/commit/3500649be1cf38c58322f2926f5cd57bbf170a4a) - fix: list the newest tags of the published packages when none of their tags resolve

- [#70](https://github.com/marcalexiei/changesets-release-commenter/pull/70) [`c0a3d62`](https://github.com/marcalexiei/changesets-release-commenter/commit/c0a3d6293bbb352bf26d6db323bc3098e9babd78) - fix: find every version commit in one walk from the tag, deepening a shallow clone when the walk reaches its end

- [#50](https://github.com/marcalexiei/changesets-release-commenter/pull/50) [`7d93cd1`](https://github.com/marcalexiei/changesets-release-commenter/commit/7d93cd1f599f2177c055c642e8e249c769bc5dde) - fix: attribute a changeset to the merged PR that introduced it, not an open PR that also contains the commit

- [#51](https://github.com/marcalexiei/changesets-release-commenter/pull/51) [`0391c38`](https://github.com/marcalexiei/changesets-release-commenter/commit/0391c386dc37f47a1ff87485f71f88a251cc6a48) - docs: describe the `released` output's `direct` and `dependents` lists in `action.yml`

- [#68](https://github.com/marcalexiei/changesets-release-commenter/pull/68) [`f0747e1`](https://github.com/marcalexiei/changesets-release-commenter/commit/f0747e19f53b95a61aa7431400311f5ee45f3829) - fix: retry GitHub API calls after a rate limit or a transient error, except creating a comment, which a retry could post twice

- [#49](https://github.com/marcalexiei/changesets-release-commenter/pull/49) [`afc643d`](https://github.com/marcalexiei/changesets-release-commenter/commit/afc643d75dba4f74d87102f53966a0eec8bfdc11) - fix: skip issues a PR closes in another repository instead of commenting on the same number here

- [#66](https://github.com/marcalexiei/changesets-release-commenter/pull/66) [`f998444`](https://github.com/marcalexiei/changesets-release-commenter/commit/f998444578816ac50bf9e6ded239c3fb513d6efa) - fix: warn when a shallow clone ends before an earlier version commit the publish may have shipped

## 0.3.1

### Patch Changes

- [#37](https://github.com/marcalexiei/changesets-release-commenter/pull/37) [`16fe23a`](https://github.com/marcalexiei/changesets-release-commenter/commit/16fe23abd1ffcc2341b025215f6ac907b44a7482) - ci: sign release commits and move `v0` as a tag

## 0.3.0

### Minor Changes

- [#20](https://github.com/marcalexiei/changesets-release-commenter/pull/20) [`6428f54`](https://github.com/marcalexiei/changesets-release-commenter/commit/6428f5485d9d47576a3382bf7d85f9b99b4f7300) - feat: credit the action in a comment footer
  
  Sits before the hidden marker, so a thread carrying a comment from an earlier version still deduplicates. `footer: false` leaves it out.

### Patch Changes

- [#25](https://github.com/marcalexiei/changesets-release-commenter/pull/25) [`68f8e18`](https://github.com/marcalexiei/changesets-release-commenter/commit/68f8e1845835e1dc8060ad0ffb47fd8f98fc46ad) - chore(deps): update `@actions/core`, `@actions/exec` and `@actions/github` to their current majors

## 0.2.2

### Patch Changes

- [#14](https://github.com/marcalexiei/changesets-release-commenter/pull/14) [`fc84b74`](https://github.com/marcalexiei/changesets-release-commenter/commit/fc84b748768a7593cdab342e6cc885987f608d56) - Link each version to the tag the repository actually carries. The href was built from `<name>@<version>`, so every comment in a single-package repository — tagged `v<version>` — pointed at a release that does not exist.

## 0.2.1

### Patch Changes

- [#12](https://github.com/marcalexiei/changesets-release-commenter/pull/12) [`e45ec05`](https://github.com/marcalexiei/changesets-release-commenter/commit/e45ec053fc6b418cd6d1446febe59bbc094b9c0a) - Resolve the version commit when the tag names a commit built on top of it. A repository that ships a built artifact commits the build after versioning and tags that child, so the changesets were consumed by an ancestor and nothing was ever found to comment on.

## 0.2.0

### Minor Changes

- [#9](https://github.com/marcalexiei/changesets-release-commenter/pull/9) [`61ed9a1`](https://github.com/marcalexiei/changesets-release-commenter/commit/61ed9a1edf5b8ce601e18bc853c35dfaf644e3ac) - feat: also report packages republished because they depend on a changed one

## 0.1.4

### Patch Changes

- [#7](https://github.com/marcalexiei/changesets-release-commenter/pull/7) [`2b79d33`](https://github.com/marcalexiei/changesets-release-commenter/commit/2b79d33899a45d444117705faa8e3e9c45643dbc) - chore: create a GitHub Release for each version

## 0.1.3

### Patch Changes

- [#5](https://github.com/marcalexiei/changesets-release-commenter/pull/5) [`401d0d3`](https://github.com/marcalexiei/changesets-release-commenter/commit/401d0d3daa437bdf178b5ff811d8e1d2ed4c42af) - chore: build and test with pnpm

## 0.1.2

### Patch Changes

- [`df0a4a9`](https://github.com/marcalexiei/changesets-release-commenter/commit/df0a4a961625efc6821c48cd7dd31d5b3d0a2ca3) - chore: lint with oxlint and format with oxfmt

- [`c824d9f`](https://github.com/marcalexiei/changesets-release-commenter/commit/c824d9fb768b99ac42f7e78d2142deac1d6adde8) - docs: describe the build and release layout

## 0.1.1

### Patch Changes

- [`9c0321f`](https://github.com/marcalexiei/changesets-release-commenter/commit/9c0321f3b2ba38d1e07338d6e05d22d7e17360ce) - fix: fetch tags before resolving the release commit

## 0.1.0

### Minor Changes

- [`c894426`](https://github.com/marcalexiei/changesets-release-commenter/commit/c8944268b72ce82ba235a16a6c8589c4d8927a5f) - feat: comment on the PRs and issues a changesets release shipped
