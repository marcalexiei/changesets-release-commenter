---
'changesets-release-commenter': patch
---

Resolve the version commit when the tag names a commit built on top of it. A repository that ships a built artifact commits the build after versioning and tags that child, so the changesets were consumed by an ancestor and nothing was ever found to comment on.
