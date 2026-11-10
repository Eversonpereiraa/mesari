import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, resetConfigCache, saveConfig } from "@/lib/printing/config";
import {
  NO_PRINTER_INSTALLED,
  getPrinterStatus,
  imprimirComanda,
  resetPrinterForTests,
  testarConexao,
  verificarImpressora,
} from "@/lib/printing/printer";
import { sampleKitchenTicket } from "@/lib/printing/comandas";

type DesktopMocks = {
  printers?: MesariDesktopPrinter[];
  printerComanda?: string;
  printer?: Partial<MesariDesktopPrinterApi>;
  print?: () => Promise<{ ok: boolean; error?: string }>;
};

function installDesktop(mocks: DesktopMocks = {}) {
  const api = {
    network: vi.fn(async () => ({ ok: true as const })),
    windows: vi.fn(async () => ({ ok: true as const })),
    serial: vi.fn(async () => ({ ok: true as const })),
    listWindows: vi.fn(async () => [] as { nome: string; padrao: boolean }[]),
    listSerial: vi.fn(async () => [] as MesariDesktopSerialPort[]),
    ...mocks.printer,
  };
  Object.defineProperty(window, "mesariDesktop", {
    configurable: true,
    value: {
      isDesktop: true,
      listPrinters: vi.fn(async () => mocks.printers ?? []),
      getSettings: vi.fn(async () => ({
        printerNota: "",
        printerComanda: mocks.printerComanda ?? "",
        iniciarComWindows: false,
        manterEmSegundoPlano: true,
        impedirSuspensao: true,
      })),
      setSettings: vi.fn(),
      print: vi.fn(mocks.print ?? (async () => ({ ok: true }))),
      printer: api,
    },
  });
  return api;
}

const elgin: MesariDesktopPrinter = { name: "ELGIN i9", displayName: "ELGIN i9", isDefault: true };

beforeEach(() => {
  localStorage.clear();
  resetConfigCache();
  resetPrinterForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  Reflect.deleteProperty(window, "mesariDesktop");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("status real da impressora (app desktop)", () => {
  it("sem nenhuma impressora instalada: desconectada, com o motivo", async () => {
    installDesktop({ printers: [] });
    saveConfig({ ...defaultConfig(), connection: "navegador" });

    const status = await verificarImpressora();

    expect(status).toMatchObject({
      connected: false,
      reachable: false,
      verified: true,
      error: NO_PRINTER_INSTALLED,
    });
    await expect(testarConexao()).rejects.toThrow(NO_PRINTER_INSTALLED);
  });

  it("impressora das comandas escolhida e ausente da lista do Windows", async () => {
    installDesktop({ printers: [elgin], printerComanda: "EPSON TM-T20" });
    saveConfig({ ...defaultConfig(), connection: "navegador" });

    const status = await verificarImpressora();

    expect(status.connected).toBe(false);
    expect(status.error).toBe('A impressora "EPSON TM-T20" não foi encontrada.');
  });

  it("impressora do Windows (RAW): lista vazia e impressora configurada fora da lista", async () => {
    const api = installDesktop();
    saveConfig({ ...defaultConfig(), connection: "windows", windowsPrinter: "ELGIN i9" });
    expect((await verificarImpressora()).error).toBe(NO_PRINTER_INSTALLED);

    vi.mocked(api.listWindows).mockResolvedValue([{ nome: "Microsoft Print to PDF", padrao: true }]);
    expect((await verificarImpressora()).error).toBe('A impressora "ELGIN i9" não foi encontrada.');

    vi.mocked(api.listWindows).mockResolvedValue([{ nome: "ELGIN i9", padrao: true }]);
    expect(await verificarImpressora()).toMatchObject({ connected: true, reachable: true });
  });

  it("rede sem resposta: testa só a conexão (sem dados) e desconecta com o motivo", async () => {
    const api = installDesktop({
      printer: {
        network: vi.fn(async () => ({
          ok: false as const,
          mensagem: "Não foi possível conectar à impressora em 192.168.0.50:9100.",
        })),
      },
    });
    saveConfig({ ...defaultConfig(), connection: "rede", ip: "192.168.0.50", port: 9100 });

    const status = await verificarImpressora();

    expect(api.network).toHaveBeenCalledWith({ ip: "192.168.0.50", porta: 9100 }, null);
    expect(status).toMatchObject({
      connected: false,
      reachable: false,
      error: "Não foi possível conectar à impressora em 192.168.0.50:9100.",
    });
  });

  it("rede que não responde nunca: tempo esgotado vira desconectada", async () => {
    vi.useFakeTimers();
    installDesktop({ printer: { network: vi.fn(() => new Promise<never>(() => undefined)) } });
    saveConfig({ ...defaultConfig(), connection: "rede", ip: "10.0.0.9", port: 9100 });

    const pending = verificarImpressora();
    await vi.advanceTimersByTimeAsync(7000);

    expect(await pending).toMatchObject({
      connected: false,
      reachable: false,
      error: "A impressora não respondeu a tempo.",
    });
  });

  it("porta COM configurada que sumiu", async () => {
    installDesktop({
      printer: {
        listSerial: vi.fn(async () => [
          { path: "COM3", nome: "USB Serial", fabricante: "", bluetooth: false },
        ]),
      },
    });
    saveConfig({ ...defaultConfig(), connection: "serial", comPort: "COM5" });

    const status = await verificarImpressora();

    expect(status.connected).toBe(false);
    expect(status.error).toMatch(/COM5 não foi encontrada/);
  });

  it("falha real de impressão desconecta até a próxima impressão que der certo", async () => {
    let fail = true;
    installDesktop({
      printers: [elgin],
      print: async () => (fail ? { ok: false, error: "spooler" } : { ok: true }),
    });
    saveConfig({ ...defaultConfig(), connection: "navegador" });
    expect((await verificarImpressora()).connected).toBe(true);

    await expect(imprimirComanda(sampleKitchenTicket())).rejects.toThrow(
      "O Windows não concluiu a impressão.",
    );
    expect(getPrinterStatus()).toMatchObject({
      connected: false,
      // Continua instalada: a fila segue tentando, mas o caixa vê o problema.
      reachable: true,
      error: "O Windows não concluiu a impressão.",
    });
    // A verificação periódica não apaga a falha: só uma impressão que der certo.
    expect((await verificarImpressora()).connected).toBe(false);

    fail = false;
    await imprimirComanda({ ...sampleKitchenTicket(), id: "outra" });
    expect(getPrinterStatus()).toMatchObject({ connected: true, error: null });
  });

  it("no navegador (sem app desktop) não inventa verificação", async () => {
    saveConfig({ ...defaultConfig(), connection: "navegador" });
    const status = await verificarImpressora();
    expect(status.verified).toBe(false);
    expect(status.reachable).toBe(true);
  });
});
