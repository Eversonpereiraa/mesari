import type { CSSProperties } from "react";
import { brl, paymentMethodLabel } from "@/lib/store";
import type { PrintReceipt, PrintRestaurant } from "@/lib/printing";
import { splitShare } from "@/lib/split-share";
import { cpfCnpjLabel, displayCpfCnpj, displayPhone } from "@/lib/masks";
import defaultReceiptLogo from "@/assets/branding/logo-mesari-preto.png?url";

export function ReceiptContent({
  receipt,
  restaurant,
  via2,
  width,
}: {
  receipt: PrintReceipt;
  restaurant: PrintRestaurant;
  via2: boolean;
  width: 58 | 80;
}) {
  const dateText = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(receipt.at));
  const waiters =
    [...new Set(receipt.lines.map((line) => line.waiter).filter(Boolean))].join(", ") || "—";
  const narrow = width === 58;
  const isConference = receipt.kind === "conferencia";
  const share = isConference ? splitShare(receipt.total, receipt.splitCount) : null;
  const isDelivery = receipt.origin === "entrega" || receipt.origin === "retirada";
  const originLabel = receipt.origin === "retirada" ? "RETIRADA" : "ENTREGA";
  const receiptLocation = isDelivery
    ? `${originLabel}${receipt.customerName ? ` · ${receipt.customerName}` : ""}`
    : `Mesa ${String(receipt.table).padStart(2, "0")}`;

  return (
    <article
      className="receipt-paper"
      style={
        {
          "--receipt-paper-width": `${width * (96 / 25.4)}px`,
          "--receipt-print-width": `${width}mm`,
        } as CSSProperties
      }
    >
      {via2 && <div className="receipt-reprint">2ª VIA · DATA ORIGINAL {dateText}</div>}
      <header className="receipt-center">
        <img
          src={restaurant.logo || defaultReceiptLogo}
          alt="Logo Mesari"
          className="receipt-logo"
        />
        <div className="receipt-restaurant-name">{restaurant.name || "Mesari"}</div>
        {restaurant.address && (
          <div className="receipt-restaurant-detail">{restaurant.address}</div>
        )}
        {restaurant.phone && (
          <div className="receipt-restaurant-detail">{displayPhone(restaurant.phone)}</div>
        )}
        {restaurant.cnpj && (
          <div className="receipt-restaurant-detail">
            {cpfCnpjLabel(restaurant.cnpj)}: {displayCpfCnpj(restaurant.cnpj)}
          </div>
        )}
      </header>

      <div className="receipt-dash" />
      <div className="receipt-center">
        <div className="receipt-title">
          {isConference ? "CONFERÊNCIA DE CONSUMO" : "CONTA DE CONSUMO"}
        </div>
        <div className="receipt-small">Não é documento fiscal</div>
      </div>

      <div className="receipt-dash" />
      <div className="receipt-place-line">
        <strong className="receipt-place">{receiptLocation}</strong>
        <time className="receipt-date">{dateText}</time>
      </div>
      {isDelivery && receipt.customerPhone && (
        <div className="receipt-meta">Telefone: {receipt.customerPhone}</div>
      )}
      {isDelivery && receipt.customerAddress && (
        <div className="receipt-meta">Endereço: {receipt.customerAddress}</div>
      )}
      <div className="receipt-meta">Atendido por: {waiters}</div>
      {!isConference && (
        <div className="receipt-small">
          Nº da venda: {String(receipt.saleNumber).padStart(4, "0")}
        </div>
      )}

      <div className="receipt-dash" />
      {/* Em 58mm não cabe a coluna UNIT.: o preço unitário vai abaixo do item. */}
      <div className={narrow ? "receipt-items receipt-items-narrow" : "receipt-items"}>
        <div className="receipt-items-heading">
          <span>QTD</span>
          <span>DESCRIÇÃO</span>
          {!narrow && <span className="receipt-number">UNIT.</span>}
          <span className="receipt-number">TOTAL</span>
        </div>
        {receipt.lines.map((line) => (
          <div key={line.id} className="receipt-item">
            <span>{line.qty}</span>
            <span className="receipt-description">
              {line.name}
              {narrow && line.qty > 1 && (
                <span className="receipt-unit-price">{brl(line.price)} un.</span>
              )}
            </span>
            {!narrow && <span className="receipt-number">{brl(line.price)}</span>}
            <span className="receipt-number">{brl(line.qty * line.price)}</span>
          </div>
        ))}
      </div>

      <div className="receipt-dash" />
      <div className="receipt-totals">
        <div className="receipt-total-line">
          <span>Subtotal</span>
          <span>{brl(receipt.subtotal)}</span>
        </div>
        {receipt.serviceCharge > 0 && (
          <div className="receipt-total-line">
            <span>Taxa de serviço</span>
            <span>{brl(receipt.serviceCharge)}</span>
          </div>
        )}
        {receipt.origin === "entrega" && (receipt.deliveryFee ?? 0) > 0 && (
          <div className="receipt-total-line">
            <span>Taxa de entrega</span>
            <span>{brl(receipt.deliveryFee ?? 0)}</span>
          </div>
        )}
        {(receipt.discount ?? 0) > 0 && (
          <div className="receipt-total-line">
            <span>Desconto</span>
            <span>-{brl(receipt.discount ?? 0)}</span>
          </div>
        )}
        <div className="receipt-grand-total">
          <span>TOTAL</span>
          <span>{brl(receipt.total)}</span>
        </div>
        {share && (
          <div className="receipt-split">
            Dividido por {share.people} pessoas: {brl(share.each)} cada
          </div>
        )}
        {!isConference && (receipt.payments ?? []).length > 0 && (
          <div className="receipt-payments">
            {receipt.payments?.map((payment, index) => (
              <div key={`${payment.forma}-${index}`}>
                <div className="receipt-total-line">
                  <span>{paymentMethodLabel[payment.forma]}</span>
                  <span>{brl(payment.valor)}</span>
                </div>
                {payment.forma === "dinheiro" && payment.recebido !== undefined && (
                  <>
                    <div className="receipt-total-line receipt-payment-detail">
                      <span>Recebido</span>
                      <span>{brl(payment.recebido)}</span>
                    </div>
                    {payment.troco !== undefined && payment.troco > 0 && (
                      <div className="receipt-total-line receipt-payment-detail">
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

      <div className="receipt-dash" />
      <footer className="receipt-thanks">
        {isConference ? (
          <div>
            <strong>Confira seu pedido antes de pagar</strong>
          </div>
        ) : (
          <>
            <div>
              <strong>Obrigado pela preferência!</strong>
            </div>
            <div className="receipt-thanks-small">Volte sempre</div>
          </>
        )}
        <div className="receipt-thanks-small">{restaurant.instagram || "@mesari"}</div>
      </footer>
    </article>
  );
}
