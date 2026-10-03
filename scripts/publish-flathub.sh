#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GH_TOKEN:?Set FLATHUB_TOKEN to a token with access to the Flathub app repository.}"
: "${RELEASE_TAG:?Supply a stable release tag.}"
if [[ ! "$RELEASE_TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo 'Only stable releases can be published to Flathub.' >&2
  exit 1
fi
repository=flathub/com.inlark.Inlark
source_directory=$(realpath "${1:-$PWD/apps/desktop/release/flatpak/flathub}")
test -f "$source_directory/com.inlark.Inlark.json"
# A rerun of an older release must not roll Flathub back.
latest=$(gh api repos/inlark/inlark/releases/latest --jq .tag_name)
if [[ "$latest" != "$RELEASE_TAG" ]]; then
  echo "Skipping $RELEASE_TAG: the latest stable release is $latest."
  exit 0
fi
# Cancel older queued updates before they can merge after this release.
old_prs=$(gh pr list --repo "$repository" --state open --json number,headRefName \
  --jq ".[] | select(.headRefName | startswith(\"inlark-v\")) | select(.headRefName != \"inlark-$RELEASE_TAG\") | .number")
if [[ -n "$old_prs" ]]; then
  while IFS= read -r old_pr; do
    gh pr close --repo "$repository" --delete-branch "$old_pr"
  done <<< "$old_prs"
fi
base=$(gh api "repos/$repository" --jq .default_branch)
directory=$(mktemp -d)
trap 'rm -rf "$directory"' EXIT
# Keep the token out of the remote URL and persisted Git configuration.
cat > "$directory/askpass" <<'EOF'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *Password*) printf '%s\n' "$GH_TOKEN" ;;
esac
EOF
chmod 700 "$directory/askpass"
export GIT_ASKPASS="$directory/askpass" GIT_TERMINAL_PROMPT=0
git clone --depth=1 --branch "$base" "https://github.com/$repository.git" "$directory/repository"
cd "$directory/repository"
branch="inlark-$RELEASE_TAG"
git checkout -b "$branch"
for filename in com.inlark.Inlark.json com.inlark.Inlark.desktop com.inlark.Inlark.metainfo.xml com.inlark.Inlark.png inlark.sh flathub.json; do
  cp "$source_directory/$filename" "$filename"
  git add "$filename"
done
if git diff --cached --quiet; then
  echo "$RELEASE_TAG is already packaged on Flathub."
  exit 0
fi
git -c user.name='Inlark releases' -c user.email='hi@inlark.com' commit -m "Update Inlark to ${RELEASE_TAG#v}"
# Reruns replace only this release's automation branch, never the stable branch.
git fetch origin "refs/heads/$branch:refs/remotes/origin/$branch" || true
expected=$(git rev-parse --verify "refs/remotes/origin/$branch" 2>/dev/null || true)
git push "--force-with-lease=refs/heads/$branch:$expected" origin "$branch"
pr=$(gh pr list --repo "$repository" --head "$branch" --base "$base" --state open --json url --jq '.[0].url // empty')
if [[ -z "$pr" ]]; then
  cat > "$directory/body.md" <<EOF
Package [Inlark $RELEASE_TAG](https://github.com/inlark/inlark/releases/tag/$RELEASE_TAG).

The release archive is pinned by SHA-256. This recipe was built and smoke-tested in upstream CI before the GitHub release was published.
EOF
  pr=$(gh pr create --repo "$repository" --base "$base" --head "$branch" \
    --title "Update Inlark to ${RELEASE_TAG#v}" --body-file "$directory/body.md")
fi
echo "$pr"
# GitHub honors Flathub's required checks and reviews. Flathub must first grant
# automerge for this app; otherwise this step fails visibly and leaves the PR.
gh pr merge --repo "$repository" --auto --squash "$pr"
