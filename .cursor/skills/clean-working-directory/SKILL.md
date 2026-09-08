---
name: clean-working-directory
description: Clean a dirty git working tree by grouping leftover changes into logical packages, creating new branches off origin/master, committing named files, and opening PRs. Use when the user says "clean up the working directory", "clean the working directory", "clean to working path", "you know the drill", or asks to arrange uncommitted work into logical packages, new branches, commits, or PRs.
---

# Clean working directory

Turn leftover uncommitted work into reviewable packages on **new branches off `origin/master`**. Never commit to `master`.

When the user says **you know the drill**, execute. Do not wait for a split-plan approval unless a secret, destructive, or genuinely ambiguous stacking choice is blocking.

## Hard rules

- Never commit to `master` / `main`. Always cut a feature branch first.
- Never add leftover work onto a stale or already-merged feature branch. Park it on new branches from `origin/master`.
- Never discard user work. No `reset --hard`, `clean -fd`, branch deletion, force-push, or history rewrite unless the user explicitly asks. Exception: if commits were just made on local `master` and not pushed, move them onto a feature branch and reset local `master` to `origin/master`.
- Stage only named files or hunks. No `git add .` / `git add -A` on PR branches.
- Keep it simple: **3–6 packages max**. Prefer fewer PRs over a 12-way split.
- Default to independent PRs off `origin/master`. Stack only when the dependency is real.
- If a related open PR already covers a leftover slice, land that slice there instead of opening a duplicate.
- Git in this repo is hidden from the sandbox. Use Shell with `required_permissions: ["all"]`.

## Do not commit

- Secrets and credential files: `.env`, `credentials.json`, `.pem`, `.jks`, `.keystore`, `id_rsa`
- Machine-specific LAN IPs in `frontend/android/app/src/main/res/xml/network_security_config.xml` (scripts inject them at `cap:dev`)
- WIP brand drafts under `frontend/assets/drafts/`
- Local-only debug leftovers that encode a laptop IP

Strip those from diffs before staging. Restore generated local files to disk after the split if the user still needs them.

## 1. Inspect

Run in parallel from the repo root:

```bash
git status -sb
git branch -vv
git log origin/master -10 --format='%s'
git diff --name-status
git diff --cached --name-status
git ls-files --others --exclude-standard
git fetch origin
git log --oneline origin/master..HEAD
gh pr list --limit 20
gh pr view --json url,title,state,baseRefName,number 2>/dev/null || true
```

Read enough of each diff to know **intent**, not just filenames. Flag files that mix concerns (`package.json`, `App.jsx`, `Settings.jsx`, runbooks, `network_security_config.xml`).

Use chat history and agent transcripts to recover intent when the working tree spans multiple sessions.

## 2. Package

Group by **reviewer concern**, not by directory.

For each package record:

- One-line title (becomes commit subject and PR title)
- Named file list
- Mixed files that need hunk splits
- Stack vs independent
- What stays uncommitted

If leftover work is sitting on an unrelated or already-merged branch, say so and move it off.

## 3. Snapshot

Save a recoverable copy **before** moving files:

```bash
git fetch origin
SHA=$(git stash create "pre-split: working tree before PR split")
if [ -n "$SHA" ]; then
  REF="refs/backup/pre-split-$(date +%s)"
  git update-ref "$REF" "$SHA"
  echo "Backup ref: $REF -> $SHA"
fi
```

Then commit a dated backup branch from the current HEAD so files can be copied with `git checkout <backup> -- <paths>`:

```bash
git checkout -b backup/pre-split-YYYYMMDD
```

On the backup branch only, stage the snapshot set (named files, including drafts you will later leave out of PRs). Scan staged names for secrets before committing:

```bash
git diff --cached --name-only | rg -i 'env$|secret|credential|\.pem|\.jks|\.keystore|id_rsa' || true
```

```text
backup: full working tree before YYYY-MM-DD PR split
```

Do not open a PR for the backup branch. Do not delete backup refs or the backup branch unless the user asks.

## 4. Cut packages

For each package:

```bash
git checkout -b <type>/<short-name> origin/master
git checkout backup/pre-split-YYYYMMDD -- <named files>
```

- Branch prefixes: `feat/`, `chore/`, `docs/`
- For mixed files, copy from backup then edit or hunk-stage so only that package's concern remains.
- Strip LAN IPs / secrets from the copy before committing.
- Stage named paths only.
- Commit with a 1–2 sentence imperative message that matches `git log origin/master` (why, not a file dump):

```bash
git commit -m "$(cat <<'EOF'
Harden Android LAN env tooling and isolate the Play AAB API URL.

EOF
)"
```

Stacked packages: create the dependent branch from the foundation branch, not from `origin/master`. Independent packages: always from `origin/master`.

## 5. Push and PR

The drill includes push + PR unless the user said commits only.

```bash
git push -u origin HEAD
gh pr create --base master --title "<commit subject>" --body "$(cat <<'EOF'
## Summary
- <what and why>

## Test plan
- [ ] <concrete check>
EOF
)"
```

For stacked PRs, `--base` the foundation branch and say **Merge the base PR first, then retarget to `master`.**

## 6. Report

Keep it short:

- Table of PR titles and URLs (or branch + commit if no PR)
- Merge order if stacked
- What was left uncommitted and why
- Backup ref / backup branch name
- Current checkout (prefer a real feature branch, not `master` with leftover drafts unless restoring local-only files)

Do not delete the original branch or backup.

## Leftover handling

- Related docs already in an open PR → checkout that branch, merge/rebase `origin/master` if needed, commit the leftover there.
- Unrelated dirty files on a merged branch → they belong on new `origin/master` branches, not that branch.
- After the split, restore local-only files (draft SVGs, LAN-patched XML) onto the working tree **untracked / unstaged** so the user can keep using them.
