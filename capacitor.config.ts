import type { CapacitorConfig } from '@capacitor/cli';

/**
 * iOS app shell (docs/IOS_TESTFLIGHT.md): the Vite build in dist/ runs inside a WKWebView, fully offline.
 * Bundle ID and name match App Store Connect.
 */
const config: CapacitorConfig = {
  appId: 'com.ncstatepack16.machzero',
  appName: 'MachZero',
  webDir: 'dist',
  backgroundColor: '#05030f',
  ios: {
    contentInset: 'never',
    // The game owns every gesture: no rubber-band scrolling or link previews.
    scrollEnabled: false,
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
  },
  plugins: {
    // Hides the status bar and auto-hides the home indicator.
    SystemBars: { hidden: true },
  },
};

export default config;
