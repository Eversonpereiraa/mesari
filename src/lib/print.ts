import { brl, total, type State } from "./store";

export function printBill(s: State, tableId: string) {
  const t = s.tables.find((x) => x.id === tableId);
  const lines = s.orders[tableId] ?? [];
  const p = s.print;
  const rows = lines.map((l) => `<tr><td>${l.qty}x ${l.name}</td><td style="text-align:right">${brl(l.qty * l.price)}</td></tr>`).join("");
  const html = `<html><head><title>Conta Mesa ${t?.number}</title><style>
    body{font-family:monospace;width:280px;margin:10px auto;font-size:12px}
    h1{font-size:14px;text-align:center;margin:0 0 4px} table{width:100%;border-collapse:collapse}
    hr{border:0;border-top:1px dashed #000}.c{text-align:center}</style></head><body>
    ${p.bName ? `<h1>${s.restaurant.name}</h1><div class="c">${s.restaurant.address}</div>` : ""}
    <hr/><div>Mesa ${t?.number}</div>${p.bDate ? `<div>${new Date().toLocaleString("pt-BR")}</div>` : ""}<hr/>
    ${p.bItems ? `<table>${rows}</table><hr/>` : ""}
    ${p.bTotal ? `<table><tr><td><b>TOTAL</b></td><td style="text-align:right"><b>${brl(total(lines))}</b></td></tr></table><hr/>` : ""}
    <div class="c">${p.footer}</div></body></html>`;
  const w = window.open("", "_blank", "width=360,height=600");
  if (!w) return;
  w.document.write(html); w.document.close(); w.focus(); w.print();
}
