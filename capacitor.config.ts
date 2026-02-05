import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.culinaryflow.app',
  appName: 'CulinaryFlow',
  webDir: 'out',
  server: {
    androidScheme: 'https'
  }
};

export default config;
