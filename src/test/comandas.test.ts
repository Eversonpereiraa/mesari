import { describe, expect, it } from "vitest";
import {
  SAMPLE_PRINTED_AT,
  SAMPLE_RESTAURANT,
  comandaCozinha,
  comandaDelivery,
  contaMesa,
  sampleDeliveryTicket,
  sampleKitchenTicket,
  sampleReceipt,
} from "@/lib/printing/comandas";
import { layoutDoc, renderText, type PrintDoc } from "@/lib/printing/layout";
import { renderEscPos, renderHtml } from "@/lib/printing/documents";
import { defaultConfig } from "@/lib/printing/config";
import { ditherLogo, logoSize, packDots, type PrintLogo } from "@/lib/printing/logo";
import { money, phone, splitAddress } from "@/lib/printing/format";
import type { KitchenTicket } from "@/lib/printing/types";

const logo: PrintLogo = { width: 16, height: 2, bits: new Uint8Array(4).fill(0xff), src: "data:," };
const model = (text: string) => text.replace(/^\n/, "").replace(/\n$/, "");

const cozinha = () => comandaCozinha(sampleKitchenTicket(), { now: SAMPLE_PRINTED_AT });
const delivery = () => comandaDelivery(sampleDeliveryTicket(), SAMPLE_RESTAURANT, { logo });
const conta = () => contaMesa(sampleReceipt(), SAMPLE_RESTAURANT, { logo });

describe("modelos em 42 colunas (80 mm)", () => {
  it("comanda de cozinha", () => {
    expect(renderText(cozinha(), 42)).toBe(
      model(`
            COMANDA DE COZINHA
==========================================
MESA 05
Pedido #0142              05/11/2026 16:35
Garçom: Severino Lima
------------------------------------------
2x Escondidinho de charque
   obs: um sem queijo

1x Batata frita com cheddar e bacon
   (porção grande)

2x Refrigerante lata
   obs: Coca-Cola gelada

1x Suco de laranja 500 ml
   obs: pouco gelo, sem açúcar
------------------------------------------
Itens: 6                    Impresso 16:35
==========================================
`),
    );
  });

  it("comanda de delivery", () => {
    expect(renderText(delivery(), 42)).toBe(
      model(`
                  [LOGO]
       RESTAURANTE SABOR DO AGRESTE
             (81) 99634-1234
==========================================
ENTREGA #128
WhatsApp                  05/11/2026 15:14
------------------------------------------
Cliente: João da Silva
Fone: (81) 98765-4321
End.: Rua das Acácias, 123, apto 45 -
      Jardim São Paulo - Surubim/PE
Ref.: ao lado da padaria
------------------------------------------
QTD DESCRIÇÃO                        VALOR
------------------------------------------
2  X-Burguer da Casa                 57,80
   obs: sem cebola
1  Batata frita com cheddar e bacon
   (porção grande)                   32,00
1  Suco de laranja 500 ml            19,00
   obs: pouco gelo
------------------------------------------
                        Subtotal R$ 108,80
                           Entrega R$ 7,00
                         Desconto -R$ 5,00
                           TOTAL R$ 110,80
------------------------------------------
Pagamento: Dinheiro
Troco para                       R$ 150,00
LEVAR DE TROCO                    R$ 39,20
Obs.: Interfone com defeito, ligar ao
      chegar.
==========================================
          Não é documento fiscal
************* Sistema Mesari *************
`),
    );
  });

  it("conta da mesa", () => {
    expect(renderText(conta(), 42)).toBe(
      model(`
                  [LOGO]
       RESTAURANTE SABOR DO AGRESTE
   Rua Coronel Pedro Pinto, 215, Centro
         Surubim - PE, 55750-000
             (81) 99634-1234
==========================================
MESA 05                   05/11/2026 16:35
Garçom: Severino Lima
------------------------------------------
QTD DESCRIÇÃO                        VALOR
------------------------------------------
2  Escondidinho de charque           72,00
2  Refrigerante lata                 12,00
1  Batata frita com cheddar e bacon
   (porção grande)                   32,00
------------------------------------------
                        Subtotal R$ 116,00
                      Serviço 10% R$ 11,60
                           TOTAL R$ 127,60
==========================================
          Não é documento fiscal
        Obrigado pela preferência!
               Volte sempre
************* Sistema Mesari *************
`),
    );
  });

  it("estilos de cada linha seguem o modelo", () => {
    const styled = (doc: PrintDoc) =>
      layoutDoc(doc, 42).flatMap((line) =>
        line.kind === "text" && (line.bold || line.size !== "normal")
          ? [`${line.size}${line.bold ? "+b" : ""}: ${line.text.trim()}`]
          : [],
      );
    expect(styled(cozinha())).toEqual([
      "normal+b: COMANDA DE COZINHA",
      "big+b: MESA 05",
      "tall+b: 2x Escondidinho de charque",
      "tall+b: 1x Batata frita com cheddar e bacon",
      "tall+b: (porção grande)",
      "tall+b: 2x Refrigerante lata",
      "tall+b: 1x Suco de laranja 500 ml",
    ]);
    expect(styled(delivery())).toEqual([
      "normal+b: RESTAURANTE SABOR DO AGRESTE",
      "big+b: ENTREGA #128",
      "normal+b: QTD DESCRIÇÃO                        VALOR",
      "tall+b: TOTAL R$ 110,80",
      "normal+b: LEVAR DE TROCO                    R$ 39,20",
    ]);
    expect(styled(conta())).toEqual([
      "tall+b: RESTAURANTE SABOR DO AGRESTE",
      "normal+b: MESA 05                   05/11/2026 16:35",
      "normal+b: QTD DESCRIÇÃO                        VALOR",
      "tall+b: TOTAL R$ 127,60",
    ]);
  });
});

