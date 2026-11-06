import type { CapacitorConfig } from "@capacitor/cli";

/**
 * App Android do Mesari. O Mesari é renderizado no servidor (TanStack Start), então o app abre
 * o endereço publicado dentro do WebView nativo; os plugins de TCP e Bluetooth ficam
 * disponíveis para a página. Para apontar para outro endereço, defina MESARI_APP_URL antes do
 * `npx cap sync`.
 */
const appUrl = process.env["MESARI_APP_URL"] ?? "https://design-driven-orders.vercel.app";

const config: CapacitorConfig = {
  appId: "app.mesari.pdv",
  appName: "Mesari",
  webDir: "capacitor-www",
  server: {
    url: appUrl,
    androidScheme: "https",
    errorPath: "index.html",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
