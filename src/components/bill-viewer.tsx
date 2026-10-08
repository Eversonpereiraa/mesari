import { useEffect, useRef, useState } from "react";
import { Plug, Printer, X } from "lucide-react";
import { brl, total, type State } from "@/lib/store";

const PKEY = "mesari-printer";

export function BillViewer({ s, tableId, onClose }: { s: State; tableId: string; onClose: () => void }) {
  const t = s.tables.find((x) => x.id === tableId);
  const lines = s.orders[tableId] ?? [];
  const p = s.print;
  const [qz, setQz] = useState<any>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState<string>("");
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = useRef(new Date()).current;

  useEffect(() => {
    setPrinter(localStorage.getItem(PKEY) ?? "");
    let alive = true;
    (async () => {
      try {
        const mod: any = (await import("qz-tray")).default;
        if (!mod.websocket.isActive()) await mod.websocket.connect({ retries: 0 });
        const list: string[] = await mod.printers.find();
        if (!alive) return;
        setQz(mod); setPrinters(list); setOk(true);
      } catch { if (alive) setOk(false); }
    })();
    return () => { alive = false; };
  }, []);

  const pick = (n: string) => { setPrinter(n); localStorage.setItem(PKEY, n); setMenu(false); };

  const doPrint = async () => {
    if (qz && ok && printer && ref.current) {
      try {
        const cfg = qz.configs.create(printer, { margins: 0, size: { width: 80, height: null }, units: "mm" });
        const html = `<html><body style="margin:0;font-family:monospace;font-size:12px;width:72mm">${ref.current.innerHTML}</body></html>`;
        await qz.print(cfg, [{ type: "pixel", format: "html", flavor: "plain", data: html }]);
        return;
      } catch { /* fall back */ }
    }
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 print:static print:block print:bg-transparent">
      <div className="flex max-h-[90vh] w-[380px] flex-col overflow-hidden rounded-md border bg-card shadow-xl print:max-h-none print:w-auto print:border-0 print:shadow-none">
        <div className="flex h-8 items-center justify-between border-b px-3 text-xs text-ink print:hidden">
          <span>Conta – Mesa {t?.number}</span>
          <button aria-label="Fechar" onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="relative flex h-7 items-center gap-1 border-b px-2 print:hidden">
          <button title="Imprimir" onClick={doPrint} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-ink"><Printer className="h-3.5 w-3.5" /></button>
          <button title="Conectar impressora" onClick={() => setMenu((m) => !m)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-ink"><Plug className="h-3.5 w-3.5" /></button>
          <span className="ml-1 truncate text-[11px] text-muted-foreground">{printer || "Nenhuma impressora"}</span>
          {menu && (
            <div className="absolute left-2 top-7 z-10 min-w-48 rounded-md border bg-card py-1 text-xs shadow-lg">
              {printers.length === 0 && <div className="px-3 py-1.5 text-muted-foreground">{ok === null ? "Procurando…" : "Nenhuma impressora encontrada"}</div>}
              {printers.map((n) => (
                <button key={n} onClick={() => pick(n)} className={`block w-full px-3 py-1.5 text-left hover:bg-muted ${n === printer ? "font-semibold text-ink" : "text-foreground"}`}>{n}</button>
              ))}
            </div>
          )}
        </div>
        {ok === false && (
          <div className="border-b bg-muted px-3 py-1 text-[11px] text-muted-foreground print:hidden">
            Instale o QZ Tray para listar impressoras —{" "}
            <a href="https://qz.io/download" target="_blank" rel="noreferrer" className="underline">qz.io/download</a>
          </div>
        )}
        <div className="overflow-y-auto bg-muted p-4 print:overflow-visible print:bg-transparent print:p-0">
          <div id="cupom" ref={ref} className="mx-auto w-[302px] bg-background p-3 font-mono text-[12px] leading-snug text-ink shadow-sm print:w-[80mm] print:shadow-none">
            {p.bName && (<div style={{ textAlign: "center" }}><div style={{ fontWeight: 700, fontSize: 14 }}>{s.restaurant.name}</div><div>{s.restaurant.address}</div></div>)}
            <div style={{ borderTop: "1px dashed", margin: "6px 0" }} />
            <div>Mesa {String(t?.number ?? "").padStart(2, "0")}</div>
            {p.bDate && <div>{now.toLocaleString("pt-BR")}</div>}
            <div style={{ borderTop: "1px dashed", margin: "6px 0" }} />
            {p.bItems && lines.map((l) => (
              <div key={l.id} style={{ marginBottom: 4 }}>
                <div>{l.qty} x {l.name}</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>{brl(l.price)}</span><span>{brl(l.qty * l.price)}</span></div>
                {l.note && <div>Obs.: {l.note}</div>}
              </div>
            ))}
            {p.bTotal && (<><div style={{ borderTop: "1px dashed", margin: "6px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16 }}><span>TOTAL</span><span>{brl(total(lines))}</span></div></>)}
            <div style={{ borderTop: "1px dashed", margin: "6px 0" }} />
            <div style={{ textAlign: "center" }}>{p.footer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
