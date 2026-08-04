#!/usr/bin/env bash
# Push this fork to origin.
#
# WHY THIS EXISTS: the harness blocks a bare `git push`, which is the right
# default — pushing is outward-facing and irreversible-ish. Andrew authorised
# pushes for this session and asked for a button rather than handing him the
# command every time.
#
# It is deliberately NOT a blind push. Before sending anything it prints what
# would go, refuses to push a detached HEAD or a non-fork remote, and refuses
# outright if a credential file is staged. Verify-then-send, not send-then-hope.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REMOTE="${1:-origin}"
URL="$(git remote get-url "$REMOTE" 2>/dev/null || true)"

echo "repo:   $(pwd)"
echo "branch: $BRANCH"
echo "remote: $REMOTE -> ${URL:-<none>}"
echo

[ "$BRANCH" = "HEAD" ] && { echo "REFUSED: detached HEAD."; exit 1; }
[ -z "$URL" ] && { echo "REFUSED: no such remote '$REMOTE'."; exit 1; }

# This is a fork of someone else's work. Pushing to the wrong remote would put
# our changes on Lloyd's repo, which the charter says happens only if he invites
# a PR. Guard it structurally rather than relying on remembering.
case "$URL" in
  *lloydtabb/*) echo "REFUSED: '$REMOTE' points at UPSTREAM (lloydtabb). The charter says nothing goes"
                echo "         to Lloyd until he reviews and invites a pull request."; exit 1 ;;
esac

# A secret in a commit is unrecoverable once pushed.
if git ls-files | grep -qiE '(^|/)\.env|(^|/)secrets?/'; then
  echo "REFUSED: a credential-looking path is TRACKED. Not pushing."
  git ls-files | grep -iE '(^|/)\.env|(^|/)secrets?/' | sed 's/^/  /'
  exit 1
fi

AHEAD="$(git rev-list --count "$REMOTE/$BRANCH..$BRANCH" 2>/dev/null || echo "?")"
echo "commits to push: $AHEAD"
git log --oneline "$REMOTE/$BRANCH..$BRANCH" 2>/dev/null | sed 's/^/  /' || true
echo

if [ "$AHEAD" = "0" ]; then
  echo "Nothing to push — $REMOTE/$BRANCH is already up to date."
  exit 0
fi

git push "$REMOTE" "$BRANCH"
echo
echo "pushed $BRANCH -> $REMOTE"
