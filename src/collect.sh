#!/usr/bin/env bash
# Resolve the release commit, then map each PR in its changelog diff to the packages it shipped in.
set -euo pipefail

: "${PUBLISHED_PACKAGES:?required}"

log() { printf '%s\n' "$*" >&2; }

# The release commit is whatever a tag from this publish points at: never HEAD, which on a
# workflow_run checkout follows the default branch and may have moved on.
resolve_release_sha() {
  local name version sha
  while read -r name version; do
    for tag in "${name}@${version}" "v${version}"; do
      if sha=$(git rev-list -n1 "$tag" 2>/dev/null); then
        log "release commit ${sha} (from tag ${tag})"
        printf '%s' "$sha"
        return 0
      fi
    done
  done < <(jq -r '.[] | .name + " " + .version' <<<"$PUBLISHED_PACKAGES")
  return 1
}

git fetch --tags --quiet 2>/dev/null || true

if ! release_sha=$(resolve_release_sha); then
  log "ERROR: no tag from published-packages resolves to a commit."
  log "       Tried <name>@<version> and v<version>. Is the checkout fetch-depth: 0?"
  exit 1
fi

emit_empty() { printf 'released={}\n' >>"${GITHUB_OUTPUT:-/dev/stdout}"; }

# A root commit has nothing before it: that is a repository's first release, not an error.
if [[ "$(git rev-list --parents -n1 "$release_sha" | wc -w)" -le 1 ]]; then
  log "Release commit is the repository root — no earlier changelog to diff against."
  emit_empty
  exit 0
fi

if ! git cat-file -e "${release_sha}~1" 2>/dev/null; then
  if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
    log "ERROR: ${release_sha}~1 is missing and the clone is shallow. Use fetch-depth: 0."
  else
    log "ERROR: ${release_sha}~1 is missing from a complete clone."
  fi
  exit 1
fi

# `+++ b/<dir>/CHANGELOG.md` headers attribute each `/pull/N` line to a package.
# Dependency-bump lines carry only commit links, never /pull/, so they exclude themselves.
pairs=$(git diff "${release_sha}~1" "${release_sha}" -- '*CHANGELOG.md' | awk '
  /^\+\+\+ b\// { path = substr($2, 3); next }
  /^\+/ && /\/pull\/[0-9]+/ {
    line = $0
    while (match(line, /\/pull\/[0-9]+/)) {
      print path "\t" substr(line, RSTART + 6, RLENGTH - 6)
      line = substr(line, RSTART + RLENGTH)
    }
  }
' | sort -u)

if [[ -z "$pairs" ]]; then
  log "No PR links in the changelog diff — nothing to comment on."
  emit_empty
  exit 0
fi

# Resolve each changelog path to its package name as of the release commit, then keep only
# packages this run actually published and attach their versions.
released='{}'
while IFS=$'\t' read -r path pr; do
  pkg_json="$(dirname "$path")/package.json"
  if ! name=$(git show "${release_sha}:${pkg_json}" 2>/dev/null | jq -er '.name'); then
    log "skip ${path}: no package name at ${pkg_json}"
    continue
  fi
  if ! version=$(jq -er --arg n "$name" '.[] | select(.name == $n) | .version' <<<"$PUBLISHED_PACKAGES"); then
    log "skip ${name}: not in published-packages"
    continue
  fi
  released=$(jq -c --arg pr "$pr" --arg pv "${name}@${version}" '
    .[$pr] = ((.[$pr] // []) + [$pv] | unique)
  ' <<<"$released")
done <<<"$pairs"

log "resolved:"
jq -r 'to_entries[] | "  PR #\(.key) -> \(.value | join(", "))"' <<<"$released" >&2

printf 'released=%s\n' "$released" >>"${GITHUB_OUTPUT:-/dev/stdout}"
