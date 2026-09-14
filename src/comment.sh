#!/usr/bin/env bash
# Post one comment per shipped PR, and one per issue those PRs close.
set -euo pipefail

: "${RELEASED:?required}"
: "${GH_REPO:?required}"
COMMENT_ON="${COMMENT_ON:-both}"
MARKER_ID="${MARKER_ID:-changesets-release-commenter}"
DRY_RUN="${DRY_RUN:-false}"

log() { printf '%s\n' "$*" >&2; }

if [[ "$RELEASED" == '{}' || -z "$RELEASED" ]]; then
  log "Nothing released to comment on."
  exit 0
fi

owner="${GH_REPO%%/*}"
repo="${GH_REPO##*/}"

# The marker carries the exact package set, so a re-run of the same release is a no-op while a
# genuinely different release still posts. Keep MARKER_ID distinct from other bots on the thread.
marker_for() { printf '<!-- %s:%s -->' "$MARKER_ID" "$1"; }

already_commented() {
  gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate --jq '.[].body' 2>/dev/null \
    | grep -qF "$2"
}

post() {
  local number="$1" body="$2" marker="$3" kind="$4"
  if already_commented "$number" "$marker"; then
    log "  ${kind} #${number}: already commented, skipping"
    return 0
  fi
  if [[ "$DRY_RUN" == "true" ]]; then
    log "  ${kind} #${number}: DRY RUN, would post:"
    printf '%s\n' "$body" | sed 's/^/    | /' >&2
    return 0
  fi
  # The issues endpoint serves PRs too, so one call covers both kinds.
  if gh api "repos/{owner}/{repo}/issues/${number}/comments" -f body="$body" --silent; then
    log "  ${kind} #${number}: commented"
  else
    log "  ${kind} #${number}: FAILED to comment"
    return 1
  fi
}

render() {
  local lead="$1" packages="$2" marker="$3"
  printf '%s\n\n' "$lead"
  jq -r '.[] | "- `" + . + "`"' <<<"$packages"
  printf '\n%s' "$marker"
}

failures=0

if [[ "$COMMENT_ON" == "both" || "$COMMENT_ON" == "prs" ]]; then
  log "Commenting on PRs:"
  while read -r pr; do
    packages=$(jq -c --arg pr "$pr" '.[$pr]' <<<"$RELEASED")
    marker=$(marker_for "$(jq -r 'join(",")' <<<"$packages")")
    body=$(render '🚀 This pull request has been released in:' "$packages" "$marker")
    post "$pr" "$body" "$marker" "PR" || failures=$((failures + 1))
  done < <(jq -r 'keys[]' <<<"$RELEASED")
fi

if [[ "$COMMENT_ON" == "both" || "$COMMENT_ON" == "issues" ]]; then
  log "Resolving closed issues:"
  # issue number -> { packages, prs }, unioned across every PR that closes it
  issues='{}'
  while read -r pr; do
    packages=$(jq -c --arg pr "$pr" '.[$pr]' <<<"$RELEASED")
    # Never swallow a query failure as "no issues" — that is indistinguishable from success.
    if ! closed=$(gh api graphql \
      -f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){closingIssuesReferences(first:50){nodes{number}}}}}' \
      -F owner="$owner" -F repo="$repo" -F pr="$pr" \
      --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'); then
      log "  PR #${pr}: closingIssuesReferences query FAILED"
      failures=$((failures + 1))
      continue
    fi
    [[ -z "$closed" ]] && { log "  PR #${pr} closes no issues"; continue; }
    while read -r issue; do
      log "  PR #${pr} closes issue #${issue}"
      issues=$(jq -c --arg i "$issue" --arg pr "$pr" --argjson pkgs "$packages" '
        .[$i].packages = ((.[$i].packages // []) + $pkgs | unique)
        | .[$i].prs = ((.[$i].prs // []) + [$pr] | unique)
      ' <<<"$issues")
    done <<<"$closed"
  done < <(jq -r 'keys[]' <<<"$RELEASED")

  if [[ "$issues" != '{}' ]]; then
    log "Commenting on issues:"
    while read -r issue; do
      packages=$(jq -c --arg i "$issue" '.[$i].packages' <<<"$issues")
      prs=$(jq -r --arg i "$issue" '.[$i].prs | map("#" + .) | join(", ")' <<<"$issues")
      marker=$(marker_for "$(jq -r 'join(",")' <<<"$packages")")
      body=$(render "🚀 Fixed by ${prs}, released in:" "$packages" "$marker")
      post "$issue" "$body" "$marker" "issue" || failures=$((failures + 1))
    done < <(jq -r 'keys[]' <<<"$issues")
  fi
fi

[[ "$failures" -gt 0 ]] && { log "${failures} comment(s) failed"; exit 1; }
log "Done."
