import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sillonphane.running',
  appName: 'Sillonphane-Running',
  webDir: 'dist',
  android: {
    // Sans ça, le plugin background-geolocation cesse de transmettre les positions
    // au bout de ~5 min en arrière-plan (pont JS suspendu) — voir son README.
    useLegacyBridge: true,
  },
};

export default config;
