import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectPrinter,
  connectUsbPrinter,
  disconnectPrinter,
  getDefaultPrintSettings,
  getPrinterStatus,
  getPrintSettings,
  printReceipt,
  printReceiptOnce,
  printKitchenTicket,
  printTestPage,
  resetSimulatedPaper,
  savePrintSettings,
  setDemoSimulation,
  type KitchenTicket,
  type PrintReceipt,
  type PrintSettings,
} from "@/lib/printing";
import type { PrintRestaurant } from "@/lib/printing";
import {
  clearVirtualJobs,
  getVirtualJobs,
  resetVirtualPrinterForTests,
} from "@/lib/virtual-printer";

const restaurant: PrintRestaurant = {
  name: "Mesari",
  address: "Rua de teste",
  phone: "",
  cnpj: "",
  instagram: "",
};

function sampleReceipt(id = "sale-1"): PrintReceipt {
  return {
    id,
    at: new Date("2025-01-01T12:00:00").getTime(),
    table: 3,
    saleNumber: 8,
    lines: [
      {
        id: "item-1",
        name: "Café",
        qty: 2,
        price: 5,
        note: "Sem açúcar",
        waiter: "Ana",
      },
    ],
    subtotal: 10,
    serviceCharge: 1,
    total: 11,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serial");
  Reflect.deleteProperty(navigator, "usb");
  Reflect.deleteProperty(window, "mesariDesktop");
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const type = url.endsWith(".woff2") ? "font/woff2" : "image/png";
      return {
        ok: true,
        blob: async () => ({
          type,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }),
      };
    }),
  );
});

