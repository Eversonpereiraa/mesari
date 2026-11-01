// Status dos pedidos externos (WhatsApp, telefone, papel), com os valores exatos
// que o banco aceita. Toda tela e toda chamada usa estas constantes; nenhum
// status é escrito à mão.
//
// atualizar_status_pedido_externo aceita: novo, preparo, pronto, saiu (só
// entrega) e cancelado (com motivo). "entregue" só vem de concluir_pedido_externo,
// pelo botão "Concluir e receber".

export const EXTERNAL_ORDER_STATUS = {
  novo: "novo",
  preparo: "preparo",
  pronto: "pronto",
  saiu: "saiu",
  entregue: "entregue",
  cancelado: "cancelado",
} as const;

export type ExternalOrderStatus =
  (typeof EXTERNAL_ORDER_STATUS)[keyof typeof EXTERNAL_ORDER_STATUS];
export type ExternalOrderType = "entrega" | "retirada";

export const EXTERNAL_ORDER_STATUS_LABEL: Record<ExternalOrderStatus, string> = {
  novo: "Novo",
  preparo: "Em preparo",
  pronto: "Pronto",
  saiu: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

/** Colunas do quadro, na ordem do fluxo. "saiu" só recebe pedidos de entrega. */
export const EXTERNAL_ORDER_BOARD: readonly ExternalOrderStatus[] = [
  EXTERNAL_ORDER_STATUS.novo,
  EXTERNAL_ORDER_STATUS.preparo,
  EXTERNAL_ORDER_STATUS.pronto,
  EXTERNAL_ORDER_STATUS.saiu,
];

const ALL = Object.values(EXTERNAL_ORDER_STATUS) as string[];

/**
 * Status vindo do banco. Aceita os nomes antigos que o app já usou
 * ("em_preparo", "preparando") como "preparo"; desconhecido → null.
 */
export function parseExternalOrderStatus(value: unknown): ExternalOrderStatus | null {
  if (value === "em_preparo" || value === "preparando") return EXTERNAL_ORDER_STATUS.preparo;
  return typeof value === "string" && ALL.includes(value) ? (value as ExternalOrderStatus) : null;
}

export function isFinishedExternalOrder(status: ExternalOrderStatus) {
  return status === EXTERNAL_ORDER_STATUS.entregue || status === EXTERNAL_ORDER_STATUS.cancelado;
}

/**
 * Próxima etapa do botão "Avançar": novo → preparo → pronto → saiu (só entrega).
 * Retirada pronta e entrega que já saiu não avançam: só "Concluir e receber".
 */
export function nextExternalOrderStatus(
  status: ExternalOrderStatus,
  type: ExternalOrderType,
): ExternalOrderStatus | null {
  switch (status) {
    case EXTERNAL_ORDER_STATUS.novo:
      return EXTERNAL_ORDER_STATUS.preparo;
    case EXTERNAL_ORDER_STATUS.preparo:
      return EXTERNAL_ORDER_STATUS.pronto;
    case EXTERNAL_ORDER_STATUS.pronto:
      return type === "entrega" ? EXTERNAL_ORDER_STATUS.saiu : null;
    default:
      return null;
  }
}

/** O pedido aparece nesta coluna do quadro? ("Saiu" é só para entrega.) */
export function belongsToColumn(
  status: ExternalOrderStatus,
  type: ExternalOrderType,
  column: ExternalOrderStatus,
) {
  return status === column && (column !== EXTERNAL_ORDER_STATUS.saiu || type === "entrega");
}

/** Mensagens para a tela: nunca mostram nomes de funções, tabelas ou do banco. */
export const EXTERNAL_ORDER_MESSAGES = {
  statusFailed: "Não foi possível mudar o status do pedido. Tente novamente.",
  cancelFailed: "Não foi possível cancelar o pedido. Tente novamente.",
  cancelNeedsReason: "Informe o motivo do cancelamento.",
  completeFailed: "Não foi possível concluir o pedido. Confira o pagamento e tente novamente.",
  loadFailed: "Não foi possível carregar os pedidos. Verifique a internet e tente novamente.",
  liveFailed:
    "A atualização automática caiu. Os pedidos voltam a atualizar ao recarregar a página.",
  saveFailed: "Não foi possível salvar o pedido. Verifique a internet e tente novamente.",
  reprintFailed: (number: number) =>
    `Não foi possível reimprimir o pedido #${number}. Confira a impressora e tente novamente.`,
} as const;
