# Contributing

```bash
pnpm install
pnpm typecheck
pnpm test          # unit tests; the playground integration test needs that repo checked out
pnpm lint:js       # oxlint; `pnpm lint:js:fix` applies what it can
pnpm format:check  # oxfmt; `pnpm format` rewrites
pnpm build         # rolldown -> dist/index.js
```

## Changesets

Every user-facing change needs a changeset — this action reads them to attribute a release, so a
missing one means the PR goes unmentioned in its own comments.

```bash
pnpm changeset
```

## Releasing

`dist/` is gitignored and never lives on `main`. A release commits it on a detached commit, tags
`vX.Y.Z`, and force-moves the `vX` branch at it — so the major ref always points at a built bundle. That is
the same shape `changesets/action` uses to release itself.

`pnpm bump` and `pnpm release` drive that from CI; neither is meant to be run by hand on a clone.
