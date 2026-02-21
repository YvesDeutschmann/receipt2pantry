import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for GrocerySync native apps.
 *
 * Persistent Web Context: Capacitor's default WKWebView (iOS) and Android WebView
 * both persist localStorage, cookies, and DOM Storage across app kills. No extra
 * config required - auth tokens in localStorage will survive when the app is
 * swiped away.
 *
 * Deep Linking (Future): When ready, register pantryapp:// scheme in native
 * projects and use App.addListener('appUrlOpen', ...) to handle return-trips
 * from external browsers.
 */
const config: CapacitorConfig = {
  appId: 'com.grocerysync.app',
  appName: 'GrocerySync',
  webDir: 'dist',
  server: {
    // For local dev, point to the Vite dev server so live-reload works.
    // Uncomment and set your machine's IP (see MOBILE_SETUP.md):
    url: 'http://192.168.50.30:5173/',
    cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
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