describe("configurações da impressora", () => {
  it("mantém estável o snapshot do driver Windows no desktop", () => {
    Object.defineProperty(window, "mesariDesktop", {
      configurable: true,
      value: { isDesktop: true },
    });

    const first = getPrinterStatus();

    expect(first).toMatchObject({
      supported: true,
      connected: true,
      name: "Windows",
      error: null,
    });
    expect(getPrinterStatus()).toBe(first);
  });

  it("persiste localmente e aplica os valores padrão às preferências ausentes", () => {
    const settings: PrintSettings = {
      ...getDefaultPrintSettings(),
      paperWidth: 58,
      copies: 2,
      printerMode: "browser",
    };
    savePrintSettings(settings);

    expect(getPrintSettings()).toMatchObject({
      paperWidth: 58,
      copies: 2,
      printerMode: "browser",
      autoPrintOnClose: true,
      showKitchenPrices: true,
    });
  });

  it("apresenta o motivo quando a conexão direta não está disponível", async () => {
    await expect(connectPrinter()).rejects.toThrow(
      "Seu navegador não oferece suporte à conexão direta da impressora.",
    );
  });

  it("usa a fila de impressão do desktop para notas e comandas sem tentar USB/serial", async () => {
    const nativePrint = vi.fn().mockResolvedValue({ ok: true });
    Object.defineProperty(window, "mesariDesktop", {
      configurable: true,
      value: {
        isDesktop: true,
        print: nativePrint,
        getSettings: vi.fn().mockResolvedValue({
          printerNota: "Elgin Nota",
          printerComanda: "Elgin Cozinha",
          iniciarComWindows: true,
          manterEmSegundoPlano: true,
          impedirSuspensao: true,
        }),
      },
    });

    const receiptResult = await printReceipt(sampleReceipt(), restaurant, {
      ...getDefaultPrintSettings(),
      paperWidth: 80,
      copies: 2,
    });
    const ticket: KitchenTicket = {
      id: "kitchen-1",
      number: 7,
      table: 4,
      sector: "cozinha",
      waiter: "Ana",
      additional: false,
      createdAt: Date.now(),
      items: [{ product: "Café", quantity: 1, note: "" }],
    };
    const ticketResult = await printKitchenTicket(ticket, getDefaultPrintSettings(), false);

    expect(receiptResult).toEqual({ method: "desktop" });
    expect(ticketResult).toEqual({ method: "desktop" });
    expect(nativePrint).toHaveBeenCalledTimes(3);
    expect(nativePrint.mock.calls[0]?.[0]).toMatchObject({
      printerName: "Elgin Nota",
      widthMm: 80,
      copies: 1,
    });
    expect(nativePrint.mock.calls[0]?.[0].html).toContain("receipt-paper");
    expect(nativePrint.mock.calls[0]?.[0].html).not.toContain("2ª VIA");
    expect(nativePrint.mock.calls[1]?.[0].html).toContain("2ª VIA · DATA ORIGINAL");
    expect(nativePrint.mock.calls[1]?.[0]).toMatchObject({
      printerName: "Elgin Nota",
      widthMm: 80,
      copies: 1,
    });
    expect(nativePrint.mock.calls[2]?.[0]).toMatchObject({
      printerName: "Elgin Cozinha",
      widthMm: 58,
      copies: 1,
    });
    expect(nativePrint.mock.calls[2]?.[0].html).toContain("PEDIDO #7");

    nativePrint.mockResolvedValueOnce({ ok: false, error: "Falha do driver" });
    await expect(printKitchenTicket(ticket, getDefaultPrintSettings(), false)).rejects.toThrow(
      "Falha do driver",
    );
  });

  it("remove o iframe quando a impressão pelo navegador falha", async () => {
    let frameElement: HTMLIFrameElement | undefined;
    let removeFrame: ReturnType<typeof vi.spyOn> | undefined;
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      frameElement = frame;
      removeFrame = vi.spyOn(frame, "remove");
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: {
          focus: vi.fn(),
          print: vi.fn(() => {
            throw new Error("Falha na impressão");
          }),
        },
      });
      frame.onload?.(new Event("load"));
    });

    await expect(
      printReceipt(sampleReceipt(), restaurant, {
        ...getDefaultPrintSettings(),
        printerMode: "browser",
      }),
    ).rejects.toThrow("Falha na impressão");

    expect(frameElement?.style.pointerEvents).toBe("none");
    expect(frameElement?.style.zIndex).toBe("-1");
    expect(removeFrame).toHaveBeenCalledOnce();
    append.mockRestore();
  });

  it("usa o mesmo HTML do visualizador e evita duplicar a impressão automática", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });
    const receipt = sampleReceipt();
    await Promise.all([
      printReceiptOnce(receipt, restaurant),
      printReceiptOnce(receipt, restaurant),
    ]);

    expect(printedHtml).toContain("receipt-paper");
    expect(printedHtml).toContain("CONTA DE CONSUMO");
    expect(printed).toHaveBeenCalledOnce();
    append.mockRestore();
  });

  it("conecta pela interface USB classe 7 e envia ESC/POS em blocos de 512 bytes", async () => {
    const transfers: Uint8Array[] = [];
    const device = {
      vendorId: 1234,
      productId: 5678,
      productName: "Impressora USB",
      configuration: null as null | {
        interfaces: {
          interfaceNumber: number;
          alternate: {
            interfaceClass: number;
            endpoints: { direction: "out"; type: string; endpointNumber: number }[];
          };
        }[];
      },
      opened: false,
      open: async () => {
        device.opened = true;
      },
      close: async () => {
        device.opened = false;
      },
      selectConfiguration: async () => {
        device.configuration = {
          interfaces: [
            {
              interfaceNumber: 0,
              alternate: {
                interfaceClass: 7,
                endpoints: [{ direction: "out", type: "bulk", endpointNumber: 1 }],
              },
            },
          ],
        };
      },
      claimInterface: vi.fn(async () => {}),
      transferOut: vi.fn(async (_endpoint: number, data: BufferSource) => {
        transfers.push(new Uint8Array(data as ArrayBuffer));
        return { status: "ok" };
      }),
    };
    const usb = {
      getDevices: vi.fn(async () => [device]),
      requestDevice: vi.fn(async (options: { filters: { classCode?: number }[] }) => {
        expect(options.filters).toEqual([{ classCode: 7 }]);
        return device;
      }),
      addEventListener: vi.fn(),
    };
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "usb", { configurable: true, value: usb });

    await connectUsbPrinter();
    await printKitchenTicket(
      {
        id: "usb-ticket",
        number: 7,
        table: 5,
        sector: "cozinha",
        waiter: "Ana",
        additional: false,
        createdAt: Date.now(),
        items: Array.from({ length: 30 }, (_, index) => ({
          product: `Prato quente com acompanhamentos variados ${index + 1}`,
          quantity: 1,
          note: "",
        })),
      },
      getDefaultPrintSettings(),
      false,
    );

    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.every((chunk) => chunk.length <= 512)).toBe(true);
    await disconnectPrinter();
  });

  it("usa a prévia de impressão do navegador como método alternativo", async () => {
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    const result = await printTestPage({ ...getDefaultPrintSettings(), printerMode: "browser" });

    expect(result.method).toBe("browser");
    expect(printed).toHaveBeenCalledOnce();
    append.mockRestore();
  });

  it("mantém a nota identificada pelo restaurante, sem atribuí-la ao Mesari", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printReceipt(
      sampleReceipt("sale-separated"),
      {
        ...restaurant,
        name: "Sabor da Roça",
      },
      { ...getDefaultPrintSettings(), printerMode: "browser" },
    );

    expect(printedHtml).toContain("Sabor da Roça");
    expect(printedHtml).not.toContain("MESARI");
    append.mockRestore();
  });

  it("imprime a origem e os dados do cliente no mesmo layout da nota", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printReceipt(
      {
        ...sampleReceipt("sale-delivery"),
        reprint: true,
        origin: "entrega",
        customerName: "Joana",
        customerPhone: "(11) 99999-0000",
        customerAddress: "Rua das Flores, 10",
      },
      restaurant,
      { ...getDefaultPrintSettings(), printerMode: "browser" },
    );

    expect(printedHtml).toContain("2ª VIA · DATA ORIGINAL");
    expect(printedHtml).toContain("ENTREGA · Joana");
    expect(printedHtml).toContain("Telefone: (11) 99999-0000");
    expect(printedHtml).toContain("Endereço: Rua das Flores, 10");
    expect(printedHtml).toContain("data:image/png;base64");
    expect(printedHtml).toContain("data:font/woff2;base64");
    append.mockRestore();
  });

  it("imprime as formas de pagamento e os valores de troco", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printReceipt(
      {
        ...sampleReceipt("sale-payments"),
        payments: [
          { forma: "pix", valor: 5 },
          { forma: "dinheiro", valor: 6, recebido: 10, troco: 4 },
        ],
      },
      restaurant,
      { ...getDefaultPrintSettings(), printerMode: "browser" },
    );

    expect(printedHtml).toContain("Pix");
    expect(printedHtml).toContain("Dinheiro");
    expect(printedHtml).toContain("Recebido");
    expect(printedHtml).toContain("Troco");
    append.mockRestore();
  });

  it("imprime comanda de cozinha com setor omitido, mesa e observação destacados", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printKitchenTicket(
      {
        id: "kitchen-1",
        number: 19,
        table: 5,
        sector: "cozinha",
        waiter: "Ana",
        additional: true,
        createdAt: new Date("2026-10-08T12:00:00").getTime(),
        items: [{ product: "Picanha na chapa", quantity: 2, note: "sem cebola" }],
      },
      { ...getDefaultPrintSettings(), printerMode: "browser", paperWidth: 58 },
    );

    expect(printedHtml).not.toContain("COZINHA");
    expect(printedHtml).not.toContain(">BAR<");
    expect(printedHtml).toContain("PEDIDO #19");
    expect(printedHtml).toContain("MESA 05");
    expect(printedHtml).toContain("** ADICIONAL **");
    expect(printedHtml).toContain("2x&nbsp; Picanha na chapa");
    expect(printedHtml).toContain("&gt;&gt; sem cebola");
    expect(printedHtml).not.toContain("R$");
    expect(printedHtml).toContain("58mm");
    append.mockRestore();
  });

  it("imprime valores por item e o total do pedido quando habilitado", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printKitchenTicket(
      {
        id: "bar-order",
        number: 20,
        table: 5,
        sector: "bar",
        waiter: "Ana",
        additional: false,
        createdAt: new Date("2026-10-08T12:00:00").getTime(),
        items: [{ product: "Suco de laranja", quantity: 2, note: "", unitPrice: 12.5 }],
      },
      { ...getDefaultPrintSettings(), printerMode: "browser" },
    );

    expect(printedHtml).toContain("PEDIDO #20");
    expect(printedHtml).toContain(">BAR</div>");
    expect(printedHtml).toContain("2x&nbsp; Suco de laranja");
    expect(printedHtml).toContain("R$\u00a025,00");
    expect(printedHtml).toContain("R$\u00a012,50 un.");
    expect(printedHtml).toContain("TOTAL DO PEDIDO R$\u00a025,00");
    append.mockRestore();
  });

  it("omite valores quando desabilitados ou quando a comanda antiga não tem preços", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });
    const ticket: KitchenTicket = {
      id: "legacy-order",
      number: 21,
      table: 2,
      sector: "cozinha",
      waiter: "Bia",
      additional: false,
      createdAt: Date.now(),
      items: [{ product: "Café", quantity: 1, note: "" }],
    };

    await printKitchenTicket(ticket, {
      ...getDefaultPrintSettings(),
      printerMode: "browser",
      showKitchenPrices: false,
    });
    expect(printedHtml).not.toContain("R$");
    expect(printedHtml).not.toContain("TOTAL DO PEDIDO");

    await printKitchenTicket(ticket, {
      ...getDefaultPrintSettings(),
      printerMode: "browser",
      showKitchenPrices: true,
    });
    expect(printedHtml).not.toContain("R$");
    expect(printedHtml).not.toContain("TOTAL DO PEDIDO");
    append.mockRestore();
  });
});

