import type { KitchenTicket } from "@/lib/printing";

export type StationTicket = KitchenTicket & { printedAt: number | null };

// Leitura das colunas setor/itens de public.pedidos_cozinha, comum à estação do
// caixa e à tela /cozinha.

export function parseTicketSector(value: unknown): KitchenTicket["sector"] {
  if (value === "cozinha" || value === "bar" || value === "geral") return value;
  throw new Error(`Setor inválido recebido na comanda: ${String(value)}.`);
}

/**
 * Itens da comanda. Todo item sai no papel; na comanda única o "setor" de cada
 * item só escolhe o bloco (COZINHA ou BAR). Registro antigo com setor "nenhum"
 * (antigo "Não imprimir") vai para o bloco COZINHA.
 */
export function parseTicketItems(value: unknown): KitchenTicket["items"] {
  if (!Array.isArray(value)) throw new Error("A comanda não contém uma lista válida de itens.");
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Um item da comanda está em formato inválido.");
    }
    const item = entry as Record<string, unknown>;
    const sector = item["setor"];
    return {
      product: typeof item["produto"] === "string" ? item["produto"] : "",
      quantity: Number(item["quantidade"]),
      note: typeof item["observacao"] === "string" ? item["observacao"] : "",
      ...(typeof item["valor_unitario"] === "number" && Number.isFinite(item["valor_unitario"])
        ? { unitPrice: item["valor_unitario"] }
        : {}),
      ...(sector === "bar"
        ? { sector: "bar" as const }
        : sector === "cozinha" || sector === "nenhum"
          ? { sector: "cozinha" as const }
          : {}),
    };
  });
}

/** Linha de pedidos_cozinha (mesa, entrega ou retirada) como é lida pela estação do caixa. */
export function mapStationTicket(value: unknown): StationTicket {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("O Supabase retornou uma comanda em formato inválido.");
  }
  const row = value as Record<string, unknown>;
  const origin = row["origem"];
  const externalOrder = origin === "entrega" || origin === "retirada";
  const sector = externalOrder
    ? row["setor"] === "bar"
      ? "bar"
      : "cozinha"
    : parseTicketSector(row["setor"]);
  const details =
    typeof row["dados"] === "object" && row["dados"] !== null && !Array.isArray(row["dados"])
      ? (row["dados"] as Record<string, unknown>)
      : {};
  const paymentValue = details["pagamento_previsto"];
  const payment =
    typeof paymentValue === "object" && paymentValue !== null && !Array.isArray(paymentValue)
      ? (paymentValue as Record<string, unknown>)
      : {};
  const getText = (key: string) => {
    const value = details[key];
    return typeof value === "string" ? value : "";
  };
  const getNumber = (key: string, fallback = 0) => {
    const value = Number(details[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    id: String(row["id"]),
    number: externalOrder ? getNumber("numero_dia", Number(row["numero"])) : Number(row["numero"]),
    table:
      row["mesa_numero"] === null || row["mesa_numero"] === undefined
        ? null
        : Number(row["mesa_numero"]),
    sector,
    waiter: typeof row["garcom_nome"] === "string" ? row["garcom_nome"] : "",
    additional: row["adicional"] === true,
    createdAt: new Date(String(row["criado_em"])).getTime(),
    printedAt: row["impresso_em"] ? new Date(String(row["impresso_em"])).getTime() : null,
    items: parseTicketItems(row["itens"]),
    ...(externalOrder
      ? {
          external: {
            origin,
            dayNumber: getNumber("numero_dia", Number(row["numero"])),
            channel: getText("canal"),
            customerName:
              typeof details["cliente_nome"] === "string" ? details["cliente_nome"] : "",
            phone: getText("telefone"),
            address: getText("endereco"),
            observation: getText("observacao"),
            subtotal: getNumber("subtotal"),
            deliveryFee: getNumber("taxa_entrega"),
            total: getNumber("total"),
            payment: {
              forma: typeof payment["forma"] === "string" ? payment["forma"] : null,
              pago: payment["pago"] === true,
              trocoPara:
                payment["troco_para"] === null || payment["troco_para"] === undefined
                  ? null
                  : Number(payment["troco_para"]),
            },
          },
        }
      : {}),
  };
}
