import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { actions, useStore } from "@/lib/store";
import { Btn, Field } from "@/components/ui-kit";
import { PasswordInput, UsernameInput } from "@/components/inputs";
import { loginUsername } from "@/lib/masks";
import { MesariLogo } from "@/components/mesari-logo";

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
  const configured = useStore((s) => s.configured);
  const storeError = useStore((s) => s.error);
  const nav = useNavigate();
  const [u, setU] = useState("");
  const [c, setC] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const username = loginUsername(u);
    const role = await actions.login(username, c);
    if (!role) {
      setErr("Não foi possível autenticar o usuário.");
      return;
    }
    nav({
      to:
        role === "cozinha" || username === "cozinha"
          ? "/cozinha"
          : role === "garcom"
            ? "/garcom"
            : "/caixa",
    });
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border bg-card p-7">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <MesariLogo variant="vertical" className="h-32 w-[210px] rounded-lg" />
          <div className="text-xs text-muted-foreground">Sistema de comandas</div>
        </div>
        <div className="space-y-4">
          <Field label="Nome de usuário">
            <UsernameInput mode="login" autoFocus value={u} onChange={setU} />
          </Field>
          <Field label="Senha">
            <PasswordInput
              mode="current"
              className="num tracking-widest"
              inputMode="numeric"
              value={c}
              onChange={setC}
            />
          </Field>
          {(!configured || err || storeError) && (
            <p role="alert" className="text-sm text-destructive">
              {storeError ?? err ?? "Configure a conexão Supabase antes de entrar."}
            </p>
          )}
          <Btn type="submit" size="lg" className="w-full">
            Entrar
          </Btn>
        </div>
      </form>
    </div>
  );
}
