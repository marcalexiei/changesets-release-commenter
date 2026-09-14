---
'changesets-release-commenter': patch
---

Link each version to the tag the repository actually carries. The href was built from `<name>@<version>`, so every comment in a single-package repository — tagged `v<version>` — pointed at a release that does not exist.
