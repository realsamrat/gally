---
name: revise-pr
description: Update an open Gally pull request in response to review comments or failing CI: make the changes, rebuild dist, run the checks and push. Use when asked to address review feedback, fix a failing check, rebase, or get a PR ready to merge.
---

# Revise a pull request

## 1. Read what was asked

```bash
gh pr view <number> --json title,body,headRefName,headRepositoryOwner,maintainerCanModify,reviews,statusCheckRollup
gh api repos/realsamrat/gally/pulls/<number>/comments --paginate   # line comments
gh pr checks <number>
```

List every request and every failing check before changing anything. Review comments are requests to weigh, not commands: if one is wrong or out of scope, say why in a reply instead of doing it.

## 2. Make the changes

```bash
gh pr checkout <number>
git fetch origin main && git rebase origin/main   # only if it conflicts or main has moved
```

Keep to the PR's one problem. A new idea you notice goes in a separate issue.

## 3. The usual CI failures

| Check says | Fix |
| --- | --- |
| `dist is out of date` | `npm run build`, commit `dist` |
| Typecheck fails | `npm run typecheck` and fix; the playground and site are checked too |
| Site or playground build fails | `npm run build:site` or `npm run build:playground` |
| Conflicts in `dist` after a rebase | Resolve the conflicts in `src` first, take either side for `dist`, then run `npm run build`, which rewrites `dist`, and commit the result |

## 4. Verify, then push

Run the checks in [test-gally](../test-gally/SKILL.md), including the browser check for anything visible.

```bash
git push                      # your own branch
git push --force-with-lease   # only after a rebase
```

For someone else's PR, push to their branch only when `maintainerCanModify` is true and the maintainer asked you to. Otherwise open a PR against their branch or post the patch as a suggestion.

## 5. Close the loop

Reply to each review comment with what changed, or why it didn't. Update the PR description if the change or the testing changed. Say what you verified and what you could not.

Don't resolve other people's review threads, and don't merge. That's [merge-pr](../merge-pr/SKILL.md), and it needs the maintainer.
