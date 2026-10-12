import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { Plug, Printer, X } from "lucide-react";
import type { Closing, State } from "@/lib/store";
import {
  getPrinterStatus,
  getPrintSettings,
  initializePrinter,
  printReceipt,
  subscribePrinterStatus,
} from "@/lib/printing";
import { ReceiptContent } from "@/components/receipt-content";

export function BillViewer({
  s,
  receipt,
  onClose,
  isReprint = false,
}: {
  s: State;
  receipt: Closing;
  onClose: () => void;
  isReprint?: boolean;
}) {
  const restaurant = { ...s.restaurant, logo: s.restaurant.logo };
  const [printCount, setPrintCount] = useState(0);
  const [printError, setPrintError] = useState<string | null>(null);
  const printerStatus = useSyncExternalStore(
    subscribePrinterStatus,
    getPrinterStatus,
    getPrinterStatus,
  );
  const receiptOrigin =
    receipt.origin === "entrega" || receipt.origin === "retirada" ? receipt.origin : "mesa";
  const receiptLocation =
    receiptOrigin === "mesa"
      ? `Mesa ${String(receipt.table).padStart(2, "0")}`
      : `${receiptOrigin === "entrega" ? "Entrega" : "Retirada"}${receipt.customerName ? ` - ${receipt.customerName}` : ""}`;

  useEffect(() => {
    const body = document.body;
    void initializePrinter();
    body.style.pointerEvents = "";
    body.style.overflow = "hidden";
    return () => {
      body.style.pointerEvents = "";
      body.style.overflow = "";
    };
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  const doPrint = async () => {
    setPrintError(null);
    try {
      const result = await printReceipt(
        { ...receipt, reprint: isReprint || printCount > 0 },
        restaurant,
        getPrintSettings(),
      );
      if (result.method === "browser") {
        setPrintError(
          result.fallbackReason
            ? `Impressora direta indisponível; usando a impressão do Windows. ${result.fallbackReason}`
            : "Imprimindo pelo Windows (impressora padrão).",
        );
      }
      setPrintCount((count) => count + 1);
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/35 p-3 print:static print:block print:bg-transparent print:p-0"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Conta – ${receiptLocation}`}
        className="bill-viewer-dialog flex w-full max-w-[380px] flex-col overflow-hidden rounded-md border border-black/10 bg-white shadow-2xl print:max-h-none print:w-auto print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
      >
        <div className="sticky top-0 z-30 shrink-0 border-b border-white/10 bg-sidebar text-xs text-sidebar-foreground print:hidden">
          <div className="flex min-h-11 items-center justify-between px-3">
            <span>Conta – {receiptLocation}</span>
            <button
              type="button"
              aria-label="Fechar"
              onClick={handleClose}
              className="flex min-h-10 min-w-10 items-center justify-center rounded text-sidebar-foreground hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="relative z-10 flex h-9 shrink-0 items-center gap-1 border-t border-white/10 bg-card px-2 text-foreground">
            <button
              type="button"
              title="Imprimir"
              aria-label="Imprimir nota"
              onClick={doPrint}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-ink"
            >
              <Printer className="h-3.5 w-3.5" />
            </button>
            <Link
              to="/impressao"
              title="Conectar impressora"
              aria-label="Conectar impressora"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-ink"
            >
              <Plug className="h-3.5 w-3.5" />
            </Link>
            <span className="ml-1 truncate text-[11px] text-muted-foreground">
              {printerStatus.connected ? printerStatus.name : "Impressão pelo navegador"}
            </span>
          </div>
          {!printerStatus.connected && (
            <p role="status" className="pointer-events-none px-3 py-2 text-xs text-amber-800">
              Impressora desconectada. Você pode imprimir pelo navegador ou fechar esta nota.
            </p>
          )}
          {printerStatus.error && (
            <p
              role="status"
              className="pointer-events-none px-3 py-1 text-xs text-muted-foreground"
            >
              Impressão direta indisponível: {printerStatus.error}
            </p>
          )}
          {printError && (
            <p role="alert" className="pointer-events-none px-3 py-2 text-xs text-destructive">
              Não foi possível imprimir: {printError}
            </p>
          )}
        </div>
        <div className="bill-viewer-scroll min-h-0 flex-1 overflow-y-auto p-5 print:overflow-visible print:bg-white print:p-0">
          <ReceiptContent
            receipt={receipt}
            restaurant={restaurant}
            via2={isReprint || printCount > 0}
            width={getPrintSettings().paperWidth}
          />
        </div>
        <footer className="sticky bottom-0 z-30 flex shrink-0 justify-end border-t bg-white p-2 print:hidden">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-10 rounded-md border px-4 text-sm font-semibold text-ink hover:bg-muted"
          >
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
