# App Icons and Splash Screens

This folder contains source assets for `@capacitor/assets`, which generates every size for iOS and Android.

## Source files

| File | Role |
|------|------|
| `meald-logo-source.png` | Authoritative fork-M mark (1024×1024, terracotta + transparency or cream). Commit this when the brand updates. |
| `icon.png` | Opaque icon canvas (cream + mark). Passed to `@capacitor/assets` as the **logo** input for iOS icons and Android legacy launcher icons. |
| `icon-foreground.png` | Transparent adaptive-icon foreground (~62% safe zone). |
| `icon-background.png` | Solid cream adaptive background. |
| `splash.png` | Light splash master (2732×2732, cream + terracotta mark). |
| `splash-dark.png` | Dark splash master (2732×2732, navy + cream mark). |

`icon.png` through `splash-dark.png` are **regenerated** by `node scripts/generate-assets.js` from `meald-logo-source.png`—do not hand-edit those outputs.

## Regenerate native assets

From `frontend/`:

`npm run assets:generate` runs `generate-assets.js`, `@capacitor/assets`, then `scripts/ios-expand-app-icons.js` (full iPhone + iPad AppIcon set required for App Store when deployment target is below iOS 17).

```bash
npm run assets:generate
npm run cap:sync
```

Brand colors passed to the generator: cream `#F5F0E8`, navy `#1A1A2E`, terracotta mark as in the source logo.

See [@capacitor/assets](https://github.com/ionic-team/capacitor-assets) for advanced options.
