import { beforeEach, describe, expect, it } from "vitest";
import {
  getDefaultPrintSettings,
  printKitchenTicket,
  resetSimulatedPaper,
  setDemoSimulation,
  type PrintSettings,
} from "@/lib/printing";
import { mapStationTicket } from "@/lib/kitchen-ticket-row";
import {
  clearVirtualJobs,
  getVirtualJobs,
  resetVirtualPrinterForTests,
} from "@/lib/virtual-printer";
import { decodeEscPos, previewToText } from "@/lib/escpos-preview";

// Linhas como o banco grava em pedidos_cozinha. Com comanda_unica o envio
// inteiro vem em UMA linha 'geral' e cada item traz o setor.
const baseRow = {
  numero: 41,
  mesa_numero: 7,
  garcom_nome: "Ana",
  adicional: true,
  criado_em: "2026-10-18T20:15:00",
  impresso_em: null,
};
const prato = {
  produto: "Picanha",
  quantidade: 1,
  observacao: "mal passada",
  valor_unitario: 89.9,
};
const bebida = { produto: "Caipirinha", quantidade: 2, observacao: "sem gelo", valor_unitario: 18 };
const balcao = { produto: "Bala de menta", quantidade: 1, observacao: "", valor_unitario: 1 };

const singleTicketRow = (itens: unknown[]) => ({
  ...baseRow,
  id: "geral-1",
  setor: "geral",
  itens,
});

function simulate(paperWidth: 58 | 80 = 80): PrintSettings {
  return {
    ...getDefaultPrintSettings(),
    printerMode: "simulacao",
    paperWidth,
    columns: paperWidth === 58 ? 32 : 48,
  };
}

const escposText = (bytes: Uint8Array | undefined, columns: number) =>
  previewToText(decodeEscPos(bytes ?? new Uint8Array(), { columns }), columns);

beforeEach(() => {
  localStorage.clear();
  resetVirtualPrinterForTests();
  clearVirtualJobs();
  resetSimulatedPaper();
  setDemoSimulation(false);
});