describe("modelos em 32 colunas (58 mm)", () => {
  it("comanda de cozinha", () => {
    expect(renderText(cozinha(), 32)).toBe(
      model(`
       COMANDA DE COZINHA
================================
MESA 05
Pedido #0142    05/11/2026 16:35
Garçom: Severino Lima
--------------------------------
2x Escondidinho de charque
   obs: um sem queijo

1x Batata frita com cheddar e
   bacon (porção grande)

2x Refrigerante lata
   obs: Coca-Cola gelada

1x Suco de laranja 500 ml
   obs: pouco gelo, sem açúcar
--------------------------------
Itens: 6          Impresso 16:35
================================
`),
    );
  });

  it("comanda de delivery", () => {
    expect(renderText(delivery(), 32)).toBe(
      model(`
             [LOGO]
  RESTAURANTE SABOR DO AGRESTE
        (81) 99634-1234
================================
ENTREGA #128
WhatsApp        05/11/2026 15:14
--------------------------------
Cliente: João da Silva
Fone: (81) 98765-4321
End.: Rua das Acácias, 123, apto
      45 - Jardim São Paulo -
      Surubim/PE
Ref.: ao lado da padaria
--------------------------------
QTD DESCRIÇÃO              VALOR
--------------------------------
2  X-Burguer da Casa       57,80
   obs: sem cebola
1  Batata frita com cheddar e
   bacon (porção grande)   32,00
1  Suco de laranja 500 ml  19,00
   obs: pouco gelo
--------------------------------
              Subtotal R$ 108,80
                 Entrega R$ 7,00
               Desconto -R$ 5,00
                 TOTAL R$ 110,80
--------------------------------
Pagamento: Dinheiro
Troco para             R$ 150,00
LEVAR DE TROCO          R$ 39,20
Obs.: Interfone com defeito,
      ligar ao chegar.
================================
     Não é documento fiscal
******** Sistema Mesari ********
`),
    );
  });

  it("conta da mesa", () => {
    expect(renderText(conta(), 32)).toBe(
      model(`
             [LOGO]
  RESTAURANTE SABOR DO AGRESTE
 Rua Coronel Pedro Pinto, 215,
             Centro
    Surubim - PE, 55750-000
        (81) 99634-1234
================================
MESA 05         05/11/2026 16:35
Garçom: Severino Lima
--------------------------------
QTD DESCRIÇÃO              VALOR
--------------------------------
2  Escondidinho de charque 72,00
2  Refrigerante lata       12,00
1  Batata frita com cheddar e
   bacon (porção grande)   32,00
--------------------------------
              Subtotal R$ 116,00
            Serviço 10% R$ 11,60
                 TOTAL R$ 127,60
================================
     Não é documento fiscal
   Obrigado pela preferência!
          Volte sempre
******** Sistema Mesari ********
`),
    );
  });
});

