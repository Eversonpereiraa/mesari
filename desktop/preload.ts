/**
 * Ponte entre o Mesari (renderer isolado) e o sistema. Só funções específicas: nada de expor o
 * ipcRenderer inteiro.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Outcome = { ok: true } | { ok: false; mensagem: string; detalhe?: string };

function subscribe<T>(channel: string, listener: (payload: T) => void) {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const bytes = (data?: Uint8Array | null) => (data ? new Uint8Array(data) : null);

contextBridge.exposeInMainWorld("mesariDesktop", {
  isDesktop: true,
  getAppInfo: (): Promise<{ versao: string; empacotado: boolean }> =>
    ipcRenderer.invoke("mesari:app-info"),

  // Configurações do aplicativo e impressão pelo driver (modo "Navegador").
  getSettings: () => ipcRenderer.invoke("mesari:get-settings"),
  setSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke("mesari:set-settings", settings),
  listPrinters: () => ipcRenderer.invoke("mesari:list-printers"),
  print: (request: { html: string; printerName: string; widthMm: number; copies: number }) =>
    ipcRenderer.invoke("mesari:print", request),

  // Impressão nativa ESC/POS. Sem `data`, só testa a conexão.
  printer: {
    network: (target: { ip: string; porta: number }, data?: Uint8Array | null): Promise<Outcome> =>
      ipcRenderer.invoke("mesari:printer-network", target, bytes(data)),
    windows: (target: { impressora: string }, data?: Uint8Array | null): Promise<Outcome> =>
      ipcRenderer.invoke("mesari:printer-windows", target, bytes(data)),
    serial: (target: { com: string; baud: number }, data?: Uint8Array | null): Promise<Outcome> =>
      ipcRenderer.invoke("mesari:printer-serial", target, bytes(data)),
    listWindows: (): Promise<{ nome: string; padrao: boolean }[]> =>
      ipcRenderer.invoke("mesari:printer-list-windows"),
    listSerial: (): Promise<{ path: string; nome: string; fabricante: string; bluetooth: boolean }[]> =>
      ipcRenderer.invoke("mesari:printer-list-serial"),
  },

  // Seletor de dispositivo BLE (Web Bluetooth).
  ble: {
    onDevices: (listener: (devices: { id: string; nome: string }[]) => void) =>
      subscribe("mesari:ble-devices", listener),
    select: (deviceId: string | null) => ipcRenderer.invoke("mesari:ble-select", deviceId),
  },

  // Atualização automática: o app só avisa; quem baixa e reinicia é o usuário.
  updates: {
    onReady: (listener: (info: { versao: string }) => void) =>
      subscribe("mesari:update-ready", listener),
    status: (): Promise<{ versao: string | null }> => ipcRenderer.invoke("mesari:update-status"),
    install: (): Promise<boolean> => ipcRenderer.invoke("mesari:update-install"),
    // App 1.2+: estado completo (disponível → baixando → pronta) e download sob demanda.
    onState: (listener: (state: unknown) => void) => subscribe("mesari:update-state", listener),
    state: (): Promise<unknown> => ipcRenderer.invoke("mesari:update-state"),
    download: (): Promise<boolean> => ipcRenderer.invoke("mesari:update-download"),
  },
});
