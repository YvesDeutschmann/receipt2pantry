# App Icons and Splash Screens

This folder contains source assets for native app icons and splash screens.

## Current Assets

- **logo.png** (1024x1024) - Placeholder logo used by `@capacitor/assets` to generate all platform-specific sizes.

## Replacing with Final Assets

1. Replace `logo.png` with your final 1024x1024 app icon (or add `logo-dark.png` for dark mode).
2. Run: `npx capacitor-assets generate --iconBackgroundColor '#ffffff' --splashBackgroundColor '#ffffff' --ios --android`
3. Run: `npm run cap:sync` to copy updated assets to native projects.

## Alternative: Advanced Mode

For full control, use the advanced mode with separate files:
- `icon-only.png` (min 1024x1024)
- `icon-foreground.png`, `icon-background.png` (min 1024x1024)
- `splash.png`, `splash-dark.png` (min 2732x2732)

See [@capacitor/assets](https://github.com/ionic-team/capacitor-assets) for details.