function longTicket(): KitchenTicket {
  const ticket = sampleDeliveryTicket();
  return {
    ...ticket,
    items: [
      {
        product:
          "Parmegiana de filé mignon com arroz à grega, fritas crocantes e salada da casa para quatro pessoas",
        quantity: 12,
        note: "metade sem cebola, molho à parte e talheres extras para as crianças da mesa",
        unitPrice: 102.88,
      },
    ],
    external: {
      ...ticket.external!,
      address:
        "Avenida Governador Agamenon Magalhães, 4.567, bloco B, apartamento 1203, edifício Mirante do Capibaribe\nBoa Vista - Recife/PE",
      subtotal: 1234.56,
      deliveryFee: 0,
      discount: 0,
      total: 1234.56,
      payment: { forma: "pix", pago: false, trocoPara: null },
      observation: "",
    },
  };
}

describe("casos longos", () => {
  it.each([42, 32])("nome longo, endereço longo e R$ 1.234,56 em %i colunas", (columns) => {
    const doc = comandaDelivery(longTicket(), SAMPLE_RESTAURANT);
    const lines = renderText(doc, columns).split("\n");
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
    // O valor do item fica na última linha do nome, colado na última coluna.
    const nameEnd = lines.findIndex((line) => line.endsWith("1.234,56"));
    expect(lines[nameEnd]).toHaveLength(columns);
    expect(lines[nameEnd]!.startsWith("   ")).toBe(true);
    // Sem "R$ x cada": a observação vem logo depois do item.
    expect(lines.some((line) => line.includes("cada"))).toBe(false);
    expect(lines[nameEnd + 1]!.startsWith("   obs: metade")).toBe(true);
    // Continuações da observação alinhadas depois de "obs: ".
    expect(lines[nameEnd + 2]!.startsWith("        ")).toBe(true);
    // Totais alinhados à direita; sem taxa nem desconto não há "Subtotal".
    expect(lines.find((line) => line.trim().startsWith("TOTAL"))).toBe(
      `${" ".repeat(columns - 17)}TOTAL R$ 1.234,56`,
    );
    expect(lines.some((line) => line.includes("Subtotal"))).toBe(false);
    expect(lines).toContain("Pagamento: A receber - Pix");
    expect(lines.some((line) => line.startsWith("Troco para"))).toBe(false);
    expect(lines.some((line) => line.includes("Entrega R$"))).toBe(false);
    expect(lines.some((line) => line.includes("Desconto"))).toBe(false);
    expect(lines.some((line) => line.startsWith("Obs.:"))).toBe(false);
    // Endereço num bloco só, continuações alinhadas depois de "End.: ".
    expect(lines.some((line) => line.startsWith("End.: Avenida Governador"))).toBe(true);
    expect(lines.join(" ")).toContain("Recife/PE");
    expect(lines.at(-1)).toMatch(/^\*+ Sistema Mesari \*+$/);
    // Nenhuma palavra do nome foi perdida.
    const words = lines.join(" ").split(/\s+/);
    for (const word of ["Parmegiana", "mignon", "grega,", "pessoas"]) expect(words).toContain(word);
    // "R$" nunca separado do número.
    expect(lines.some((line) => /R\$$/.test(line.trimEnd()))).toBe(false);
  });

  it("retirada: título próprio e sem endereço", () => {
    const ticket = sampleDeliveryTicket();
    ticket.external = { ...ticket.external!, origin: "retirada", deliveryFee: 0 };
    const text = renderText(comandaDelivery(ticket, SAMPLE_RESTAURANT), 42);
    expect(text).toContain("RETIRADA #128");
    expect(text).not.toContain("Rua das Acácias");
    expect(text).not.toContain("[LOGO]");
    expect(text.split("\n")[0]).toBe("       RESTAURANTE SABOR DO AGRESTE");
    const kitchen = renderText(comandaCozinha(ticket, { now: SAMPLE_PRINTED_AT }), 42);
    expect(kitchen).toContain("RETIRADA #128");
    expect(kitchen).toContain("Origem: WhatsApp");
    expect(kitchen).not.toContain("Garçom");
  });

  it("taxa de serviço some quando é zero; rodapé é configurável", () => {
    const receipt = { ...sampleReceipt(), serviceCharge: 0, total: 116 };
    const text = renderText(
      contaMesa(receipt, { ...SAMPLE_RESTAURANT, receiptFooter: "Até a próxima!" }),
      42,
    );
    expect(text).not.toContain("Serviço");
    expect(text).not.toContain("Subtotal");
    const lines = text.split("\n");
    expect(lines.at(-2)).toBe("              Até a próxima!");
    expect(lines.at(-1)).toBe("************* Sistema Mesari *************");
  });

  it("nome do restaurante em altura dupla quebra por palavra em 32 colunas", () => {
    const text = renderText(
      contaMesa(sampleReceipt(), {
        ...SAMPLE_RESTAURANT,
        name: "Restaurante e Petiscaria Sabor do Agreste Nordestino",
      }),
      32,
    );
    expect(text.split("\n").slice(0, 2)).toEqual([
      " RESTAURANTE E PETISCARIA SABOR",
      "     DO AGRESTE NORDESTINO",
    ]);
  });
});

