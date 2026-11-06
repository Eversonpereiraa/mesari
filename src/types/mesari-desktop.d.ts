type MesariDesktopPrinter = {
  name: string;
  displayName: string;
  isDefault: boolean;
};

type MesariDesktopSettings = {
  printerNota: string;
  printerComanda: string;
  iniciarComWindows: boolean;
  manterEmSegundoPlano: boolean;
  impedirSuspensao: boolean;
};

type MesariDesktopOutcome = { ok: true } | { ok: false; mensagem: string; detalhe?: string };

type MesariDesktopSerialPort = {
  path: string;
  nome: string;
  fabricante: string;
  bluetooth: boolean;
};

/** Funções nativas do app desktop (Electron 1.1+). Ausentes no app 1.0.x e no navegador. */
type MesariDesktopPrinterApi = {
  network(
    target: { ip: string; porta: number },
    data?: Uint8Array | null,
  ): Promise<MesariDesktopOutcome>;
  windows(target: { impressora: string }, data?: Uint8Array | null): Promise<MesariDesktopOutcome>;
  serial(
    target: { com: string; baud: number },
    data?: Uint8Array | null,
  ): Promise<MesariDesktopOutcome>;
  listWindows(): Promise<{ nome: string; padrao: boolean }[]>;
  listSerial(): Promise<MesariDesktopSerialPort[]>;
};

interface Window {
  mesariDesktop?: {
    readonly isDesktop: true;
    getAppInfo?(): Promise<{ versao: string; empacotado: boolean }>;
    listPrinters(): Promise<MesariDesktopPrinter[]>;
    print(request: {
      html: string;
      printerName: string;
      widthMm: number;
      copies: number;
    }): Promise<{ ok: boolean; error?: string }>;
    getSettings(): Promise<MesariDesktopSettings>;
    setSettings(settings: Partial<MesariDesktopSettings>): Promise<MesariDesktopSettings>;
    printer?: MesariDesktopPrinterApi;
    ble?: {
      onDevices(listener: (devices: { id: string; nome: string }[]) => void): () => void;
      select(deviceId: string | null): Promise<boolean>;
    };
    updates?: {
      onReady(listener: (info: { versao: string }) => void): () => void;
      status(): Promise<{ versao: string | null }>;
      install(): Promise<boolean>;
    };
  };
}