describe("impressora simulada", () => {
  const ticket: KitchenTicket = {
    id: "k1",
    number: 12,
    table: 4,
    sector: "bar",
    waiter: "Bia",
    additional: false,
    createdAt: new Date("2026-10-18T21:00:00").getTime(),
    items: [{ product: "Caipirinha", quantity: 1, note: "sem gelo", unitPrice: 18 }],
  };

  beforeEach(() => {
    resetVirtualPrinterForTests();
    clearVirtualJobs();
    resetSimulatedPaper();
    setDemoSimulation(false);
  });

  function simulate(extra: Partial<PrintSettings> = {}) {
    const settings: PrintSettings = {
      ...getDefaultPrintSettings(),
      printerMode: "simulacao",
      ...extra,
    };
    savePrintSettings(settings);
    return getPrintSettings();
  }

  it("não chama hardware, iframe nem Electron e põe a comanda na fila com HTML e ESC/POS", async () => {
    const serial = { requestPort: vi.fn(), getPorts: vi.fn(), addEventListener: vi.fn() };
    const usb = { requestDevice: vi.fn(), getDevices: vi.fn(), addEventListener: vi.fn() };
    Object.defineProperty(navigator, "serial", { configurable: true, value: serial });
    Object.defineProperty(navigator, "usb", { configurable: true, value: usb });
    const nativePrint = vi.fn();
    Object.defineProperty(window, "mesariDesktop", {
      configurable: true,
      value: { isDesktop: true, print: nativePrint, getSettings: vi.fn(), testPrint: vi.fn() },
    });
    const append = vi.spyOn(document.body, "append");
    const settings = simulate();

    await expect(printKitchenTicket(ticket, settings, false)).resolves.toEqual({
      method: "simulacao",
    });
    await expect(printTestPage(settings)).resolves.toEqual({ method: "simulacao" });
    await expect(printReceipt(sampleReceipt(), restaurant, settings)).resolves.toEqual({
      method: "simulacao",
    });

    expect(nativePrint).not.toHaveBeenCalled();
    expect(serial.requestPort).not.toHaveBeenCalled();
    expect(serial.getPorts).not.toHaveBeenCalled();
    expect(usb.requestDevice).not.toHaveBeenCalled();
    expect(usb.getDevices).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();

    const [recibo, teste, comanda] = getVirtualJobs();
    expect(comanda).toMatchObject({ tipo: "comanda", setor: "bar", mesa: 4, larguraMm: 58 });
    expect(comanda?.html).toContain("Caipirinha");
    expect(comanda?.escpos?.length).toBeGreaterThan(20);
    expect(teste).toMatchObject({ tipo: "teste" });
    expect(recibo).toMatchObject({ tipo: "recibo", mesa: 3 });
    expect(recibo?.html).toContain("Café");
    expect(getPrinterStatus()).toMatchObject({ connected: true, name: "Impressora virtual" });
  });

  it("guarda no máximo 50 trabalhos, mais recente primeiro, e sobrevive a recarregar", async () => {
    const settings = simulate();
    for (let index = 1; index <= 52; index += 1) {
      await printKitchenTicket({ ...ticket, number: index }, settings, false);
    }
    resetVirtualPrinterForTests();
    const jobs = getVirtualJobs();
    expect(jobs).toHaveLength(50);
    expect(jobs[0]?.titulo).toBe("Pedido #52");
    expect(jobs[0]?.escpos).toBeInstanceOf(Uint8Array);
  });

  it("simula impressora desconectada", async () => {
    const settings = simulate({ simulationBehavior: "desconectada" });
    await expect(printKitchenTicket(ticket, settings, false)).rejects.toThrow(
      "Impressora desconectada (simulação)",
    );
    expect(getPrinterStatus().connected).toBe(false);
    expect(getVirtualJobs()).toHaveLength(0);
  });

  it("simula falta de papel na 3ª impressão", async () => {
    const settings = simulate({ simulationBehavior: "sem_papel" });
    await printKitchenTicket(ticket, settings, false);
    await printKitchenTicket(ticket, settings, false);
    await expect(printKitchenTicket(ticket, settings, false)).rejects.toThrow("sem papel");
    expect(getPrinterStatus().connected).toBe(false);
    expect(getVirtualJobs()).toHaveLength(2);
    resetSimulatedPaper();
    expect(getPrinterStatus().connected).toBe(true);
  });

  it("modo demonstração simula sem gravar nas configurações", () => {
    savePrintSettings({ ...getDefaultPrintSettings(), printerMode: "browser" });
    setDemoSimulation(true);
    expect(getPrintSettings().printerMode).toBe("simulacao");
    savePrintSettings({ ...getPrintSettings(), copies: 2 });
    setDemoSimulation(false);
    expect(getPrintSettings()).toMatchObject({ printerMode: "browser", copies: 2 });
  });
});
