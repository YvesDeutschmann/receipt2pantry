import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for Meald native apps.
 *
 * Persistent Web Context: Capacitor's default WKWebView (iOS) and Android WebView
 * both persist localStorage, cookies, and DOM Storage across app kills. No extra
 * config required - auth tokens in localStorage will survive when the app is
 * swiped away.
 *
 * Deep Linking (Future): When ready, register pantryapp:// scheme in native
 * projects and use App.addListener('appUrlOpen', ...) to handle return-trips
 * from external browsers.
 *
 * Live dev: Set DEV_SERVER_URL (e.g. npm run cap:dev sets it for `cap sync`).
 * Production builds omit server so the app loads from bundled webDir.
 */
const devServerUrl = process.env.DEV_SERVER_URL;
const serverUrl =
  devServerUrl && devServerUrl.length > 0
    ? devServerUrl.endsWith('/')
      ? devServerUrl
      : `${devServerUrl}/`
    : undefined;

const config: CapacitorConfig = {
  appId: 'com.meald.app',
  appName: 'Meald',
  webDir: 'dist',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: true,
          androidScheme: 'https',
        },
      }
    : {}),
  plugins: {
    CapacitorHttp: { enabled: true },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
    },
  },
};

export default config;
