import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppShell, Btn, Field } from "@/components/ui-kit";
import { AppSelect } from "@/components/app-select";
import {
  connectSerialPrinter,
  connectUsbPrinter,
  disconnectPrinter,
  forgetPrinter,
  getDefaultPrintSettings,
  getPrinterStatus,
  getPrintSettings,
  initializePrinter,
  isDirectPrintSupported,
  printTestPage,
  printKitchenTicket,
  savePrintSettings,
  subscribePrinterStatus,
  type PrintSettings,
  type KitchenTicket,
} from "@/lib/printing";
import { errorMessage, useStore } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";

function translatePrinterError(cause: unknown) {
  const name =
    typeof cause === "object" && cause !== null && "name" in cause ? String(cause.name) : "";
  const messages: Record<string, string> = {
    SecurityError: "Acesso negado. Feche outros programas que estejam usando a impressora.",
    NetworkError:
      "A conexão com a impressora foi interrompida. Verifique o cabo e tente novamente.",
    InvalidStateError: "A impressora está ocupada ou já conectada em outra aba.",
    NotFoundError: "Nenhuma impressora compatível foi encontrada.",
  };
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!name && /access denied|acesso negado|permission denied/i.test(message)) {
    return "Acesso negado. Feche outros programas que estejam usando a impressora.";
  }
  if (!name && /could not open|não foi possível abrir|failed to open/i.test(message)) {
    return "Não foi possível abrir. Tente conectar por porta serial e verifique se o Windows está usando a impressora.";
  }
  return messages[name] ?? message;
}

export const Route = createFileRoute("/impressao")({
  head: () => ({
    meta: [
      { title: "Configurações de impressão | Mesari" },
      { name: "description", content: "Configure sua impressora térmica e teste a impressão." },
      { property: "og:title", content: "Configurações de impressão | Mesari" },
      {
        property: "og:description",
        content: "Configure sua impressora térmica e teste a impressão.",
      },
    ],
  }),
  component: Impressao,
});

