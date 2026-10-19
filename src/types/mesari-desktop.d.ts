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

interface Window {
  mesariDesktop?: {
    readonly isDesktop: true;
    listPrinters(): Promise<MesariDesktopPrinter[]>;
    print(request: {
      html: string;
      printerName: string;
      widthMm: number;
      copies: number;
      /** Usado pela impressora virtual (PDF) do desktop para nomear o arquivo. */
      tipo?: "comanda" | "recibo" | "teste";
    }): Promise<{ ok: boolean; error?: string }>;
    getSettings(): Promise<MesariDesktopSettings>;
    setSettings(settings: Partial<MesariDesktopSettings>): Promise<MesariDesktopSettings>;
    forgetDirectDevice(type: "serial" | "usb"): Promise<{ ok: true }>;
    testPrint(
      printerName: string,
      widthMm: number,
      restaurantName?: string,
    ): Promise<{ ok: boolean; error?: string }>;
    /** Abre um link (ex.: wa.me) fora do app. Ausente em versões antigas do desktop. */
    openExternal?(url: string): Promise<{ ok: boolean; error?: string }>;
  };
}
