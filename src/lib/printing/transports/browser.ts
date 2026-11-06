/**
 * Último recurso: imprime HTML pela caixa de impressão do sistema (window.print) e funciona com
 * qualquer impressora instalada. No app desktop do Mesari, o Electron imprime direto no driver
 * do Windows escolhido, sem a caixa de diálogo.
 */
import { BaseTransport, PrinterError, type Availability } from "./base";

export class BrowserPrintTransport extends BaseTransport {
  readonly kind = "navegador" as const;
  override readonly acceptsBytes = false;

  constructor(private purpose: "comanda" | "nota" = "comanda") {
    super();
    this.status = { state: "conectado", deviceName: this.deviceName() };
  }

  private deviceName() {
    return typeof window !== "undefined" && window.mesariDesktop
      ? "Driver do Windows (app desktop)"
      : "Caixa de impressão do navegador";
  }

  isAvailable(): Availability {
    if (typeof document === "undefined") {
      return { available: false, reason: "A impressão pelo navegador precisa da página aberta." };
    }
    return { available: true };
  }

  async connect() {
    this.requireAvailable();
    this.setStatus({ state: "conectado", deviceName: this.deviceName() });
  }

  async write(): Promise<void> {
    throw new PrinterError("A impressão pelo navegador não envia comandos ESC/POS.");
  }

  async disconnect() {
    // Nada a fechar.
  }

  async printHtml(html: string, widthMm: number) {
    this.requireAvailable();
    const desktop = window.mesariDesktop;
    if (desktop) {
      const settings = await desktop.getSettings();
      const result = await desktop.print({
        html,
        printerName: this.purpose === "nota" ? settings.printerNota : settings.printerComanda,
        widthMm,
        copies: 1,
      });
      if (!result.ok) throw new PrinterError("O Windows não concluiu a impressão.", result.error);
      return;
    }
    await printInHiddenFrame(html);
  }
}

export async function printInHiddenFrame(html: string) {
  const frame = document.createElement("iframe");
  let loadTimer: number | undefined;
  let printTimer: number | undefined;
  frame.setAttribute("aria-hidden", "true");
  frame.title = "Impressão Mesari";
  Object.assign(frame.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
    border: "0",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      loadTimer = window.setTimeout(
        () => reject(new PrinterError("Não foi possível abrir a impressão do navegador.")),
        15000,
      );
      frame.onload = () => {
        window.clearTimeout(loadTimer);
        const frameWindow = frame.contentWindow;
        if (!frameWindow) {
          reject(new PrinterError("Não foi possível abrir a impressão do navegador."));
          return;
        }
        // Só chama print() depois que as fontes carregaram: senão a largura muda na hora.
        const fontsReady = frameWindow.document.fonts?.ready ?? Promise.resolve();
        void Promise.resolve(fontsReady)
          .catch(() => undefined)
          .then(() => {
            frameWindow.onafterprint = () => resolve();
            frameWindow.focus();
            printTimer = window.setTimeout(resolve, 60000);
            frameWindow.print();
          })
          .catch(reject);
      };
      frame.srcdoc = html;
      document.body.append(frame);
    });
  } finally {
    window.clearTimeout(loadTimer);
    window.clearTimeout(printTimer);
    frame.remove();
  }
}
