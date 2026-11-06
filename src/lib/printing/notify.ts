import { toast } from "sonner";
import { FRIENDLY_PRINT_ERROR, PrinterError } from "./transports/base";

/** Mensagem para a tela: nunca expõe detalhe técnico (esse fica no console). */
export function printErrorMessage(cause: unknown) {
  return cause instanceof PrinterError ? cause.message : FRIENDLY_PRINT_ERROR;
}

/**
 * Toast de falha de impressão com o botão "Reimprimir". O detalhe técnico já foi para o
 * console em printer.ts.
 */
export function avisarFalhaImpressao(
  cause: unknown,
  options: { id?: string; title?: string; onRetry?: () => void } = {},
) {
  const detail = printErrorMessage(cause);
  toast.error(options.title ?? FRIENDLY_PRINT_ERROR, {
    ...(options.id ? { id: options.id } : {}),
    duration: 12000,
    ...(detail !== (options.title ?? FRIENDLY_PRINT_ERROR) ? { description: detail } : {}),
    ...(options.onRetry ? { action: { label: "Reimprimir", onClick: options.onRetry } } : {}),
  });
}
