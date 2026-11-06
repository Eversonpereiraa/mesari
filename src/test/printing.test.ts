import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EscPosBuilder, encodeText, pairLines, wrapText } from "@/lib/printing/escpos";
import {
  comandaDoc,
  renderEscPos,
  renderHtml,
  sampleTicket,
  testPageDoc,
} from "@/lib/printing/documents";
import { defaultConfig, loadConfig, resetConfigCache, saveConfig } from "@/lib/printing/config";
import {
  AGENT_NOT_FOUND,
  FRIENDLY_PRINT_ERROR,
  PrinterError,
  abrirGaveta,
  imprimirComanda,
  imprimirTeste,
  type KitchenTicket,
} from "@/lib/printing";
import { resetPrinterForTests } from "@/lib/printing/printer";

const options = {
  ...defaultConfig(),
  paperWidth: 80 as const,
  codepage: "CP850" as const,
  showKitchenPrices: true,
};

function mesaTicket(): KitchenTicket {
  return {
    id: "t1",
    number: 42,
    table: 5,
    sector: "cozinha",
    waiter: "Ana",
    additional: false,
    createdAt: new Date("2026-11-05T14:30:00").getTime(),
    items: [
      { product: "X-Burguer", quantity: 2, note: "sem cebola", unitPrice: 25 },
      { product: "Refrigerante lata", quantity: 1, note: "", unitPrice: 6 },
    ],
  };
}

function textOf(bytes: Uint8Array) {
  return Array.from(bytes, (byte) =>
    byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : "\n",
  )
    .join("")
    .split("\n")
    .filter(Boolean);
}

beforeEach(() => {
  localStorage.clear();
  resetConfigCache();
  resetPrinterForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("escpos", () => {
  it("converte acentos para cada codepage", () => {
    expect(encodeText("ação", "CP850")).toEqual([0x61, 0x87, 0xc6, 0x6f]);
    expect(encodeText("ação", "CP860")).toEqual([0x61, 0x87, 0x84, 0x6f]);
    expect(encodeText("ação", "WPC1252")).toEqual([0x61, 0xe7, 0xe3, 0x6f]);
    expect(encodeText("Conceição", "CP850")).toEqual(
      Array.from("Conceição", (c) => ({ ç: 0x87, ã: 0xc6 })[c] ?? c.charCodeAt(0)),
    );
    // CP437 não tem "ã": tira o acento em vez de imprimir lixo.
    expect(encodeText("pão", "CP437")).toEqual([0x70, 0x61, 0x6f]);
    expect(encodeText("café", "CP437")).toEqual([0x63, 0x61, 0x66, 0x82]);
  });

  it("inicializa com ESC @ e seleciona a codepage com ESC t", () => {
    expect(Array.from(new EscPosBuilder("CP850").init().build()).slice(0, 5)).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 2,
    ]);
    expect(Array.from(new EscPosBuilder("WPC1252").init().build()).slice(4, 5)).toEqual([16]);
  });

  it("quebra linhas e alinha o preço à direita", () => {
    expect(wrapText("um dois tres quatro", 9)).toEqual(["um dois", "  tres", "  quatro"]);
    expect(wrapText("   obs: sem cebola e sem tomate", 16)).toEqual([
      "   obs: sem",
      "     cebola e",
      "     sem tomate",
    ]);
    const lines = pairLines("2x Batata frita com cheddar e bacon (porção grande)", "R$ 64,00", 32);
    // O rótulo quebra com recuo e o valor fica colado à direita na última linha.
    expect(lines).toEqual([
      "2x Batata frita com",
      "  cheddar e bacon",
      "  (porção grande)       R$ 64,00",
    ]);
    expect(pairLines("Subtotal", "R$ 10,00", 48)[0]).toHaveLength(48);
  });
});