function Impressao() {
  const role = useStore((snapshot) => snapshot.user?.role);
  const restaurantName = useStore((snapshot) => snapshot.restaurant.name);
  const navigate = useNavigate();
  const desktop = typeof window !== "undefined" && Boolean(window.mesariDesktop);
  const [settings, setSettings] = useState<PrintSettings>(getDefaultPrintSettings);
  const [desktopSettings, setDesktopSettings] = useState<MesariDesktopSettings>({
    printerNota: "",
    printerComanda: "",
    iniciarComWindows: true,
    manterEmSegundoPlano: true,
    impedirSuspensao: true,
  });
  const [printers, setPrinters] = useState<MesariDesktopPrinter[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [originalError, setOriginalError] = useState<string | null>(null);
  const [showAllUsb, setShowAllUsb] = useState(false);
  const [recentTickets, setRecentTickets] = useState<
    (KitchenTicket & { printedAt: number | null })[]
  >([]);
  const printer = useSyncExternalStore(subscribePrinterStatus, getPrinterStatus, getPrinterStatus);

  useEffect(() => {
    if (role && role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [navigate, role]);

  useEffect(() => {
    let active = true;
    try {
      setSettings(getPrintSettings());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    if (window.mesariDesktop) {
      void Promise.all([
        window.mesariDesktop.getSettings(),
        window.mesariDesktop.listPrinters(),
        initializePrinter(),
      ])
        .then(([nativeSettings, nativePrinters]) => {
          if (!active) return;
          setDesktopSettings(nativeSettings);
          setPrinters(nativePrinters);
        })
        .catch((cause: unknown) => {
          if (active) setError(errorMessage(cause));
        })
        .finally(() => {
          if (active) setReady(true);
        });
    } else {
      setReady(true);
      void initializePrinter().catch((cause: unknown) => {
        const details = cause instanceof Error ? cause.message : String(cause);
        setError(translatePrinterError(cause));
        setOriginalError(details);
      });
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (role !== "caixa") return;
    let active = true;
    const loadRecent = async () => {
      const { data, error: loadError } = await supabase
        .from("pedidos_cozinha")
        .select(
          "id,numero,mesa_numero,setor,garcom_nome,adicional,itens,criado_em,impresso_em,origem,dados",
        )
        .order("criado_em", { ascending: false })
        .limit(30);
      if (loadError) throw loadError;
      if (!active) return;
      setRecentTickets(
        (data ?? []).map((value) => {
          const row = value as Record<string, unknown>;
          const origin = row["origem"];
          const external = origin === "entrega" || origin === "retirada";
          if (
            (!external && row["setor"] !== "cozinha" && row["setor"] !== "bar") ||
            !Array.isArray(row["itens"])
          ) {
            throw new Error("O histórico retornou uma comanda em formato inválido.");
          }
          const details =
            typeof row["dados"] === "object" &&
            row["dados"] !== null &&
            !Array.isArray(row["dados"])
              ? (row["dados"] as Record<string, unknown>)
              : {};
          const paymentValue = details["pagamento_previsto"];
          const payment =
            typeof paymentValue === "object" &&
            paymentValue !== null &&
            !Array.isArray(paymentValue)
              ? (paymentValue as Record<string, unknown>)
              : {};
          const number = Number(details["numero_dia"] ?? row["numero"]);
          return {
            id: String(row["id"]),
            number,
            table:
              row["mesa_numero"] === null || row["mesa_numero"] === undefined
                ? null
                : Number(row["mesa_numero"]),
            sector: row["setor"] === "bar" ? "bar" : "cozinha",
            waiter: typeof row["garcom_nome"] === "string" ? row["garcom_nome"] : "",
            additional: row["adicional"] === true,
            createdAt: new Date(String(row["criado_em"])).getTime(),
            printedAt: row["impresso_em"] ? new Date(String(row["impresso_em"])).getTime() : null,
            items: row["itens"].map((entry: unknown) => {
              if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
                throw new Error("Um item do histórico está em formato inválido.");
              }
              const item = entry as Record<string, unknown>;
              return {
                product: String(item["produto"] ?? ""),
                quantity: Number(item["quantidade"]),
                note: String(item["observacao"] ?? ""),
                ...(typeof item["valor_unitario"] === "number"
                  ? { unitPrice: item["valor_unitario"] }
                  : {}),
              };
            }),
            ...(external
              ? {
                  external: {
                    origin,
                    dayNumber: number,
                    channel: String(details["canal"] ?? ""),
                    customerName: String(details["cliente_nome"] ?? ""),
                    phone: String(details["telefone"] ?? ""),
                    address: String(details["endereco"] ?? ""),
                    observation: String(details["observacao"] ?? ""),
                    subtotal: Number(details["subtotal"] ?? 0),
                    deliveryFee: Number(details["taxa_entrega"] ?? 0),
                    total: Number(details["total"] ?? 0),
                    payment: {
                      forma: typeof payment["forma"] === "string" ? payment["forma"] : null,
                      pago: payment["pago"] === true,
                      trocoPara:
                        payment["troco_para"] === null || payment["troco_para"] === undefined
                          ? null
                          : Number(payment["troco_para"]),
                    },
                  },
                }
              : {}),
          };
        }),
      );
    };
    void loadRecent().catch((cause: unknown) => {
      if (active) setError(errorMessage(cause));
    });
    return () => {
      active = false;
    };
  }, [role]);

  const updateSettings = (update: Partial<PrintSettings>) => {
    const next = { ...settings, ...update };
    try {
      savePrintSettings(next);
      setSettings(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const updateDesktopSettings = async (update: Partial<MesariDesktopSettings>) => {
    if (!window.mesariDesktop) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await window.mesariDesktop.setSettings(update);
      setDesktopSettings(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const runPrinterAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setOriginalError(null);
    setMessage(null);
    try {
      await action();
      setMessage("Impressora conectada com sucesso.");
    } catch (cause) {
      const details = cause instanceof Error ? cause.message : String(cause);
      setError(translatePrinterError(cause));
      setOriginalError(details);
    } finally {
      setBusy(false);
    }
  };

  const testPrint = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await printTestPage(settings, false, restaurantName || "Mesari");
      setMessage(
        result.method === "desktop"
          ? "Página de teste enviada pelo driver do Windows."
          : result.method === "direct"
            ? "Página de teste enviada diretamente para a impressora."
            : `Página de teste aberta na impressão do navegador.${result.fallbackReason ? ` Impressão direta indisponível: ${result.fallbackReason}` : ""}`,
      );
    } catch (cause) {
      const details = cause instanceof Error ? cause.message : String(cause);
      setError(translatePrinterError(cause));
      setOriginalError(details);
    } finally {
      setBusy(false);
    }
  };

  const statusText = desktop
    ? settings.printerMode === "direct"
      ? printer.connected
        ? `Conexão direta · ${printer.name}`
        : "Conexão direta · desconectada"
      : `Driver do Windows · ${printers.length} impressora(s)`
    : printer.connected
      ? `Conectada: ${printer.name}`
      : "Não conectada";
  if (role !== "caixa") return null;

  return (
    <AppShell center="Impressão">
      <main className="mx-auto max-w-3xl p-5">
        <div className="rounded-lg border bg-card px-6">
          {desktop && (
            <section className="grid grid-cols-1 gap-5 border-b py-5 md:grid-cols-[200px_1fr] md:gap-6">
              <div>
                <div className="text-xs text-muted-foreground">Método ativo</div>
                <h2 className="font-semibold text-ink">
                  {settings.printerMode === "direct" ? "USB ou Bluetooth/COM" : "Driver do Windows"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Escolha o método. A impressora direta autorizada fica salva para reconectar e
                  atende notas e comandas neste computador.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Btn
                    variant={settings.printerMode === "browser" ? "neutral" : "outline"}
                    disabled={busy}
                    onClick={() => updateSettings({ printerMode: "browser" })}
                  >
                    Usar driver do Windows
                  </Btn>
                  <Btn
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runPrinterAction(async () => {
                        await connectSerialPrinter();
                        setSettings(getPrintSettings());
                      })
                    }
                  >
                    {busy ? "Conectando..." : "Bluetooth / porta COM"}
                  </Btn>
                  <Btn
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runPrinterAction(async () => {
                        await connectUsbPrinter(showAllUsb);
                        setSettings(getPrintSettings());
                      })
                    }
                  >
                    {busy ? "Conectando..." : "Conectar por USB"}
                  </Btn>
                </div>
                <div className="text-xs text-muted-foreground sm:col-span-2">
                  {settings.printerMode === "direct" ? (
                    <>
                      {printer.connected
                        ? `Conectada: ${printer.name}`
                        : "Nenhuma impressora direta conectada."}
                      {" · "}
                      Emparelhe impressoras Bluetooth no Windows e escolha a porta COM aqui.
                    </>
                  ) : (
                    "As impressoras configuradas abaixo são usadas para a nota e as comandas."
                  )}
                </div>
                {settings.printerMode === "direct" && (
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <Btn
                      variant="outline"
                      disabled={busy || !printer.connected}
                      onClick={() => void runPrinterAction(disconnectPrinter)}
                    >
                      Desconectar
                    </Btn>
                    <Btn
                      variant="outline"
                      disabled={
                        busy ||
                        (!getPrintSettings().printerDeviceId && !getPrintSettings().connectionType)
                      }
                      onClick={() => void runPrinterAction(forgetPrinter)}
                    >
                      Esquecer impressora
                    </Btn>
                    <button
                      type="button"
                      className="self-center text-xs text-primary underline"
                      onClick={() => setShowAllUsb((current) => !current)}
                    >
                      {showAllUsb
                        ? "Usar impressoras térmicas USB"
                        : "Mostrar todos os dispositivos USB"}
                    </button>
                  </div>
                )}
                <Field label="Impressora da nota">
                  <AppSelect
                    className="field"
                    value={desktopSettings.printerNota}
                    disabled={busy}
                    onValueChange={(value) => {
                      void updateDesktopSettings({ printerNota: value });
                      updateSettings({ printerMode: "browser" });
                    }}
                    options={[
                      { value: "", label: "Impressora padrão do Windows" },
                      ...printers.map((item) => ({
                        value: item.name,
                        label: `${item.displayName || item.name}${item.isDefault ? " (padrão)" : ""}`,
                      })),
                    ]}
                  />
                </Field>
                <Field label="Impressora das comandas">
                  <AppSelect
                    className="field"
                    value={desktopSettings.printerComanda}
                    disabled={busy}
                    onValueChange={(value) => {
                      void updateDesktopSettings({ printerComanda: value });
                      updateSettings({ printerMode: "browser" });
                    }}
                    options={[
                      { value: "", label: "Impressora padrão do Windows" },
                      ...printers.map((item) => ({
                        value: item.name,
                        label: `${item.displayName || item.name}${item.isDefault ? " (padrão)" : ""}`,
                      })),
                    ]}
                  />
                </Field>
                <Field label="Largura do papel">
                  <AppSelect
                    className="field"
                    value={String(settings.paperWidth)}
                    onValueChange={(value) => {
                      const paperWidth = Number(value) as 58 | 80;
                      updateSettings({ paperWidth, columns: paperWidth === 58 ? 32 : 48 });
                    }}
                    options={[
                      { value: "58", label: "58 mm" },
                      { value: "80", label: "80 mm" },
                    ]}
                  />
                </Field>
                <div className="pt-5 text-xs text-muted-foreground">
                  {printers.length === 0
                    ? "Nenhuma impressora foi encontrada pelo Windows."
                    : `${printers.length} impressora(s) disponível(is).`}
                </div>
                <div className="sm:col-span-2">
                  {(
                    [
                      ["iniciarComWindows", "Iniciar com o Windows"],
                      ["manterEmSegundoPlano", "Manter em segundo plano ao fechar a janela"],
                      ["impedirSuspensao", "Impedir suspensão do aplicativo"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3 py-2 text-sm text-ink">
                      <Switch
                        checked={desktopSettings[key]}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          void updateDesktopSettings({ [key]: checked })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}
          {(!desktop || settings.printerMode === "direct") && (
            <section className="grid grid-cols-1 gap-5 border-b py-5 md:grid-cols-[200px_1fr] md:gap-6">
              <div>
                <div className="text-xs text-muted-foreground">Conexão</div>
                <h2 className="font-semibold text-ink">Impressora</h2>
              </div>
              <div>
                <span
                  className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${printer.connected ? "bg-free-bg text-free" : "bg-bill-bg text-bill"}`}
                >
                  {statusText}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">
                  Conecte a impressora uma vez. O Mesari tentará reconectar automaticamente neste
                  computador.
                </p>
                {!isDirectPrintSupported() && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Este navegador não permite conectar impressora, usando o Windows.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Btn disabled={busy} onClick={() => void runPrinterAction(connectSerialPrinter)}>
                    {busy ? "Conectando..." : "Conectar por porta serial (COM)"}
                  </Btn>
                  <Btn
                    variant="outline"
                    disabled={busy}
                    onClick={() => void runPrinterAction(() => connectUsbPrinter(false))}
                  >
                    {busy ? "Conectando..." : "Conectar por USB"}
                  </Btn>
                  <Btn
                    variant="outline"
                    disabled={busy || !printer.connected}
                    onClick={() => void runPrinterAction(disconnectPrinter)}
                  >
                    Desconectar
                  </Btn>
                  <Btn
                    variant="outline"
                    disabled={
                      busy ||
                      (!getPrintSettings().printerDeviceId && !getPrintSettings().connectionType)
                    }
                    onClick={() => void runPrinterAction(forgetPrinter)}
                  >
                    Esquecer impressora
                  </Btn>
                </div>
                {!showAllUsb ? (
                  <button
                    type="button"
                    className="mt-2 block text-xs text-primary underline"
                    onClick={() => setShowAllUsb(true)}
                  >
                    Mostrar todos os dispositivos USB
                  </button>
                ) : (
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      className="text-primary underline"
                      disabled={busy}
                      onClick={() => void runPrinterAction(() => connectUsbPrinter(true))}
                    >
                      Abrir seletor de todos os dispositivos USB
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setShowAllUsb(false)}
                    >
                      Fechar
                    </button>
                  </div>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Velocidade (baud)">
                    <AppSelect
                      className="field"
                      value={String(settings.baudRate)}
                      onValueChange={(value) =>
                        updateSettings({
                          baudRate: Number(value) as PrintSettings["baudRate"],
                        })
                      }
                      options={[9600, 19200, 38400, 57600, 115200].map((baud) => ({
                        value: String(baud),
                        label: String(baud),
                      }))}
                    />
                  </Field>
                  <Field label="Tabela de caracteres">
                    <AppSelect
                      className="field"
                      value={settings.characterTable}
                      onValueChange={(value) =>
                        updateSettings({
                          characterTable: value as PrintSettings["characterTable"],
                        })
                      }
                      options={[
                        { value: "CP860", label: "CP860 (padrão)" },
                        { value: "CP850", label: "CP850" },
                        { value: "WPC1252", label: "WPC1252" },
                      ]}
                    />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Navegador: {typeof navigator === "undefined" ? "—" : navigator.userAgent}
                  {printer.vendorId !== undefined && ` · vendorId ${printer.vendorId}`}
                  {printer.productId !== undefined && ` · productId ${printer.productId}`}
                  {printer.productName && ` · ${printer.productName}`}
                </p>
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 gap-5 border-b py-5 md:grid-cols-[200px_1fr] md:gap-6">
            <div>
              <div className="text-xs text-muted-foreground">Preferências locais</div>
              <h2 className="font-semibold text-ink">Formato do recibo</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {!desktop && (
                <Field label="Largura do papel">
                  <AppSelect
                    className="field"
                    value={String(settings.paperWidth)}
                    onValueChange={(value) => {
                      const paperWidth = Number(value) as 58 | 80;
                      updateSettings({ paperWidth, columns: paperWidth === 58 ? 32 : 48 });
                    }}
                    options={[
                      { value: "58", label: "58 mm" },
                      { value: "80", label: "80 mm" },
                    ]}
                  />
                </Field>
              )}
              <Field label="Colunas (avançado)">
                <input
                  className="field"
                  type="number"
                  min={16}
                  max={64}
                  value={settings.columns}
                  onChange={(event) =>
                    updateSettings({
                      columns: Math.max(16, Math.min(64, Number(event.target.value) || 32)),
                    })
                  }
                />
              </Field>
              <Field label="Número de vias da nota">
                <AppSelect
                  className="field"
                  value={String(settings.copies)}
                  onValueChange={(value) => updateSettings({ copies: Number(value) as 1 | 2 })}
                  options={[
                    { value: "1", label: "1 via" },
                    { value: "2", label: "2 vias" },
                  ]}
                />
              </Field>
            </div>
            <div className="md:col-start-2">
              <label className="flex items-center gap-3 py-2 text-sm text-ink">
                <Switch
                  checked={settings.cutPaper}
                  onCheckedChange={(checked) => updateSettings({ cutPaper: checked })}
                />
                Cortar o papel no final
              </label>
              <label className="flex items-center gap-3 py-2 text-sm text-ink">
                <Switch
                  checked={settings.openCashDrawer}
                  onCheckedChange={(checked) => updateSettings({ openCashDrawer: checked })}
                />
                Abrir gaveta ao imprimir a nota
              </label>
              <label className="flex items-center gap-3 py-2 text-sm text-ink">
                <Switch
                  aria-label="Mostrar valores na comanda"
                  checked={settings.showKitchenPrices}
                  onCheckedChange={(checked) => updateSettings({ showKitchenPrices: checked })}
                />
                Mostrar valores na comanda
              </label>
              <label className="flex items-center gap-3 py-2 text-sm font-semibold text-ink">
                <Switch
                  checked={settings.printKitchenEnabled}
                  onCheckedChange={(checked) => updateSettings({ printKitchenEnabled: checked })}
                />
                Imprimir comandas neste computador
              </label>
              {settings.printKitchenEnabled && (
                <p className="text-xs text-muted-foreground">
                  Setores ativos: Cozinha e Bar (uma comanda por pedido).
                </p>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-5 py-5 md:grid-cols-[200px_1fr] md:gap-6">
            <div>
              <div className="text-xs text-muted-foreground">Verificação</div>
              <h2 className="font-semibold text-ink">Impressão de teste</h2>
            </div>
            <div>
              <div className="flex flex-wrap gap-2">
                <Btn variant="neutral" disabled={!ready || busy} onClick={() => void testPrint()}>
                  Imprimir página de teste
                </Btn>
                {!desktop && (
                  <Btn
                    variant="outline"
                    disabled={!ready || busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      setOriginalError(null);
                      setMessage(null);
                      void printTestPage(settings, true, restaurantName || "Mesari")
                        .then(() => setMessage("Teste de acentos enviado à impressora."))
                        .catch((cause: unknown) => {
                          setError(translatePrinterError(cause));
                          setOriginalError(cause instanceof Error ? cause.message : String(cause));
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    Imprimir teste de acentos
                  </Btn>
                )}
                <Btn
                  variant="outline"
                  disabled={!ready || busy}
                  onClick={() => {
                    const diagnostics = {
                      navegador: navigator.userAgent,
                      tipoConexao: printer.connectionType ?? "nenhuma",
                      vendorId: printer.vendorId ?? null,
                      productId: printer.productId ?? null,
                      nomeProduto: printer.productName ?? printer.name,
                      baud: settings.baudRate,
                      colunas: settings.columns,
                      tabelaCaracteres: settings.characterTable,
                      ultimoErro: printer.error ?? originalError,
                    };
                    void navigator.clipboard
                      .writeText(JSON.stringify(diagnostics, null, 2))
                      .then(() => setMessage("Diagnóstico copiado."))
                      .catch((cause: unknown) => {
                        setError(errorMessage(cause));
                        setOriginalError(errorMessage(cause));
                      });
                  }}
                >
                  Copiar diagnóstico
                </Btn>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Imprimindo por:{" "}
                {printer.connected ? "impressora conectada" : "Windows (impressora padrão)"}
              </p>
            </div>
          </section>
          {!desktop && (
            <section className="border-t py-5">
              <details>
                <summary className="cursor-pointer font-semibold text-ink">
                  NÃO CONSEGUE CONECTAR?
                </summary>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <p>
                    <strong>Acesso negado</strong> ou <strong>Não foi possível abrir</strong>: o
                    Windows pode estar usando a impressora. Tente conectar por porta serial. Se o
                    driver tiver porta virtual COM, ative-a.
                  </p>
                  <p>
                    Feche outros programas ou abas que usem a impressora; desligue e ligue a
                    impressora; troque o cabo ou a porta USB.
                  </p>
                  <p>
                    Acentos estranhos: troque CP860, CP850 ou WPC1252 e imprima o teste de acentos.
                  </p>
                  <p>
                    Use Chrome ou Edge atualizado. Mantenha este site ativo nas configurações de
                    desempenho do Chrome e impeça a suspensão do computador.
                  </p>
                  {printer.error && (
                    <p role="alert" className="text-destructive">
                      {translatePrinterError(printer.error)}{" "}
                      <small className="block">{printer.error}</small>
                    </p>
                  )}
                </div>
              </details>
            </section>
          )}
          <section className="border-t py-5">
            <h2 className="mb-3 font-semibold text-ink">Últimas comandas</h2>
            <ul className="space-y-2 text-sm">
              {recentTickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2"
                >
                  <span>
                    #{ticket.number} ·{" "}
                    {ticket.external
                      ? `${ticket.external.origin === "entrega" ? "Entrega" : "Retirada"} · ${ticket.external.customerName}`
                      : `Mesa ${String(ticket.table ?? "—").padStart(2, "0")}`}{" "}
                    · {ticket.printedAt ? "Impresso" : "Aguardando"}
                  </span>
                  <Btn
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runPrinterAction(async () => {
                        await printKitchenTicket(ticket, settings);
                      })
                    }
                  >
                    Reimprimir
                  </Btn>
                </li>
              ))}
            </ul>
          </section>
        </div>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
            {originalError && <small className="mt-1 block">{originalError}</small>}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="mt-4 rounded-md border border-free/30 bg-free-bg p-3 text-sm text-free"
          >
            {message}
          </p>
        )}
      </main>
    </AppShell>
  );
}
