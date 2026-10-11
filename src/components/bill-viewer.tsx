import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { Plug, Printer, X } from "lucide-react";
import { brl, paymentMethodLabel, type Closing, type State } from "@/lib/store";
import {
  getPrinterStatus,
  initializePrinter,
  printReceipt,
  subscribePrinterStatus,
} from "@/lib/printing";

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
  const lines = receipt.lines;
  const restaurant = s.restaurant;
  const [printCount, setPrintCount] = useState(0);
  const [printError, setPrintError] = useState<string | null>(null);
  const printerStatus = useSyncExternalStore(
    subscribePrinterStatus,
    getPrinterStatus,
    getPrinterStatus,
  );
  const date = new Date(receipt.at);
  const dateText = date.toLocaleString("pt-BR");
  const waiters = [...new Set(lines.map((line) => line.waiter).filter(Boolean))].join(", ") || "—";
  const subtotal = receipt.subtotal;
  const serviceCharge = receipt.serviceCharge;
  const saleTotal = receipt.total;
  const saleNumber = String(receipt.saleNumber).padStart(4, "0");

  useEffect(() => {
    void initializePrinter();
  }, []);

  const doPrint = async () => {
    setPrintError(null);
    try {
      const result = await printReceipt(
        { ...receipt, reprint: isReprint || printCount > 0 },
        restaurant,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 print:static print:block print:bg-transparent">
      <div className="flex max-h-[90vh] w-[380px] flex-col overflow-hidden rounded-md border border-black/10 bg-white shadow-2xl print:max-h-none print:w-auto print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 bg-sidebar px-3 text-xs text-sidebar-foreground print:hidden">
          <span>Conta – Mesa {receipt.table}</span>
          <button
            aria-label="Fechar"
            onClick={onClose}
            className="rounded p-1 text-sidebar-foreground hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative z-10 flex h-9 shrink-0 items-center gap-1 border-b bg-card px-2">
          <button
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
        {printerStatus.error && (
          <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
            Impressão direta indisponível: {printerStatus.error}
          </p>
        )}
        {printError && (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            Não foi possível imprimir: {printError}
          </p>
        )}
        <div className="bill-viewer-scroll min-h-0 flex-1 overflow-y-auto p-5 print:overflow-visible print:bg-white print:p-0">
          <div id="cupom" className="bill-paper">
            {(isReprint || printCount > 0) && (
              <div
                className="bill-reprint"
                style={{
                  marginBottom: 10,
                  padding: "5px 0",
                  background: "#171717",
                  color: "#fff",
                  textAlign: "center",
                  fontWeight: 700,
                }}
              >
                2ª VIA · DATA ORIGINAL {dateText}
              </div>
            )}
            <header style={{ textAlign: "center" }}>
              {restaurant.logo && (
                <img
                  src={restaurant.logo}
                  alt=""
                  style={{
                    display: "block",
                    width: 48,
                    height: 48,
                    objectFit: "contain",
                    margin: "0 auto 5px",
                  }}
                />
              )}
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>
                {restaurant.name}
              </div>
              {restaurant.address && (
                <div style={{ marginTop: 4, fontSize: 10 }}>{restaurant.address}</div>
              )}
              {restaurant.phone && <div style={{ fontSize: 10 }}>{restaurant.phone}</div>}
              {restaurant.cnpj && <div style={{ fontSize: 10 }}>CNPJ: {restaurant.cnpj}</div>}
            </header>

            <div className="bill-dash" />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>CONTA DE CONSUMO</div>
              <div style={{ fontSize: 10 }}>Não é documento fiscal</div>
            </div>

            <div className="bill-dash" />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                alignItems: "start",
                gap: 8,
              }}
            >
              <strong style={{ fontSize: 15 }}>
                Mesa {String(receipt.table).padStart(2, "0")}
              </strong>
              <time style={{ textAlign: "right", fontSize: 10 }}>{dateText}</time>
            </div>
            <div style={{ marginTop: 5, fontSize: 10 }}>Atendido por: {waiters}</div>
            <div style={{ fontSize: 10 }}>Nº da venda: {saleNumber}</div>

            <div className="bill-dash" />
            <div
              className="bill-item-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "27px minmax(0, 1fr) 48px 56px",
                gap: 3,
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              <span>QTD</span>
              <span>DESCRIÇÃO</span>
              <span style={{ textAlign: "right" }}>UNIT.</span>
              <span style={{ textAlign: "right" }}>TOTAL</span>
            </div>
            <div style={{ marginTop: 4 }}>
              {lines.map((line) => (
                <div
                  key={line.id}
                  className="bill-item bill-item-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "27px minmax(0, 1fr) 48px 56px",
                    gap: 3,
                    alignItems: "start",
                    padding: "6px 0",
                    fontSize: 10,
                  }}
                >
                  <span>{line.qty}</span>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{line.name}</span>
                  <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {brl(line.price)}
                  </span>
                  <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {brl(line.qty * line.price)}
                  </span>
                </div>
              ))}
            </div>

            <div className="bill-dash" />
            <div
              className="bill-totals"
              style={{ display: "grid", gap: 4, justifyItems: "end", fontSize: 10 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <span>Subtotal</span>
                <span>{brl(subtotal)}</span>
              </div>
              {serviceCharge > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                  <span>Taxa de serviço</span>
                  <span>{brl(serviceCharge)}</span>
                </div>
              )}
              <div
                className="bill-total"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  marginTop: 5,
                  padding: "8px 7px",
                  background: "#111",
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                <span>TOTAL</span>
                <span>{brl(saleTotal)}</span>
              </div>
              {receipt.payments.length > 0 && (
                <div className="mt-2 w-full space-y-1 text-left">
                  {receipt.payments.map((payment, index) => (
                    <div key={`${payment.forma}-${index}`}>
                      <div className="flex justify-between">
                        <span>{paymentMethodLabel[payment.forma]}</span>
                        <span>{brl(payment.valor)}</span>
                      </div>
                      {payment.forma === "dinheiro" && payment.recebido !== undefined && (
                        <>
                          <div className="flex justify-between pl-2">
                            <span>Recebido</span>
                            <span>{brl(payment.recebido)}</span>
                          </div>
                          {payment.troco !== undefined && payment.troco > 0 && (
                            <div className="flex justify-between pl-2">
                              <span>Troco</span>
                              <span>{brl(payment.troco)}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bill-dash" />
            <footer style={{ textAlign: "center", fontSize: 11 }}>
              <div style={{ fontWeight: 700 }}>Obrigado pela preferência!</div>
              <div style={{ fontSize: 10 }}>Volte sempre</div>
              {(restaurant.instagram || restaurant.phone) && (
                <div style={{ marginTop: 4, fontSize: 10 }}>
                  {restaurant.instagram || restaurant.phone}
                </div>
              )}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