describe("comanda única (uma impressora)", () => {
  it("pedido com comida e bebida sai em 1 comanda com os blocos COZINHA e BAR", async () => {
    const ticket = mapStationTicket(
      singleTicketRow([
        { ...prato, setor: "cozinha" },
        { ...bebida, setor: "bar" },
      ]),
    );
    expect(ticket.sector).toBe("geral");

    for (const width of [58, 80] as const) {
      clearVirtualJobs();
      const settings = simulate(width);
      await printKitchenTicket(ticket, settings, false);

      const jobs = getVirtualJobs();
      expect(jobs).toHaveLength(1);
      const [job] = jobs;
      expect(job).toMatchObject({ tipo: "comanda", setor: "geral", mesa: 7 });

      const html = job?.html ?? "";
      expect(html.match(/PEDIDO #41/g)).toHaveLength(1);
      expect(html).toContain("MESA 07");
      expect(html).toContain("** ADICIONAL **");
      expect(html).toContain("Garçom: Ana");
      expect(html.indexOf('<div class="block">COZINHA</div>')).toBeLessThan(
        html.indexOf("Picanha"),
      );
      expect(html.indexOf('<div class="block">BAR</div>')).toBeGreaterThan(html.indexOf("Picanha"));
      expect(html.indexOf('<div class="block">BAR</div>')).toBeLessThan(html.indexOf("Caipirinha"));
      expect(html).toContain("mal passada");
      expect(html).toContain("sem gelo");

      const text = escposText(job?.escpos, settings.columns);
      expect(text.match(/PEDIDO #41/g)).toHaveLength(1);
      expect(text).toContain("== COZINHA ==");
      expect(text).toContain("== BAR ==");
      expect(text.indexOf("== COZINHA ==")).toBeLessThan(text.indexOf("1x Picanha"));
      expect(text.indexOf("== BAR ==")).toBeLessThan(text.indexOf("2x Caipirinha"));
      expect(text).toContain(">> sem gelo");
      expect(
        decodeEscPos(job?.escpos ?? new Uint8Array(), { columns: settings.columns }).linhas.some(
          (linha) => linha.tipo === "texto" && linha.estoura,
        ),
      ).toBe(false);
    }
  });

  it("pedido só com bebida sai em 1 comanda só com o bloco BAR", async () => {
    const ticket = mapStationTicket(singleTicketRow([{ ...bebida, setor: "bar" }]));
    await printKitchenTicket(ticket, simulate(), false);

    const [job] = getVirtualJobs();
    expect(getVirtualJobs()).toHaveLength(1);
    expect(job?.html).toContain('<div class="block">BAR</div>');
    expect(job?.html).not.toContain("COZINHA");
    const text = escposText(job?.escpos, 48);
    expect(text).toContain("== BAR ==");
    expect(text).not.toContain("COZINHA");
  });

  it("pedido com itens de todas as categorias imprime todos", async () => {
    const ticket = mapStationTicket(
      singleTicketRow([
        { ...prato, setor: "cozinha" },
        { ...bebida, setor: "bar" },
        { ...balcao }, // produto sem categoria: vem sem setor
      ]),
    );
    expect(ticket.items).toHaveLength(3);

    await printKitchenTicket(ticket, simulate(), false);
    const [job] = getVirtualJobs();
    const html = job?.html ?? "";
    const text = escposText(job?.escpos, 48);
    for (const product of ["Picanha", "Caipirinha", "Bala de menta"]) {
      expect(html).toContain(product);
      expect(text).toContain(product);
    }
    // Total com tudo: 89,90 + 2 × 18,00 + 1,00.
    expect(html).toMatch(/TOTAL DO PEDIDO R\$\s126,90/);
  });

  it("registro antigo com setor 'nenhum' imprime no bloco COZINHA", async () => {
    const ticket = mapStationTicket(
      singleTicketRow([
        { ...bebida, setor: "bar" },
        { ...balcao, setor: "nenhum" },
      ]),
    );
    expect(ticket.items.map((item) => [item.product, item.sector])).toEqual([
      ["Caipirinha", "bar"],
      ["Bala de menta", "cozinha"],
    ]);

    await printKitchenTicket(ticket, simulate(), false);
    const [job] = getVirtualJobs();
    const html = job?.html ?? "";
    const cozinha = html.indexOf('<div class="block">COZINHA</div>');
    expect(cozinha).toBeGreaterThan(-1);
    expect(html.indexOf("Bala de menta")).toBeGreaterThan(cozinha);
    expect(html.indexOf("Bala de menta")).toBeLessThan(
      html.indexOf('<div class="block">BAR</div>'),
    );
    const text = escposText(job?.escpos, 48);
    expect(text.indexOf("1x Bala de menta")).toBeGreaterThan(text.indexOf("== COZINHA =="));
    expect(text.indexOf("1x Bala de menta")).toBeLessThan(text.indexOf("== BAR =="));
  });
});

describe("duas impressoras (uma comanda por setor)", () => {
  it("continua saindo 2 comandas separadas, sem blocos de setor", async () => {
    const tickets = [
      mapStationTicket({ ...baseRow, id: "c-1", numero: 41, setor: "cozinha", itens: [prato] }),
      mapStationTicket({ ...baseRow, id: "b-1", numero: 42, setor: "bar", itens: [bebida] }),
    ];
    for (const ticket of tickets) await printKitchenTicket(ticket, simulate(), false);

    const jobs = getVirtualJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.setor).sort()).toEqual(["bar", "cozinha"]);
    for (const job of jobs) {
      expect(job.html).not.toContain('class="block"');
      expect(escposText(job.escpos, 48)).not.toContain("==");
    }
    expect(jobs.find((job) => job.setor === "bar")?.html).toContain("PEDIDO #42");
  });

  it("recusa setor desconhecido em comanda de mesa", () => {
    expect(() => mapStationTicket({ ...baseRow, id: "x", setor: "copa", itens: [] })).toThrow(
      "Setor inválido",
    );
  });
});
