#!/usr/bin/env bash
# Creates or updates the single preview comment on the current pull request.
# The comment is found by $MARKER, which the body must start with.
# Usage: preview-comment.sh <body>   (needs GH_TOKEN, MARKER, PR_NUMBER)
set -euo pipefail

body=$1
id=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
  --jq ".[] | select(.body | startswith(\"$MARKER\")) | .id" | head -n 1)

if [ -n "$id" ]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body" >/dev/null
else
  gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" -f body="$body" >/dev/null
fi
