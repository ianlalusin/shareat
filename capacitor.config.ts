import { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'net.shareat.pos',
  appName: 'SharEat POS',
  webDir: 'out',
  // No `server.url`: the app loads the locally-bundled static export from
  // `webDir`, so it opens and runs offline. Online-only features call the
  // deployed backend via NEXT_PUBLIC_API_BASE (baked into the export build).
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  }
};
export default config;
