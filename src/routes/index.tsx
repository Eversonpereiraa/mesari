import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { actions, useStore } from "@/lib/store";
import { Btn, Field, Mark } from "@/components/ui-kit";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Entrar — Mesari Comandas" },
      { name: "description", content: "Acesso ao sistema de comandas digitais Mesari." },
      { property: "og:title", content: "Entrar — Mesari Comandas" },
      { property: "og:description", content: "Acesso ao sistema de comandas digitais Mesari." },
    ],
  }),
  component: Login,
});

function Login() {
  const name = useStore((s) => s.restaurant.name);
  const nav = useNavigate();
  const [u, setU] = useState("");
  const [c, setC] = useState("");
  const [err, setErr] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!actions.login(u, c)) { setErr("Usuário ou código de acesso inválido."); return; }
    nav({ to: u.trim().toLowerCase() === "garcom" ? "/garcom" : "/caixa" });
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border bg-card p-7">
        <div className="mb-7 flex items-center gap-3">
          <Mark className="h-9 w-9" />
          <div>
            <div className="text-lg font-semibold tracking-wide text-ink">{name.toUpperCase()}</div>
            <div className="text-xs text-muted-foreground">Sistema de comandas</div>
          </div>
        </div>
        <div className="space-y-4">
          <Field label="Nome de usuário">
            <input className="field" autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
          </Field>
          <Field label="Código de acesso">
            <input className="field num tracking-widest" type="password" inputMode="numeric" autoComplete="current-password" value={c} onChange={(e) => setC(e.target.value)} />
          </Field>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Btn type="submit" size="lg" className="w-full">Entrar</Btn>
        </div>
      </form>
    </div>
  );
}
