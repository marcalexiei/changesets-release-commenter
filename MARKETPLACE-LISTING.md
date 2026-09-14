# Marketplace listing copy

Review draft for publishing `v0.1.4`. Not part of the repo — delete once used.

## Categories

| Slot      | Category           | Why                                                                                                                                                                                   |
| --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary   | Publishing         | Runs as part of the release flow and is triggered by a publish. Puts the action next to `changesets/action`, which is what people browsing release automation are already looking at. |
| Secondary | Project management | What it actually does is close the loop on issues and PRs: whoever filed the request learns their fix shipped, and in which package.                                                  |

Deliberately avoided: **Continuous integration** (true, but so broad the listing
disappears among thousands) and **Utilities** (tells a browser nothing).

## Release title

```
v0.1.4
```

Plain tag is the convention — the Marketplace shows the action name above it anyway.

## Release description

````markdown
Comments on the pull requests a Changesets release shipped, and on the issues
those PRs close — naming which package at which version each one shipped in.

> 🚀 Fixed by #433, released in:
>
> - `eslint-plugin-zod-mini@1.9.1`
> - `eslint-plugin-zod@4.12.1`

Existing tools treat a release as one whole-repo event, so the most they can say
is "released". Changesets versions each package separately, so this reads the
changesets a release consumed and reports the version that actually matters to
the person who asked.

- Works with monorepos and single-package repos
- Re-running a release posts nothing new
- Each version links to its release page
- No changelog generator required

```yaml
- name: Comment on shipped PRs and issues
  if: steps.changesets.outputs.published == 'true'
  continue-on-error: true
  uses: marcalexiei/changesets-release-commenter@v0
  with:
    published-packages: ${{ steps.changesets.outputs.published-packages }}
```

**0.x** — usable and tested end to end, but the inputs may still move before 1.0.
````

## Notes

- The **card** on the Marketplace uses `action.yml`'s `description`, not the release
  body: _"Comment on the PRs and issues shipped by a Changesets release, naming the
  packages each one shipped in."_ — ~103 characters, fits without truncation.
- The `0.x` caveat is deliberate, since the listing is pre-1.0: better that early
  adopters are told the inputs may move than discover a rename the hard way.
- Publishing also needs the Marketplace Developer Agreement accepted once per account.
