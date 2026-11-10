import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {}, supabaseConfigured: false, usernameEmail: vi.fn() }));

import { salesCsv } from "@/lib/sales-export";
import { countTablesByArea } from "@/components/salao/areas";
import type { Closing, FloorArea } from "@/lib/store";

const sale = (overrides: Partial<Closing> = {}): Closing => ({
  id: "v1",
  at: Date.parse("2026-11-09T23:30:00Z"),
  table: 5,
  saleNumber: 12,
  lines: [
    { id: "l1", itemId: "p1", name: "Pizza; grande", qty: 2, price: 40, note: "", at: 0, waiter: "Ana" },
    { id: "l2", itemId: "p2", name: "Suco", qty: 1, price: 8, note: "", at: 0, waiter: "Ana" },
  ],
  subtotal: 88,
  serviceCharge: 8.8,
  total: 1096.8,
  payments: [
    { forma: "pix", valor: 50 },
    { forma: "dinheiro", valor: 1046.8 },
  ],
  ...overrides,
});

describe("exportar vendas (CSV para Excel)", () => {
  it("gera cabeçalho, data em São Paulo, itens, pagamento, taxa e total com vírgula", () => {
    const csv = salesCsv([sale(), sale({ id: "v2", origin: "entrega", customerName: "João", payments: [], deliveryFee: 7 })]);
    const [header, first, second] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(header).toBe(
      "Data;Hora;Venda;Mesa/Entrega;Cliente;Itens;Forma de pagamento;Subtotal;Taxa de serviço;Taxa de entrega;Desconto;Total",
    );
    expect(first).toBe(
      '09/11/2026;20:30;12;Mesa 5;;"2x Pizza; grande, 1x Suco";Pix 50,00 + Dinheiro 1.046,80;88,00;8,80;0,00;0,00;1.096,80',
    );
    expect(second).toContain(";Entrega;João;");
    expect(second).toContain(";Não informado;");
    expect(second).toContain(";7,00;");
  });
});

describe("abas de área do caixa", () => {
  const areas: FloorArea[] = [
    { id: "salao", name: "Salão", kind: "interna", x: 0, y: 0, width: 12, depth: 9, order: 0 },
    { id: "fora", name: "Área de Fora", kind: "externa", x: -12, y: 0, width: 11.5, depth: 8.5, order: 1 },
  ];

  it("conta pela área gravada, pela posição desenhada ou, sem nada, na primeira área", () => {
    const counts = countTablesByArea(
      [
        { areaId: "salao", x: 1.5, y: 1.5 },
        // area_id nulo, desenhada dentro do Salão
        { areaId: null, x: 4.5, y: 1.5 },
        // area_id de uma área que não existe mais, desenhada na Área de Fora
        { areaId: "apagada", x: -6, y: 4 },
        // sem área e sem posição
        { areaId: null, x: null, y: null },
      ],
      areas,
    );
    expect(counts).toEqual({ salao: 3, fora: 1 });
  });
});
