import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { actions, useStore } from "@/lib/store";
import { AppShell, Btn, Check, Field } from "@/components/ui-kit";

export const Route = createFileRoute("/impressao")({
  head: () => ({
    meta: [
      { title: "Configurações de impressão | Mesari" },
      { name: "description", content: "Impressora, comanda da cozinha e conta do cliente." },
      { property: "og:title", content: "Configurações de impressão | Mesari" },
      { property: "og:description", content: "Impressora, comanda da cozinha e conta do cliente." },
    ],
  }),
  component: Impressao,
});

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[200px_1fr] gap-6 border-b py-5 last:border-0">
      <div>
        <div className="text-xs text-muted-foreground">Seção {n}</div>
        <h2 className="font-semibold text-ink">{title}</h2>
      </div>
      <div>{children}</div>
    </section>
  );
}

function Impressao() {
  const p = useStore((s) => s.print);
  const u = actions.updatePrint;
  const connect = () => {
    const name = prompt("Nome da impressora Bluetooth", p.printer || "POS-58 BT");
    if (name) u({ connected: true, printer: name });
  };
  return (
    <AppShell center="Configurações de Impressão">
      <div className="mx-auto max-w-3xl p-5">
        <div className="rounded-lg border bg-card px-6">
          <Section n={1} title="Impressora">
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${p.connected ? "bg-free-bg text-free" : "bg-bill-bg text-bill"}`}>
                  {p.connected ? "Conectada" : "Não conectada"}
                </span>
                <div className="mt-2 text-sm text-ink">{p.printer || "Nenhuma impressora configurada"}</div>
                <div className="text-xs text-muted-foreground">Conexão via Bluetooth</div>
              </div>
              <Btn variant={p.connected ? "outline" : "primary"} onClick={connect}>
                {p.connected ? "Trocar Impressora" : "Conectar Impressora"}
              </Btn>
            </div>
          </Section>
          <Section n={2} title="O que imprimir">
            <Check label="Imprimir comanda da cozinha" checked={p.kitchen} onChange={(v) => u({ kitchen: v })} />
            <Check label="Imprimir conta do cliente" checked={p.bill} onChange={(v) => u({ bill: v })} />
          </Section>
          <Section n={3} title="Comanda da cozinha">
            <Check label="Mostrar número da mesa" checked={p.kTable} onChange={(v) => u({ kTable: v })} />
            <Check label="Mostrar horário do pedido" checked={p.kTime} onChange={(v) => u({ kTime: v })} />
            <Check label="Mostrar observações" checked={p.kNotes} onChange={(v) => u({ kNotes: v })} />
            <Check label="Mostrar nome do garçom" checked={p.kWaiter} onChange={(v) => u({ kWaiter: v })} />
          </Section>
          <Section n={4} title="Conta do cliente">
            <Check label="Mostrar nome do restaurante" checked={p.bName} onChange={(v) => u({ bName: v })} />
            <Check label="Mostrar data e horário" checked={p.bDate} onChange={(v) => u({ bDate: v })} />
            <Check label="Mostrar itens detalhados" checked={p.bItems} onChange={(v) => u({ bItems: v })} />
            <Check label="Mostrar total" checked={p.bTotal} onChange={(v) => u({ bTotal: v })} />
            <div className="mt-3">
              <Field label="Mensagem de rodapé">
                <input className="field" value={p.footer} onChange={(e) => u({ footer: e.target.value })} />
              </Field>
            </div>
          </Section>
          <Section n={5} title="Teste">
            <Btn variant="neutral" disabled={!p.connected} onClick={() => alert(`Página de teste enviada para ${p.printer}.`)}>
              Imprimir Página de Teste
            </Btn>
            {!p.connected && <p className="mt-2 text-xs text-muted-foreground">Conecte uma impressora para imprimir o teste.</p>}
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