describe("formatos", () => {
  it("valores, telefone e endereço", () => {
    expect(money(1234.56)).toBe("R$ 1.234,56");
    expect(money(-5)).toBe("-R$ 5,00");
    expect(phone("81996341234")).toBe("(81) 99634-1234");
    expect(phone("+55 (81) 3634-1234")).toBe("(81) 3634-1234");
    expect(splitAddress("Rua A, 1 - Centro - Surubim/PE")).toEqual({
      lines: ["Rua A, 1", "Centro - Surubim/PE"],
      reference: "",
    });
  });
});

/** Interpreta os bytes: texto por linha, com negrito/tamanho ativos. */
function decode(bytes: Uint8Array) {
  const lines: { text: string; bold: boolean; size: number }[] = [];
  let text = "";
  let bold = false;
  let size = 0;
  let cuts = 0;
  let images = 0;
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    if (b === 0x1b) {
      const cmd = bytes[i + 1]!;
      if (cmd === 0x45) bold = bytes[i + 2] === 1;
      i += (
        { 0x40: 2, 0x74: 3, 0x4d: 3, 0x61: 3, 0x45: 3, 0x64: 3, 0x70: 5 } as Record<number, number>
      )[cmd]!;
    } else if (b === 0x1d) {
      const cmd = bytes[i + 1]!;
      if (cmd === 0x21) size = bytes[i + 2]!;
      if (cmd === 0x56) cuts += 1;
      if (cmd === 0x76) {
        images += 1;
        const x = bytes[i + 4]! | (bytes[i + 5]! << 8);
        const y = bytes[i + 6]! | (bytes[i + 7]! << 8);
        i += 8 + x * y;
        continue;
      }
      i += ({ 0x21: 3, 0x4c: 4, 0x57: 4, 0x56: 4 } as Record<number, number>)[cmd]!;
    } else if (b === 0x0a) {
      lines.push({ text, bold, size });
      text = "";
      i += 1;
    } else {
      text += b < 0x80 ? String.fromCharCode(b) : "?";
      i += 1;
    }
  }
  return { lines, cuts, images };
}

