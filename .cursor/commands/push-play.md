# Push Play Internal

Build a signed Android App Bundle and upload it to Google Play Internal testing.

Follow `.cursor/skills/push-play-internal/SKILL.md`. Run the helper from repo root (do not browser-upload):

```bash
bash .cursor/skills/push-play-internal/scripts/upload-play.sh
```

Shell needs `required_permissions: ["all"]`. Wait for the process to finish.

On success, report versionCode / versionName, AAB path, that Internal (not production) was the track, and that the gradle bump is uncommitted unless the user asked to commit.

Do **not** commit, push, or promote to production unless the user explicitly asks.
