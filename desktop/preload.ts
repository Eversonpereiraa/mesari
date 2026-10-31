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

// O preload roda em sandbox e não importa arquivos locais: a regra do WhatsApp
// fica aqui (e é conferida de novo no processo principal).

/** whatsapp://send?phone=55...&text=... — null se o telefone não for válido. */
export function whatsappAppUrl(phone: unknown, text: unknown): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const full = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (!/^55\d{10,11}$/.test(full)) return null;
  return `whatsapp://send?phone=${full}&text=${encodeURIComponent(String(text ?? ""))}`;
}

/** Só o esquema whatsapp: (send) e https://wa.me — nunca uma URL qualquer. */
export function isAllowedWhatsappUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return false;
    if (url.protocol === "whatsapp:") return url.hostname === "send";
    return url.protocol === "https:" && url.hostname === "wa.me";
  } catch {
    return false;
  }
}

export function openWhatsApp(
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = whatsappAppUrl(phone, text);
  if (!url || !isAllowedWhatsappUrl(url)) {
    return Promise.resolve({ ok: false, error: "Telefone inválido para o WhatsApp." });
  }
  return ipcRenderer.invoke("mesari:open-whatsapp", url);
}

contextBridge.exposeInMainWorld("mesariDesktop", {
  isDesktop: true,
  listPrinters: (): Promise<MesariPrinter[]> => ipcRenderer.invoke("mesari:list-printers"),
  print: (request: {
    html: string;
    printerName: string;
    widthMm: number;
    copies: number;
    tipo?: "comanda" | "recibo" | "teste";
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
  openWhatsApp,
});























