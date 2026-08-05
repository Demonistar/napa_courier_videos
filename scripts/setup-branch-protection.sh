#!/usr/bin/env bash
# setup-branch-protection.sh
#
# Applies branch protection rules to the `main` branch using the GitHub CLI
# (`gh`).  Run this once after cloning the repository or whenever you need to
# re-apply the rules (e.g. after a repository transfer or after the rules are
# accidentally removed).
#
# Prerequisites:
#   • GitHub CLI installed  (https://cli.github.com/)
#   • Authenticated with admin access to the repository:
#       gh auth login
#
# Usage:
#   bash scripts/setup-branch-protection.sh [OWNER/REPO]
#
# The OWNER/REPO argument is optional.  When omitted the script uses the
# remote origin of the current git checkout.
#
# Example:
#   bash scripts/setup-branch-protection.sh my-org/napa-courier

set -euo pipefail

# ── Resolve repository ────────────────────────────────────────────────────────
if [ $# -ge 1 ]; then
  REPO="$1"
else
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
  if [ -z "$REPO" ]; then
    echo "Error: could not detect repository from git remote." >&2
    echo "Usage: $0 OWNER/REPO" >&2
    exit 1
  fi
fi

BRANCH="main"

echo "Applying branch protection to ${REPO}/${BRANCH} …"
echo ""

# ── Apply protection via the GitHub REST API ──────────────────────────────────
#
# Required status check contexts must match the *job name* (`jobs.<id>.name`)
# shown in the GitHub Checks UI, not the workflow filename.
#
# IMPORTANT: only contexts from workflows that run on EVERY pull request (no
# `pull_request.paths` filter at the trigger level) are safe to list as
# required checks.  A path-filtered workflow produces no check-run when the
# filter does not match, which leaves the required context "pending" forever
# and permanently blocks unrelated PRs from merging.
#
# All three gate workflows below run on every PR with internal change
# detection — they exit early with success when no installer-affecting files
# are touched, so they are safe to require here.
#
# Contexts added here:
#
#   "Verify signtool gate rejects an unsigned installer"
#     Job in .github/workflows/test-windows-signing-gate.yml.
#     Runs on every PR — no paths filter.  Detects installer-affecting
#     changes internally and exits early with success when none are found.
#     Fails if the signtool gate in build-windows.yml stops rejecting
#     unsigned .exe files before they reach GitHub Releases.
#
#   "Verify codesign gate rejects an unsigned build"
#     Job in .github/workflows/test-macos-signing-gate.yml.
#     Runs on every PR — no paths filter.  Detects installer-affecting
#     changes internally and exits early with success when none are found.
#     Fails if the codesign gate in build-macos.yml stops rejecting
#     unsigned .app bundles before they reach GitHub Releases.
#
#   "Verify Linux installers build (AppImage + deb)"
#     Job in .github/workflows/test-linux-build-gate.yml.
#     Runs on every PR — no paths filter.  Detects installer-affecting
#     changes internally and exits early with success when none are found.
#     Fails if the linux section in electron-builder.config.js is
#     misconfigured and the expected output files are not produced.
#
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/${REPO}/branches/${BRANCH}/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": [
      "Verify signtool gate rejects an unsigned installer",
      "Verify codesign gate rejects an unsigned build",
      "Verify Linux installers build (AppImage + deb)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null
}
JSON

echo ""
echo "✅ Branch protection applied to ${REPO}/${BRANCH}."
echo ""
echo "Required status checks now enforced:"
echo "  • Verify signtool gate rejects an unsigned installer"
echo "  • Verify codesign gate rejects an unsigned build"
echo "  • Verify Linux installers build (AppImage + deb)"
echo ""
echo "A PR that breaks any signing or build gate cannot be merged until"
echo "the check passes.  PRs that do not touch installer-affecting files"
echo "exit each gate immediately with success."
