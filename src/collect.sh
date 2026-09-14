#!/usr/bin/env bash
# Resolve the release commit, then map each PR it shipped to the packages it shipped in.
#
# Two routes to the same answer:
#   changesets — the .changeset/*.md files the release consumed. Their front matter names the
#                packages, and the commit that added each file resolves to a PR. Works with any
#                changelog generator.
#   changelog  — `/pull/N` links in the CHANGELOG.md diff. Zero API calls, but needs a generator
#                that writes them (@changesets/changelog-github).
set -euo pipefail

: "${PUBLISHED_PACKAGES:?required}"
RESOLVE_VIA="${RESOLVE_VIA:-auto}"

log() { printf '%s\n' "$*" >&2; }
emit() { printf 'released=%s\n' "$1" >>"${GITHUB_OUTPUT:-/dev/stdout}"; }

# Single-package repos tag `v<version>`; workspaces tag `<name>@<version>`. Never anchor on HEAD:
# on a workflow_run checkout that follows the default branch, which may have moved past the release.
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

# name -> "name@version", only for packages this run actually published
published_ref() {
  jq -er --arg n "$1" '.[] | select(.name == $n) | .name + "@" + .version' <<<"$PUBLISHED_PACKAGES"
}

add_pair() { # released_json, pr, name@version
  jq -c --arg pr "$2" --arg pv "$3" '.[$pr] = ((.[$pr] // []) + [$pv] | unique)' <<<"$1"
}

git fetch --tags --quiet 2>/dev/null || true

if ! release_sha=$(resolve_release_sha); then
  log "ERROR: no tag from published-packages resolves to a commit."
  log "       Tried <name>@<version> and v<version>. Is the checkout fetch-depth: 0?"
  exit 1
fi

if [[ "$(git rev-list --parents -n1 "$release_sha" | wc -w)" -le 1 ]]; then
  log "Release commit is the repository root — no earlier state to compare against."
  emit '{}'
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

collect_via_changesets() {
  local released='{}' file content names sha pr ref found=0
  while read -r file; do
    [[ -z "$file" ]] && continue
    content=$(git show "${release_sha}~1:${file}" 2>/dev/null) || continue
    # front matter: everything between the first and second `---`
    names=$(awk 'NR==1 && /^---[[:space:]]*$/ {f=1; next} f && /^---[[:space:]]*$/ {exit} f {print}' <<<"$content" \
      | sed -E "s/^[[:space:]]*[\"']?([^\"':]+)[\"']?[[:space:]]*:[[:space:]]*(patch|minor|major)[[:space:]]*$/\1/" \
      | grep -v '^[[:space:]]*$' || true)
    [[ -z "$names" ]] && { log "  ${file}: no packages in front matter"; continue; }

    sha=$(git log --diff-filter=A --format=%H -- "$file" | head -1)
    [[ -z "$sha" ]] && { log "  ${file}: no commit added it"; continue; }
    # gh prints its error body to stdout, so a failed call must not be read as a PR number.
    if ! pr=$(gh api "repos/{owner}/{repo}/commits/${sha}/pulls" --jq '.[0].number' 2>/dev/null); then
      log "  ${file}: commit->PR lookup FAILED for ${sha:0:8}"
      continue
    fi
    if [[ ! "$pr" =~ ^[0-9]+$ ]]; then
      log "  ${file}: ${sha:0:8} has no associated PR"
      continue
    fi

    while read -r name; do
      if ref=$(published_ref "$name"); then
        released=$(add_pair "$released" "$pr" "$ref")
        found=1
      else
        log "  ${file}: ${name} not in published-packages"
      fi
    done <<<"$names"
  done < <(git diff --diff-filter=D --name-only "${release_sha}~1" "$release_sha" -- '.changeset/*.md' \
    | grep -v '/README\.md$' || true)

  [[ "$found" -eq 1 ]] && printf '%s' "$released"
}

collect_via_changelog() {
  local released='{}' path pr dir pkg_json name ref found=0
  while IFS=$'\t' read -r path pr; do
    [[ -z "$path" ]] && continue
    dir=$(dirname "$path")
    pkg_json="package.json"
    [[ "$dir" != "." ]] && pkg_json="${dir}/package.json"
    name=$(git show "${release_sha}:${pkg_json}" 2>/dev/null | jq -er '.name') || continue
    if ref=$(published_ref "$name"); then
      released=$(add_pair "$released" "$pr" "$ref")
      found=1
    fi
  done < <(git diff "${release_sha}~1" "$release_sha" -- '*CHANGELOG.md' | awk '
    /^\+\+\+ b\// { path = substr($2, 3); next }
    /^\+/ && /\/pull\/[0-9]+/ {
      line = $0
      while (match(line, /\/pull\/[0-9]+/)) {
        print path "\t" substr(line, RSTART + 6, RLENGTH - 6)
        line = substr(line, RSTART + RLENGTH)
      }
    }
  ' | sort -u)

  [[ "$found" -eq 1 ]] && printf '%s' "$released"
}

released=''
case "$RESOLVE_VIA" in
  changesets)
    log "Resolving via consumed changeset files:"
    released=$(collect_via_changesets) || true
    ;;
  changelog)
    log "Resolving via changelog PR links:"
    released=$(collect_via_changelog) || true
    ;;
  auto)
    log "Resolving via consumed changeset files:"
    released=$(collect_via_changesets) || true
    if [[ -z "$released" ]]; then
      log "No changesets resolved — falling back to changelog PR links:"
      released=$(collect_via_changelog) || true
    fi
    ;;
  *)
    log "ERROR: resolve-via must be auto, changesets or changelog (got '${RESOLVE_VIA}')."
    exit 1
    ;;
esac

if [[ -z "$released" ]]; then
  log "Nothing resolved — no PRs to comment on."
  emit '{}'
  exit 0
fi

log "resolved:"
jq -r 'to_entries[] | "  PR #\(.key) -> \(.value | join(", "))"' <<<"$released" >&2
emit "$released"
