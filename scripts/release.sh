#!/usr/bin/env bash
set -euo pipefail

release_branch="${RELEASE_BRANCH:-main}"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "$release_branch" ]; then
  echo "Release must run from branch '$release_branch' (current: '$current_branch')."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash changes before releasing."
  exit 1
fi

npm test
if [ "$#" -eq 0 ]; then
  npm version patch
else
  npm version "$@"
fi
version="$(node -p "require('./package.json').version")"
git push origin "$release_branch" --follow-tags
echo "Pushed tag v$version."
echo "GitHub Actions will publish to npm and create the GitHub Release."
