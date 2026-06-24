import { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'net.shareat.pos',
  appName: 'SHAREAT POS',
  webDir: 'out',
  // No `server.url`: the app loads the locally-bundled static export from
  // `webDir`, so it opens and runs offline. Online-only features call the
  // deployed backend via NEXT_PUBLIC_API_BASE (baked into the export build).
  // NOTE: because the UI is bundled (not loaded from app.shareat.net), any
  // CLIENT-side change reaches devices only via a NEW APK build+install
  // (Actions → Build Android APK), not via a web/App Hosting redeploy.
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  }
};
export default config;