describe("ESC/POS", () => {
  const config = {
    ...defaultConfig(),
    paperWidth: 80 as const,
    printableMm: 72,
    columns: 42 as const,
  };

  it("mesmas linhas do texto, com os estilos e o corte no fim", () => {
    const bytes = renderEscPos(conta(), config);
    const { lines, cuts, images } = decode(bytes);
    expect(cuts).toBe(1);
    expect(images).toBe(1);
    const expected = renderText(conta(), 42).split("\n").slice(1);
    expect(lines.map((line) => line.text.trimEnd()).map((t) => t.replace(/\?/g, "_"))).toEqual(
      expected.map((t) => t.replace(/[^\x20-\x7e]/g, "_")),
    );
    expect(lines.find((line) => line.text.startsWith("MESA 05"))).toMatchObject({
      bold: true,
      size: 0,
    });
    expect(lines.find((line) => line.text.trim().startsWith("TOTAL"))).toMatchObject({
      bold: true,
      size: 0x01,
    });
    // Avanço de 4 linhas e corte (GS V).
    expect(Array.from(bytes.slice(-7))).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 66, 0]);
  });

  it("área de texto com 42 colunas centralizada na área útil", () => {
    const bytes = Array.from(renderEscPos(cozinha(), config));
    // GS L 36 0 (margem) e GS W 504 (42 x 12 pontos) logo após o init.
    const tail = bytes.slice(16, 24);
    expect(tail).toEqual([0x1d, 0x4c, 36, 0, 0x1d, 0x57, 504 & 0xff, 504 >> 8]);
  });

  it("delivery + cozinha em um trabalho: dois cortes", () => {
    const { cuts } = decode(renderEscPos([cozinha(), delivery()], config));
    expect(cuts).toBe(2);
  });
});

describe("HTML", () => {
  it("usa as mesmas linhas, com altura dupla e tamanho duplo", () => {
    const html = renderHtml(conta(), { ...defaultConfig(), columns: 42, fontSize: "medio" });
    const entrega = renderHtml(delivery(), { ...defaultConfig(), columns: 42, fontSize: "medio" });
    expect(entrega).toContain('<div class="l b big"><span>ENTREGA #128</span></div>');
    expect(html).toContain(
      `<div class="l b tall"><span>${" ".repeat(27)}TOTAL R$ 127,60</span></div>`,
    );
    expect(html).toContain('<img class="logo"');
    expect(html).toContain("max-width:48mm");
    expect(html).toContain("grayscale(1)");
    expect(html).toContain("white-space:pre");
  });
});

describe("logo", () => {
  it("limita a 384 x 200 mantendo a proporção", () => {
    expect(logoSize(1000, 500)).toEqual({ width: 384, height: 192 });
    expect(logoSize(400, 800)).toEqual({ width: 100, height: 200 });
    expect(logoSize(100, 50)).toEqual({ width: 100, height: 50 });
  });

  it("converte para 1 bit e avisa quando há degradê", () => {
    const width = 64;
    const height = 8;
    const solid = new Uint8ClampedArray(width * height * 4);
    const gradient = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const x = i % width;
      solid.set(x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
      const g = Math.round((x / (width - 1)) * 255);
      gradient.set([g, g, g, 255], i * 4);
    }
    const flat = ditherLogo(solid, width, height);
    expect(flat.detailed).toBe(false);
    expect(flat.dots[0]).toBe(1);
    expect(flat.dots[63]).toBe(0);
    expect(ditherLogo(gradient, width, height).detailed).toBe(true);
    const bits = packDots(flat.dots, width, height);
    expect(bits[0]).toBe(0xff);
    expect(bits[4]).toBe(0x00);
  });
});

describe("comanda adicional", () => {
  it("destaca *** ADICIONAL *** no topo, com mesa e garçom, só com os itens do envio", () => {
    const ticket: KitchenTicket = {
      ...sampleKitchenTicket(),
      additional: true,
      items: [{ product: "Batata frita", quantity: 1, note: "" }],
    };
    const text = renderText(comandaCozinha(ticket, { now: SAMPLE_PRINTED_AT }), 32);
    const lines = text.split("\n").filter((line) => line.trim());
    expect(lines[0]!.trim()).toBe("*** ADICIONAL ***");
    expect(text).toMatch(/MESA \d{2}/);
    expect(text).toContain(`Garçom: ${ticket.waiter}`);
    expect(text).toContain("1x Batata frita");
    expect(text).toContain("Itens: 1");
  });
});
