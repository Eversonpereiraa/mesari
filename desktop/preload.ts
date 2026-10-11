import { contextBridge, ipcRenderer } from "electron";

export type MesariDesktopSettings = {
  printerNota: string;
  printerComanda: string;
  iniciarComWindows: boolean;
  manterEmSegundoPlano: boolean;
  impedirSuspensao: boolean;
};

export type MesariPrinter = {
  name: string;
  displayName: string;
  isDefault: boolean;
};

contextBridge.exposeInMainWorld("mesariDesktop", {
  isDesktop: true,
  listPrinters: (): Promise<MesariPrinter[]> => ipcRenderer.invoke("mesari:list-printers"),
  print: (request: {
    html: string;
    printerName: string;
    widthMm: number;
    copies: number;
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("mesari:print", request),
  getSettings: (): Promise<MesariDesktopSettings> => ipcRenderer.invoke("mesari:get-settings"),
  setSettings: (settings: Partial<MesariDesktopSettings>): Promise<MesariDesktopSettings> =>
    ipcRenderer.invoke("mesari:set-settings", settings),
  forgetDirectDevice: (type: "serial" | "usb"): Promise<{ ok: true }> =>
    ipcRenderer.invoke("mesari:forget-direct-device", type),
  testPrint: (
    printerName: string,
    widthMm: number,
    restaurantName?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("mesari:test-print", { printerName, widthMm, restaurantName }),
});