describe("comanda", () => {
  it("traz mesa em tamanho duplo, garçom, origem, observação e preços", () => {
    const doc = comandaDoc(mesaTicket(), options);
    expect(doc.lines[0]).toMatchObject({ text: "PEDIDO #42", double: true });
    expect(doc.lines[1]).toMatchObject({ text: "MESA 05", double: true });
    const texts = doc.lines.map((line) =>
      "text" in line ? line.text : "left" in line ? `${line.left}|${line.right}` : "",
    );
    expect(texts).toContain("Origem: Mesa");
    expect(texts).toContain("Garçom: Ana");
    expect(texts).toContain("   obs: sem cebola");
    expect(texts).toContain("2x X-Burguer|R$ 50,00");
    expect(texts).toContain("TOTAL|R$ 56,00");
  });

  it("traz cliente, endereço, pagamento, troco, taxa e desconto no delivery", () => {
    const doc = comandaDoc(sampleTicket("entrega"), options);
    const all = doc.lines
      .map((line) =>
        "text" in line ? line.text : "left" in line ? `${line.left}|${line.right}` : "",
      )
      .join("\n");
    expect(all).toContain("ENTREGA");
    expect(all).toContain("Origem: WhatsApp");
    expect(all).toContain("Cliente: João da Silva");
    expect(all).toContain("Telefone: (11) 98765-4321");
    expect(all).toContain("Endereço: Rua das Acácias");
    expect(all).toContain("Pagamento: Dinheiro");
    expect(all).toContain("Troco para|R$ 150,00");
    expect(all).toContain("Taxa de entrega|R$ 7,00");
    expect(all).toContain("Desconto|-R$ 5,00");
  });

  it("gera ESC/POS com corte e linhas dentro da largura", () => {
    const bytes = renderEscPos(comandaDoc(sampleTicket(), options), { ...options, autoCut: true });
    const tail = Array.from(bytes.slice(-7));
    // Avança "linhas antes do corte" (4) e corta.
    expect(tail).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 66, 0]);
    // ESC @, ESC t 2, GS L 0 0, GS W 576 (72 mm x 8), ESC M 0 (fonte A).
    expect(Array.from(bytes.slice(0, 16))).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 2, 0x1d, 0x4c, 0, 0, 0x1d, 0x57, 0x40, 0x02, 0x1b, 0x4d, 0,
    ]);
    const noCut = renderEscPos(comandaDoc(sampleTicket(), options), { ...options, autoCut: false });
    expect(Array.from(noCut).join(",")).not.toContain("29,86,66");
  });

  it("gera HTML de bobina com @page e fonte monoespaçada", () => {
    const html = renderHtml(comandaDoc(mesaTicket(), options), {
      ...options,
      paperWidth: 58,
      printableMm: 48,
      columns: 32,
      offsetMm: -1.5,
    });
    expect(html).toContain("@page{size:58mm auto;margin:0}");
    expect(html).toContain(".ticket{width:48mm;");
    expect(html).toContain("transform:translateX(-1.5mm)");
    // Só o valor das linhas rótulo/valor não quebra; nada de overflow escondido nem cinza.
    expect(html.match(/nowrap/g)).toHaveLength(1);
    expect(html).toContain(".row .val{flex:0 0 auto;white-space:nowrap}");
    expect(html).not.toContain("overflow:hidden");
    const colors = html.match(/#[0-9a-f]{3,6}\b/gi) ?? [];
    expect(colors.every((c) => /^#(000|fff)$/i.test(c))).toBe(true);
    expect(html).toContain("monospace");
    expect(html).toContain("MESA 05");
  });

  it("página de teste tem codepage, palavras acentuadas e régua", () => {
    const doc = testPageDoc({ ...options, paperWidth: 58, columns: 32 }, "Cantina", "Rede (IP)");
    const all = doc.lines.map((line) => ("text" in line ? line.text : "")).join("\n");
    expect(all).toContain("Codepage atual: CP850");
    expect(all).toContain("ação, pão, você, café, órgão, Conceição");
    expect(all).toContain("12345678901234567890123456789012");
    expect(all).not.toContain("123456789012345678901234567890123");
  });
});

describe("configuração", () => {
  it("usa 80 mm, CP850 e corte automático por padrão", () => {
    expect(loadConfig()).toMatchObject({
      paperWidth: 80,
      codepage: "CP850",
      autoCut: true,
      connection: "navegador",
    });
  });

  it("migra a configuração antiga", () => {
    localStorage.setItem(
      "mesari-print-settings",
      JSON.stringify({
        printerMode: "direct",
        connectionType: "serial",
        characterTable: "CP860",
        paperWidth: 58,
        printKitchenEnabled: true,
      }),
    );
    expect(loadConfig()).toMatchObject({
      connection: "webserial",
      codepage: "CP860",
      paperWidth: 58,
      printKitchenEnabled: true,
    });
  });

  it("não quebra quando o localStorage falha", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(loadConfig().codepage).toBe("CP850");
    expect(saveConfig({ ...defaultConfig(), codepage: "CP437" }).codepage).toBe("CP437");
    expect(localStorage.setItem).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("fila e transporte (rede via agente)", () => {
  function useAgent(
    handler: (
      path: string,
      body: Record<string, unknown>,
    ) => { ok: boolean; status?: number; body?: unknown } | Promise<never>,
  ) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        calls.push({ path, body });
        const result = await handler(path, body);
        return {
          ok: result.ok,
          status: result.status ?? (result.ok ? 200 : 500),
          json: async () => result.body ?? { ok: result.ok },
        };
      }),
    );
    saveConfig({ ...defaultConfig(), connection: "rede", ip: "10.0.0.9", port: 9100 });
    return calls;
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("envia base64 para o agente e não duplica no clique duplo", async () => {
    const calls = useAgent(() => ({ ok: true }));
    const ticket = mesaTicket();
    const first = imprimirComanda(ticket);
    const second = imprimirComanda(ticket);
    expect(second).toBe(first);
    await first;
    const prints = calls.filter((call) => call.path === "/print");
    expect(prints).toHaveLength(1);
    expect(prints[0]!.body).toMatchObject({ tipo: "rede", ip: "10.0.0.9", porta: 9100 });
    const bytes = Uint8Array.from(atob(String(prints[0]!.body["dados"])), (c) => c.charCodeAt(0));
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 2]);
  });

  it("tenta de novo uma vez e então desiste com mensagem amigável", async () => {
    let failures = 0;
    const calls = useAgent((path) => {
      if (path === "/print") {
        failures += 1;
        return {
          ok: false,
          status: 502,
          body: {
            ok: false,
            mensagem: "Não foi possível conectar à impressora em 10.0.0.9:9100.",
            detalhe: "ECONNREFUSED",
          },
        };
      }
      return { ok: true };
    });
    const error = await imprimirComanda(mesaTicket()).catch((cause: unknown) => cause);
    expect(failures).toBe(2);
    expect(calls.filter((call) => call.path === "/check")).toHaveLength(2);
    expect(error).toBeInstanceOf(PrinterError);
    expect((error as Error).message).toBe(
      "Não foi possível conectar à impressora em 10.0.0.9:9100.",
    );
    expect((error as Error).message).not.toMatch(/ECONNREFUSED|rpc|function/i);
  });

  it("imprime na segunda tentativa quando a primeira falha", async () => {
    let attempt = 0;
    useAgent((path) => {
      if (path === "/print") {
        attempt += 1;
        return attempt === 1 ? { ok: false, status: 502 } : { ok: true };
      }
      return { ok: true };
    });
    await expect(imprimirTeste("Cantina")).resolves.toEqual({ connection: "rede" });
    expect(attempt).toBe(2);
  });

  it("avisa quando o agente não está rodando", async () => {
    useAgent(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(imprimirComanda(mesaTicket())).rejects.toThrow(AGENT_NOT_FOUND);
  });

  it("dá timeout de 8 s na conexão", async () => {
    vi.useFakeTimers();
    useAgent(() => new Promise<never>(() => undefined));
    const result = imprimirComanda(mesaTicket()).catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(8000 * 2 + 100);
    const error = await result;
    expect(error).toBeInstanceOf(PrinterError);
  });

  it("abre a gaveta com ESC p", async () => {
    const calls = useAgent(() => ({ ok: true }));
    await abrirGaveta();
    const data = String(calls.find((call) => call.path === "/print")!.body["dados"]);
    const bytes = Array.from(atob(data), (c) => c.charCodeAt(0));
    expect(bytes.slice(-5)).toEqual([0x1b, 0x70, 0, 25, 250]);
  });

  it("não usa a mensagem técnica em erros desconhecidos", async () => {
    saveConfig({ ...defaultConfig(), connection: "webserial" });
    const error = await imprimirComanda(mesaTicket()).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PrinterError);
    expect((error as Error).message).toMatch(/Web Serial não é suportado/);
    expect(FRIENDLY_PRINT_ERROR).toMatch(/^Não foi possível imprimir\./);
  });
});
