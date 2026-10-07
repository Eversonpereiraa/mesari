import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { actions, useStore } from "@/lib/store";
import { AppShell, Btn, Field } from "@/components/ui-kit";

export const Route = createFileRoute("/restaurante")({
  head: () => ({
    meta: [
      { title: "Dados do restaurante | Mesari" },
      { name: "description", content: "Nome, telefone, endereço e logo do restaurante." },
      { property: "og:title", content: "Dados do restaurante | Mesari" },
      { property: "og:description", content: "Nome, telefone, endereço e logo do restaurante." },
    ],
  }),
  component: Restaurante,
});

function Restaurante() {
  const r = useStore((s) => s.restaurant);
  const [f, setF] = useState(r);
  const [ok, setOk] = useState(false);
  useEffect(() => setF(r), [r]);

  const onLogo = (file?: File) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => setF((x) => ({ ...x, logo: String(rd.result) }));
    rd.readAsDataURL(file);
  };

  return (
    <AppShell center="Configurações do Restaurante">
      <div className="mx-auto max-w-xl p-5">
        <form className="space-y-4 rounded-lg border bg-card p-6"
          onSubmit={(e) => { e.preventDefault(); actions.updateRestaurant(f); setOk(true); setTimeout(() => setOk(false), 2000); }}>
          <Field label="Nome do restaurante"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Telefone"><input className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Endereço"><input className="field" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Logo" hint="PNG ou JPG, até 1 MB.">
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md border bg-background text-xs text-muted-foreground">
                {f.logo ? <img src={f.logo} alt="Logo" className="h-full w-full object-contain" /> : "—"}
              </div>
              <input type="file" accept="image/*" className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink"
                onChange={(e) => onLogo(e.target.files?.[0])} />
            </div>
          </Field>
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            {ok && <span className="text-sm text-free">Dados salvos.</span>}
            <Btn type="submit" variant="success">Salvar</Btn>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
