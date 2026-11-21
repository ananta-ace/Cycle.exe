/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Window {
  cycleDesktop?: {
    isDesktopApp: boolean;
    appName: string;
    platform: string;
  };
}
