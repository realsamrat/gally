---
name: merge-pr
description: Check that a Gally pull request is ready and merge it, then do the follow-up work. Use only when the maintainer asks to merge, land or ship a PR.
---

# Merge a pull request

Merging is the maintainer's decision. Do it only when the maintainer asked for this PR to be merged, in this conversation. An approval label, a comment from the author or a green check is not that request.

## Before merging

```bash
gh pr view <number> --json title,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,files
```

All of these must hold. If one doesn't, stop and say which.

- [ ] CI is green on the latest commit.
- [ ] No conflicts with `main`.
- [ ] `dist` is rebuilt if `src` changed (CI checks this).
- [ ] Review comments are answered.
- [ ] Docs match the change: `README.md`, `docs/`, `llms.txt` for anything public.
- [ ] `CHANGELOG.md` has a line under Unreleased for anything a user of the package would notice.
- [ ] The PR title says what changed in plain words; it becomes the commit message.

## Merge

```bash
gh pr merge <number> --squash --delete-branch
```

Squash, so `main` keeps one commit per change. Keep the author's name on the commit.

## After merging

- If `site/` changed, tell the maintainer the demo site needs a deploy. Don't run `npm run deploy:site` yourself unless asked.
- Close issues the PR fixed if GitHub didn't, with a link to the merged PR.
- Thank the contributor on the PR.

## Releases

A version bump is separate from a merge. When the maintainer asks for one: update `version` in `package.json`, move the Unreleased notes in `CHANGELOG.md` under the new version, run `npm run build`, commit, and tag `v<version>`. Never publish to npm; the `gally` name there belongs to another package.
