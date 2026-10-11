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
    }): Promise<{ ok: boolean; error?: string }>;
    getSettings(): Promise<MesariDesktopSettings>;
    setSettings(settings: Partial<MesariDesktopSettings>): Promise<MesariDesktopSettings>;
    testPrint(
      printerName: string,
      widthMm: number,
      restaurantName?: string,
    ): Promise<{ ok: boolean; error?: string }>;
  };
}
