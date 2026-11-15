---
'changesets-release-commenter': patch
---

fix: retry GitHub API calls after a rate limit or a transient error, except creating a comment, which a retry could post twice
