import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { actions, refreshData, useStore, type StaffMember } from "@/lib/store";
import { AppShell, Btn, Field } from "@/components/ui-kit";
import { useConfirm } from "@/components/system-dialog-provider";
import { supabase } from "@/lib/supabase";
import { DEFAULT_FOOTER, LOGO_DETAIL_WARNING, processLogoFile } from "@/lib/printing";
import { MaskedInput, MoneyInput } from "@/components/masked-input";
import {
  cleanName,
  decimalInput,
  formatInstagram,
  maskError,
  onlyDigits,
  parseDecimal,
  phoneDigits,
  roundMoney,
} from "@/lib/masks";

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
  const confirmar = useConfirm();
  const r = useStore((s) => s.restaurant);
  const staff = useStore((s) => s.staff);
  const role = useStore((s) => s.user?.role);
  const [f, setF] = useState(r);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(0);
  const [percentDraft, setPercentDraft] = useState(decimalInput(r.serviceChargePercent));
  const [ok, setOk] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [printLogoWarning, setPrintLogoWarning] = useState("");
  const [printLogoBusy, setPrintLogoBusy] = useState(false);
  const [tab, setTab] = useState<"dados" | "equipe">("dados");
  const [staffDraft, setStaffDraft] = useState<Partial<StaffMember> | null>(null);
  const [staffError, setStaffError] = useState("");
  const [passwordResetStaff, setPasswordResetStaff] = useState<StaffMember | null>(null);
  const [passwordResetDraft, setPasswordResetDraft] = useState("");
  const [passwordResetError, setPasswordResetError] = useState("");
  useEffect(() => setF(r), [r]);
  // Logo antigo guardado em base64 no banco: vai para o Storage na primeira abertura do caixa.
  const logoMigrated = useRef(false);
  useEffect(() => {
    if (role !== "caixa" || !r.logo.startsWith("data:") || logoMigrated.current) return;
    logoMigrated.current = true;
    void actions.migrateLogo().catch(() => undefined);
  }, [role, r.logo]);
  useEffect(() => setDeliveryFee(roundMoney(Number(r.deliveryFee || 0))), [r.deliveryFee]);
  useEffect(() => setPercentDraft(decimalInput(r.serviceChargePercent)), [r.serviceChargePercent]);

  const onLogo = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSaveError("Escolha uma imagem (PNG, JPG ou WebP).");
      return;
    }
    setSaveError("");
    const rd = new FileReader();
    rd.onload = () => setF((x) => ({ ...x, logo: String(rd.result) }));
    rd.readAsDataURL(file);
  };

  /** Processa uma vez (cinza, contraste, 384 x 200, 1 bit) e guarda o PNG ao salvar. */
  const onPrintLogo = async (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setSaveError("Escolha uma imagem PNG ou JPG para a logo de impressão.");
      return;
    }
    setSaveError("");
    setPrintLogoBusy(true);
    try {
      const processed = await processLogoFile(file);
      setF((x) => ({ ...x, printLogo: processed.dataUrl, printLogoEnabled: true }));
      setPrintLogoWarning(processed.detailed ? LOGO_DETAIL_WARNING : "");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPrintLogoBusy(false);
    }
  };

  const saveStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = cleanName(staffDraft?.name ?? "");
    const username = staffDraft?.username ?? "";
    const password = staffDraft?.password ?? "";
    if (!name) {
      setStaffError("Nome obrigatório.");
      return;
    }
    if (
      username.length < 3 ||
      username.length > 30 ||
      username !== username.toLowerCase() ||
      /\s/.test(username)
    ) {
      setStaffError("O usuário deve ter de 3 a 30 caracteres, em minúsculas e sem espaços.");
      return;
    }
    if (!staffDraft?.id && password.length < 6) {
      setStaffError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    try {
      await actions.saveStaff({
        id: staffDraft.id,
        name,
        username,
        password: staffDraft.id ? "" : password,
      });
      setStaffDraft(null);
      setStaffError("");
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : String(error));
    }
  };

  const resetStaffPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordResetDraft.length < 6) {
      setPasswordResetError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (!passwordResetStaff) return;
    try {
      await actions.resetStaffPassword(passwordResetStaff.username, passwordResetDraft);
      setPasswordResetStaff(null);
      setPasswordResetDraft("");
      setPasswordResetError("");
    } catch (error) {
      setPasswordResetError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <AppShell center="Configurações do Restaurante">
      <div className="mx-auto max-w-3xl p-5">
        <div
          role="tablist"
          aria-label="Configurações do restaurante"
          className="mb-5 inline-flex rounded-xl border bg-card p-1"
        >
          <button
            role="tab"
            aria-selected={tab === "dados"}
            onClick={() => setTab("dados")}
            className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${tab === "dados" ? "bg-primary text-white" : "text-muted-foreground hover:text-ink"}`}
          >
            Dados do restaurante
          </button>
          {role === "caixa" && (
            <button
              role="tab"
              aria-selected={tab === "equipe"}
              onClick={() => setTab("equipe")}
              className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${tab === "equipe" ? "bg-primary text-white" : "text-muted-foreground hover:text-ink"}`}
            >
              Equipe
            </button>
          )}
        </div>
        {tab === "dados" || role !== "caixa" ? (
          <form
            className="space-y-4 rounded-lg border bg-card p-6"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaveError("");
              const parsedFee = roundMoney(deliveryFee ?? 0);
              const invalid = maskError("phone", f.phone) || maskError("cpfCnpj", f.cnpj);
              if (invalid) {
                setSaveError(invalid);
                return;
              }
              try {
                // Banco: telefone e CPF/CNPJ só com dígitos.
                await actions.updateRestaurant({
                  ...f,
                  name: cleanName(f.name),
                  phone: phoneDigits(f.phone),
                  cnpj: onlyDigits(f.cnpj),
                  instagram: formatInstagram(f.instagram),
                });
                const { error } = await supabase.rpc("definir_taxa_entrega", {
                  p_valor: parsedFee,
                });
                if (error) throw error;
                await refreshData(["base"]);
                setOk(true);
                setTimeout(() => setOk(false), 2000);
              } catch (cause) {
                setSaveError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <Field label="Nome do restaurante">
              <MaskedInput
                mask="name"
                autoComplete="organization"
                value={f.name}
                onValueChange={(name) => setF((x) => ({ ...x, name }))}
              />
            </Field>
            <Field label="Telefone">
              <MaskedInput
                mask="phone"
                value={f.phone}
                onValueChange={(phone) => setF((x) => ({ ...x, phone }))}
              />
            </Field>
            <Field
              label="Endereço"
              hint="Sai na conta em até duas linhas: rua, número e bairro na primeira; cidade, UF e CEP na segunda."
            >
              <textarea
                className="field min-h-[4.5rem]"
                rows={2}
                maxLength={200}
                autoComplete="street-address"
                value={f.address}
                onChange={(e) => setF({ ...f, address: e.target.value })}
              />
            </Field>
            <Field label="CNPJ ou CPF">
              <MaskedInput
                mask="cpfCnpj"
                value={f.cnpj}
                onValueChange={(cnpj) => setF((x) => ({ ...x, cnpj }))}
              />
            </Field>
            <Field
              label="Instagram"
              hint="Opcional. Será exibido no rodapé do cupom em vez do telefone."
            >
              <MaskedInput
                mask="instagram"
                maxLength={31}
                value={f.instagram}
                onValueChange={(instagram) => setF((x) => ({ ...x, instagram }))}
              />
            </Field>
            <div className="space-y-3 border-t pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={f.serviceChargeEnabled}
                  onChange={(e) => setF({ ...f, serviceChargeEnabled: e.target.checked })}
                />
                Cobrar taxa de serviço
              </label>
              <Field label="Percentual da taxa de serviço">
                <div className="relative">
                  <MaskedInput
                    mask="percent"
                    className="field pr-10"
                    aria-label="Percentual da taxa de serviço"
                    placeholder="10"
                    disabled={!f.serviceChargeEnabled}
                    value={percentDraft}
                    onValueChange={(value) => {
                      setPercentDraft(value);
                      setF((x) => ({ ...x, serviceChargePercent: parseDecimal(value) ?? 0 }));
                    }}
                  />
                  <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">%</span>
                </div>
                <Field
                  label="Taxa de entrega (R$)"
                  hint="Valor fixo somado a todos os pedidos de entrega. Retirada não paga taxa."
                >
                  <MoneyInput
                    aria-label="Taxa de entrega"
                    value={deliveryFee}
                    onValueChange={setDeliveryFee}
                  />
                </Field>
              </Field>
            </div>
            <Field label="Logo" hint="PNG, JPG ou WebP. É reduzido para 400 px ao salvar.">
              <div className="flex items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md border bg-background text-xs text-muted-foreground">
                  {f.logo ? (
                    <img src={f.logo} alt="Logo" className="h-full w-full object-contain" />
                  ) : (
                    "—"
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink"
                  onChange={(e) => onLogo(e.target.files?.[0])}
                />
              </div>
            </Field>
            {r.printSettingsAvailable ? (
              <div className="space-y-4 border-t pt-4">
                <Field
                  label="Logo para impressão"
                  hint="PNG ou JPG. Vira preto e branco, até 48 mm de largura. Sai na conta e na comanda de delivery (não na comanda de cozinha)."
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="grid h-20 w-40 shrink-0 place-items-center overflow-hidden rounded-md border bg-white p-1 text-xs text-muted-foreground">
                      {f.printLogo ? (
                        <img
                          src={f.printLogo}
                          alt="Prévia da logo impressa"
                          className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
                        />
                      ) : (
                        "Sem logo"
                      )}
                    </div>
                    <div className="space-y-2">
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        aria-label="Logo para impressão"
                        disabled={printLogoBusy}
                        className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink"
                        onChange={(e) => void onPrintLogo(e.target.files?.[0])}
                      />
                      {f.printLogo && (
                        <button
                          type="button"
                          className="block text-sm text-destructive hover:underline"
                          onClick={() => {
                            setF({ ...f, printLogo: "", printLogoEnabled: false });
                            setPrintLogoWarning("");
                          }}
                        >
                          Remover logo de impressão
                        </button>
                      )}
                    </div>
                  </div>
                  {printLogoBusy && (
                    <p className="mt-2 text-sm text-muted-foreground">Processando a logo…</p>
                  )}
                  {printLogoWarning && (
                    <p role="status" className="mt-2 text-sm text-amber-700">
                      {printLogoWarning}
                    </p>
                  )}
                </Field>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    disabled={!f.printLogo}
                    checked={f.printLogoEnabled && Boolean(f.printLogo)}
                    onChange={(e) => setF({ ...f, printLogoEnabled: e.target.checked })}
                  />
                  Imprimir logo nas comandas
                </label>
                <Field
                  label="Mensagem de rodapé da conta"
                  hint="Cada linha sai centralizada no fim da conta."
                >
                  <textarea
                    className="field min-h-[4.5rem]"
                    rows={2}
                    maxLength={300}
                    placeholder={DEFAULT_FOOTER}
                    value={f.receiptFooter || DEFAULT_FOOTER}
                    onChange={(e) => setF({ ...f, receiptFooter: e.target.value })}
                  />
                </Field>
              </div>
            ) : (
              <p className="border-t pt-4 text-sm text-muted-foreground">
                Logo para impressão e rodapé da conta ficam disponíveis depois que o banco de dados
                for atualizado (migration 202611060001_logo_impressao).
              </p>
            )}
            <div className="flex items-center justify-end gap-3 border-t pt-4">
              {saveError && (
                <span role="alert" className="text-sm text-destructive">
                  {saveError}
                </span>
              )}
              {ok && <span className="text-sm text-free">Dados salvos.</span>}
              <Btn type="submit" variant="success">
                Salvar
              </Btn>
            </div>
          </form>
        ) : (
          <section className="overflow-hidden rounded-[14px] border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b p-5">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">Equipe</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Gerencie os acessos do app do garçom.
                </p>
              </div>
              <Btn
                onClick={() => {
                  setStaffDraft({ name: "", username: "", password: "" });
                  setStaffError("");
                }}
              >
                <Plus className="h-4 w-4" />
                Adicionar garçom
              </Btn>
            </div>
            <div className="divide-y">
              {staff.map((person) => (
                <div key={person.id} className="flex items-center gap-3 px-5 py-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-primary">
                    <Users className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">{person.name}</div>
                    <div className="truncate text-sm text-muted-foreground">@{person.username}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordResetStaff(person);
                      setPasswordResetDraft("");
                      setPasswordResetError("");
                    }}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
                  >
                    Redefinir senha
                  </button>
                  <button
                    type="button"
                    aria-label={`Editar ${person.name}`}
                    onClick={() => {
                      setStaffDraft({
                        id: person.id,
                        name: person.name,
                        username: person.username,
                        password: "",
                      });
                      setStaffError("");
                    }}
                    className="grid h-10 w-10 place-items-center rounded-lg text-primary hover:bg-accent"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir ${person.name}`}
                    onClick={async () => {
                      if (
                        await confirmar({
                          title: "Excluir acesso?",
                          description: `Remover o acesso de ${person.name}?`,
                          confirmText: "Excluir acesso",
                          variant: "danger",
                        })
                      ) {
                        await actions.deleteStaff(person.id);
                      }
                    }}
                    className="grid h-10 w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {staff.length === 0 && (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Nenhum garçom cadastrado.
                </div>
              )}
            </div>
          </section>
        )}
      </div>
      {staffDraft && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setStaffDraft(null)}
        >
          <form
            onSubmit={saveStaff}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-[14px] border bg-card p-6 shadow-2xl"
          >
            <h2 className="font-display text-xl font-bold text-ink">
              {staffDraft.id ? "Editar garçom" : "Novo garçom"}
            </h2>
            <Field label="Nome">
              <MaskedInput
                mask="name"
                autoFocus
                autoComplete="off"
                maxLength={60}
                value={staffDraft.name ?? ""}
                onValueChange={(name) => setStaffDraft((x) => (x ? { ...x, name } : x))}
              />
            </Field>
            <Field label="Usuário">
              <MaskedInput
                mask="username"
                autoComplete="off"
                minLength={3}
                maxLength={30}
                value={staffDraft.username ?? ""}
                onValueChange={(username) => setStaffDraft((x) => (x ? { ...x, username } : x))}
              />
            </Field>
            {!staffDraft.id && (
              <Field label="Senha">
                <input
                  autoComplete="new-password"
                  type="password"
                  minLength={6}
                  maxLength={72}
                  required
                  className="field"
                  value={staffDraft.password ?? ""}
                  onChange={(event) =>
                    setStaffDraft({ ...staffDraft, password: event.target.value })
                  }
                />
              </Field>
            )}
            {staffError && (
              <p role="alert" className="text-sm text-destructive">
                {staffError}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Btn type="button" variant="outline" onClick={() => setStaffDraft(null)}>
                Cancelar
              </Btn>
              <Btn type="submit" variant="success">
                Salvar
              </Btn>
            </div>
          </form>
        </div>
      )}
      {passwordResetStaff && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setPasswordResetStaff(null)}
        >
          <form
            onSubmit={resetStaffPassword}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-[14px] border bg-card p-6 shadow-2xl"
          >
            <h2 className="font-display text-xl font-bold text-ink">
              Redefinir senha de {passwordResetStaff.name}
            </h2>
            <Field label="Nova senha">
              <input
                autoFocus
                autoComplete="new-password"
                type="password"
                minLength={6}
                maxLength={72}
                required
                className="field"
                value={passwordResetDraft}
                onChange={(event) => setPasswordResetDraft(event.target.value)}
              />
            </Field>
            {passwordResetError && (
              <p role="alert" className="text-sm text-destructive">
                {passwordResetError}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Btn type="button" variant="outline" onClick={() => setPasswordResetStaff(null)}>
                Cancelar
              </Btn>
              <Btn type="submit" variant="success">
                Redefinir senha
              </Btn>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
