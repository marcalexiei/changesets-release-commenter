# changesets-release-commenter

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
