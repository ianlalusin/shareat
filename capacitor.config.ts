import { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'net.shareat.pos',
  appName: 'SharEat POS',
  webDir: 'out',
  server: {
    url: 'https://poskds.shareat.net',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  }
};
export default config;
