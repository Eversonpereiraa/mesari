import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppShell, Btn, Field } from "@/components/ui-kit";
import { AppSelect } from "@/components/app-select";
import { Switch } from "@/components/ui/switch";
import { PrintLayoutSettings } from "@/components/print-layout-settings";
import { DesktopPrinterConnection } from "@/components/desktop-printer-connection";
import {
  AGENT_NOT_FOUND,
  BAUD_RATES,
  CODEPAGES,
  CONNECTION_LABELS,
  DEFAULT_AGENT_URL,
  WEBUSB_WINDOWS_HINT,
  BluetoothWebTransport,
  WebSerialTransport,
  WebUsbTransport,
  abrirGaveta,
  agentHealth,
  defaultConfig,
  getPrinterStatus,
  getTransport,
  imprimirComanda,
  imprimirComandaExemplo,
  imprimirTeste,
  initializePrinter,
  isDesktopApp,
  isNativeApp,
  listPairedBluetooth,
  listSerialPorts,
  listWindowsPrinters,
  loadConfig,
  printErrorMessage,
  subscribeConfig,
  subscribePrinterStatus,
  testarConexao,
  transportAvailability,
  updateConfig,
  type BaudRate,
  type Codepage,
  type ConnectionKind,
  type KitchenTicket,
  type PairedDevice,
  type PrinterConfig,
  type WindowsPrinterInfo,
} from "@/lib/printing";
import { errorMessage, useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

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

const SERVER_CONFIG = defaultConfig();
const KINDS: ConnectionKind[] = [
  "rede",
  "webserial",
  "webusb",
  "windows",
  "serial",
  "bluetooth",
  "bluetoothNativo",
  "navegador",
];
const AGENT_KINDS: ConnectionKind[] = ["windows", "serial"];

type Availability = { available: boolean; reason?: string };
type AgentState = { state: "verificando" | "rodando" | "ausente"; versao?: string };

function availabilityOf(kind: ConnectionKind, native: boolean): Availability {
  if (native && AGENT_KINDS.includes(kind)) {
    return { available: false, reason: "No app Android, use Rede (IP) ou Bluetooth." };
  }
  const result = transportAvailability(kind);
  return result.available ? { available: true } : { available: false, reason: result.reason };
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-4 border-b py-5 last:border-b-0 md:grid-cols-[180px_1fr] md:gap-6">
      <div>
        <div className="text-xs text-muted-foreground">{eyebrow}</div>
        <h2 className="font-semibold text-ink">{title}</h2>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 py-2 text-sm text-ink">
      <Switch checked={checked} onCheckedChange={onChange} />
      {children}
    </label>
  );
}

function Impressao() {
  const role = useStore((snapshot) => snapshot.user?.role);
  const restaurantName = useStore((snapshot) => snapshot.restaurant.name);
  const navigate = useNavigate();
  const config = useSyncExternalStore(subscribeConfig, loadConfig, () => SERVER_CONFIG);
  const printer = useSyncExternalStore(subscribePrinterStatus, getPrinterStatus, getPrinterStatus);
  const [mounted, setMounted] = useState(false);
  const [native, setNative] = useState(false);
  const [desktopApp, setDesktopApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentState>({ state: "verificando" });
  const [windowsPrinters, setWindowsPrinters] = useState<WindowsPrinterInfo[]>([]);
  const [comPorts, setComPorts] = useState<string[]>([]);
  const [paired, setPaired] = useState<PairedDevice[]>([]);
  const [showAllUsb, setShowAllUsb] = useState(false);
  const [ipDraft, setIpDraft] = useState("");
  const [portDraft, setPortDraft] = useState("9100");
  const [agentDraft, setAgentDraft] = useState(DEFAULT_AGENT_URL);
  const [desktopSettings, setDesktopSettings] = useState<MesariDesktopSettings | null>(null);
  const [desktopPrinters, setDesktopPrinters] = useState<MesariDesktopPrinter[]>([]);
  const [recentTickets, setRecentTickets] = useState<
    (KitchenTicket & { printedAt: number | null })[]
  >([]);

  useEffect(() => {
    if (role && role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [navigate, role]);

  useEffect(() => {
    setMounted(true);
    setNative(isNativeApp());
    setDesktopApp(isDesktopApp());
    const current = loadConfig();
    setIpDraft(current.ip);
    setPortDraft(String(current.port));
    setAgentDraft(current.agentUrl);
    getTransport();
    void initializePrinter();
    if (window.mesariDesktop) {
      void Promise.all([window.mesariDesktop.getSettings(), window.mesariDesktop.listPrinters()])
        .then(([settings, printers]) => {
          setDesktopSettings(settings);
          setDesktopPrinters(printers);
        })
        .catch((cause: unknown) => console.error("[impressão] app desktop", cause));
    }
  }, []);

  const checkAgent = useCallback(async () => {
    setAgent({ state: "verificando" });
    const health = await agentHealth(loadConfig().agentUrl);
    setAgent(health.ok ? { state: "rodando", versao: health.versao } : { state: "ausente" });
    return health.ok;
  }, []);

  const usesAgent =
    !native &&
    !desktopApp &&
    (config.connection === "rede" || AGENT_KINDS.includes(config.connection));

  useEffect(() => {
    if (!mounted || !usesAgent) return;
    void checkAgent();
  }, [checkAgent, config.agentUrl, mounted, usesAgent]);

  useEffect(() => {
    if (!mounted || agent.state !== "rodando") return;
    if (config.connection === "windows") {
      void listWindowsPrinters(config.agentUrl)
        .then(setWindowsPrinters)
        .catch((cause: unknown) => setError(printErrorMessage(cause)));
    }
    if (config.connection === "serial") {
      void listSerialPorts(config.agentUrl)
        .then(setComPorts)
        .catch((cause: unknown) => setError(printErrorMessage(cause)));
    }
  }, [agent.state, config.agentUrl, config.connection, mounted]);

  useEffect(() => {
    if (!mounted || !native || config.connection !== "bluetoothNativo") return;
    void listPairedBluetooth()
      .then(setPaired)
      .catch((cause: unknown) => setError(printErrorMessage(cause)));
  }, [config.connection, mounted, native]);

  useEffect(() => {
    if (role !== "caixa") return;
    let active = true;
    void loadRecentTickets()
      .then((tickets) => {
        if (active) setRecentTickets(tickets);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [role]);

  const update = (patch: Partial<PrinterConfig>) => {
    setError(null);
    setMessage(null);
    updateConfig(patch);
  };

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if (result) setMessage(result);
    } catch (cause) {
      console.error("[impressão]", cause);
      setError(printErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveNetwork = () => {
    const port = Number(portDraft);
    update({
      ip: ipDraft.trim(),
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 9100,
      agentUrl: agentDraft.trim() || DEFAULT_AGENT_URL,
    });
  };

  const updateDesktop = async (patch: Partial<MesariDesktopSettings>) => {
    if (!window.mesariDesktop) return;
    try {
      setDesktopSettings(await window.mesariDesktop.setSettings(patch));
    } catch (cause) {
      console.error("[impressão] app desktop", cause);
      setError("Não foi possível salvar a configuração do app desktop.");
    }
  };

  if (role !== "caixa") return null;

  const availability = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      mounted ? availabilityOf(kind, native) : { available: kind === "navegador" },
    ]),
  ) as Record<ConnectionKind, Availability>;
  const visibleKinds = KINDS.filter((kind) => kind !== "bluetoothNativo" || native);
  const selectedUnavailable = mounted && !availability[config.connection].available;
  const stateLabel = {
    conectado: "Conectado",
    conectando: "Conectando...",
    desconectado: "Desconectado",
    erro: "Erro",
  }[printer.state];
  const stateClass =
    printer.state === "conectado"
      ? "bg-free-bg text-free"
      : printer.state === "erro"
        ? "bg-destructive/10 text-destructive"
        : "bg-bill-bg text-bill";

  return (
    <AppShell center="Impressão">
      <main className="mx-auto max-w-3xl p-4 sm:p-5">
        <div className="rounded-lg border bg-card px-4 sm:px-6">
          <Section eyebrow="Passo 1" title="Conexão">
            {desktopApp ? (
              <DesktopPrinterConnection config={config} update={update} busy={busy} run={run} />
            ) : (
              <>
                <div
                  role="radiogroup"
                  aria-label="Forma de conexão"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {visibleKinds.map((kind) => {
                    const info = availability[kind];
                    const selected = config.connection === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!info.available || busy}
                        onClick={() => update({ connection: kind })}
                        className={`rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-primary bg-accent font-semibold text-ink" : "bg-card hover:bg-muted"}`}
                      >
                        <span className="block">{CONNECTION_LABELS[kind]}</span>
                        {!info.available && info.reason && (
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            {info.reason}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selectedUnavailable && (
                  <p className="mt-3 text-sm text-destructive">
                    A conexão salva não funciona neste aparelho:{" "}
                    {availability[config.connection].reason} Escolha outra opção.
                  </p>
                )}

                <div className="mt-4 space-y-3">
                  {config.connection === "rede" && (
                    <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                      <Field
                        label="IP da impressora"
                        hint="Ex.: 192.168.0.50. Veja na página de autoteste da impressora."
                      >
                        <input
                          className="field"
                          inputMode="decimal"
                          value={ipDraft}
                          onChange={(event) => setIpDraft(event.target.value)}
                          onBlur={saveNetwork}
                          placeholder="192.168.0.50"
                        />
                      </Field>
                      <Field label="Porta">
                        <input
                          className="field"
                          inputMode="numeric"
                          value={portDraft}
                          onChange={(event) => setPortDraft(event.target.value)}
                          onBlur={saveNetwork}
                        />
                      </Field>
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        {native
                          ? "O app Android conecta direto na impressora pela rede Wi-Fi."
                          : "No computador, a impressão pela rede passa pelo agente de impressão."}
                      </p>
                    </div>
                  )}

                  {config.connection === "webserial" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <Btn
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const transport = getTransport();
                              if (transport instanceof WebSerialTransport) await transport.choose();
                              return "Porta USB autorizada e conectada.";
                            })
                          }
                        >
                          Escolher porta USB
                        </Btn>
                        <div className="w-40">
                          <Field label="Velocidade (baud)">
                            <AppSelect
                              className="field"
                              value={String(config.baudRate)}
                              onValueChange={(value) =>
                                update({ baudRate: Number(value) as BaudRate })
                              }
                              options={BAUD_RATES.map((baud) => ({
                                value: String(baud),
                                label: String(baud),
                              }))}
                            />
                          </Field>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Para impressoras USB cujo driver cria uma porta COM. A Elgin i9 usa 115200
                        por padrão.
                      </p>
                    </div>
                  )}

                  {config.connection === "webusb" && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Btn
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const transport = getTransport();
                              if (transport instanceof WebUsbTransport)
                                await transport.choose(showAllUsb);
                              return "Dispositivo USB autorizado e conectado.";
                            })
                          }
                        >
                          Escolher dispositivo USB
                        </Btn>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={showAllUsb}
                            onChange={(event) => setShowAllUsb(event.target.checked)}
                          />
                          Mostrar todos os dispositivos
                        </label>
                      </div>
                      <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                        {WEBUSB_WINDOWS_HINT}
                      </p>
                    </div>
                  )}

                  {config.connection === "windows" && (
                    <Field
                      label="Impressora instalada no Windows"
                      hint="O agente envia os comandos direto (RAW) para esta impressora."
                    >
                      <AppSelect
                        className="field"
                        value={config.windowsPrinter}
                        disabled={agent.state !== "rodando"}
                        onValueChange={(value) => update({ windowsPrinter: value })}
                        placeholder={
                          agent.state === "rodando"
                            ? "Escolha a impressora"
                            : "Agente não encontrado"
                        }
                        options={[
                          ...(config.windowsPrinter &&
                          !windowsPrinters.some((item) => item.nome === config.windowsPrinter)
                            ? [{ value: config.windowsPrinter, label: config.windowsPrinter }]
                            : []),
                          ...windowsPrinters.map((item) => ({
                            value: item.nome,
                            label: `${item.nome}${item.padrao ? " (padrão)" : ""}`,
                          })),
                        ]}
                      />
                    </Field>
                  )}

                  {config.connection === "serial" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Porta COM">
                        <AppSelect
                          className="field"
                          value={config.comPort}
                          disabled={agent.state !== "rodando"}
                          onValueChange={(value) => update({ comPort: value })}
                          placeholder={
                            agent.state === "rodando" ? "Escolha a porta" : "Agente não encontrado"
                          }
                          options={[
                            ...(config.comPort && !comPorts.includes(config.comPort)
                              ? [{ value: config.comPort, label: config.comPort }]
                              : []),
                            ...comPorts.map((port) => ({ value: port, label: port })),
                          ]}
                        />
                      </Field>
                      <Field label="Velocidade (baud)">
                        <AppSelect
                          className="field"
                          value={String(config.comBaudRate)}
                          onValueChange={(value) =>
                            update({ comBaudRate: Number(value) as BaudRate })
                          }
                          options={BAUD_RATES.map((baud) => ({
                            value: String(baud),
                            label: String(baud),
                          }))}
                        />
                      </Field>
                    </div>
                  )}

                  {config.connection === "bluetooth" && (
                    <div className="space-y-2">
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const transport = getTransport();
                            if (transport instanceof BluetoothWebTransport)
                              await transport.choose();
                            return "Impressora Bluetooth conectada.";
                          })
                        }
                      >
                        Procurar impressora Bluetooth
                      </Btn>
                      <p className="text-xs text-muted-foreground">
                        Para impressoras Bluetooth BLE. Ligue a impressora e deixe-a perto do
                        aparelho.
                      </p>
                    </div>
                  )}

                  {config.connection === "bluetoothNativo" && (
                    <div className="space-y-2">
                      <Field
                        label="Impressora pareada"
                        hint="Pareie a impressora nas configurações de Bluetooth do Android antes."
                      >
                        <AppSelect
                          className="field"
                          value={config.bluetoothAddress ?? ""}
                          onValueChange={(value) =>
                            update({
                              bluetoothAddress: value,
                              deviceName:
                                paired.find((item) => item.address === value)?.name ?? value,
                            })
                          }
                          placeholder={
                            paired.length ? "Escolha a impressora" : "Nenhum aparelho pareado"
                          }
                          options={paired.map((item) => ({
                            value: item.address,
                            label: `${item.name} (${item.address})`,
                          }))}
                        />
                      </Field>
                      <Btn
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            setPaired(await listPairedBluetooth());
                          })
                        }
                      >
                        Atualizar lista
                      </Btn>
                    </div>
                  )}

                  {config.connection === "navegador" && (
                    <p className="text-sm text-muted-foreground">
                      {desktopSettings
                        ? "O app desktop imprime pelo driver do Windows, sem abrir a caixa de impressão."
                        : 'Abre a caixa de impressão do sistema. Funciona com qualquer impressora instalada, mas pede confirmação a cada impressão. Escolha a impressora térmica e margens "Nenhuma".'}
                    </p>
                  )}
                </div>
              </>
            )}
          </Section>

          {usesAgent && (
            <Section eyebrow="Computador" title="Agente de impressão">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${agent.state === "rodando" ? "bg-free-bg text-free" : agent.state === "ausente" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
                >
                  {agent.state === "rodando"
                    ? `Rodando${agent.versao ? ` · versão ${agent.versao}` : ""}`
                    : agent.state === "ausente"
                      ? "Não encontrado"
                      : "Verificando..."}
                </span>
                <Btn size="sm" variant="outline" onClick={() => void checkAgent()}>
                  Verificar de novo
                </Btn>
                {agent.state === "ausente" && (
                  <a href="#instalar-agente" className="text-xs text-primary underline">
                    Como instalar o agente
                  </a>
                )}
              </div>
              {agent.state === "ausente" && (
                <p className="mt-2 text-xs text-muted-foreground">{AGENT_NOT_FOUND}</p>
              )}
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Endereço do agente (avançado)</summary>
                <div className="mt-2 max-w-sm">
                  <input
                    className="field"
                    value={agentDraft}
                    onChange={(event) => setAgentDraft(event.target.value)}
                    onBlur={saveNetwork}
                  />
                </div>
              </details>
            </Section>
          )}

          <Section eyebrow="Passo 2" title="Status">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${stateClass}`}>
                {stateLabel}
              </span>
              <span className="text-sm text-ink">
                {printer.label} · {printer.name}
              </span>
            </div>
            {printer.error && <p className="mt-2 text-sm text-destructive">{printer.error}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn
                variant="outline"
                disabled={busy || selectedUnavailable}
                onClick={() =>
                  void run(async () => {
                    await testarConexao();
                    return "Conexão com a impressora OK.";
                  })
                }
              >
                Testar conexão
              </Btn>
              <Btn
                variant="neutral"
                disabled={busy || selectedUnavailable}
                onClick={() =>
                  void run(async () => {
                    await imprimirTeste(restaurantName || "Mesari");
                    return "Página de teste enviada.";
                  })
                }
              >
                Imprimir página de teste
              </Btn>
              <Btn
                variant="outline"
                disabled={busy || selectedUnavailable}
                onClick={() =>
                  void run(async () => {
                    await imprimirComandaExemplo("entrega");
                    return "Comanda de exemplo enviada.";
                  })
                }
              >
                Imprimir comanda de exemplo
              </Btn>
              {config.connection !== "navegador" && (
                <Btn
                  variant="ghost"
                  disabled={busy || selectedUnavailable}
                  onClick={() =>
                    void run(async () => {
                      await abrirGaveta();
                      return "Comando de abrir gaveta enviado.";
                    })
                  }
                >
                  Abrir gaveta
                </Btn>
              )}
            </div>
            {error && (
              <p
                role="alert"
                className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="mt-3 rounded-md border border-free/30 bg-free-bg p-3 text-sm text-free"
              >
                {message}
              </p>
            )}
          </Section>

          <Section eyebrow="Passo 3" title="Largura e calibração">
            <PrintLayoutSettings config={config} update={update} disabled={busy} />
          </Section>

          <Section eyebrow="Passo 4" title="Configurações">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Codepage (acentos)">
                <AppSelect
                  className="field"
                  value={config.codepage}
                  onValueChange={(value) => update({ codepage: value as Codepage })}
                  options={CODEPAGES.map((page) => ({
                    value: page,
                    label: page === "CP850" ? "CP850 (padrão)" : page,
                  }))}
                />
              </Field>
              <Field label="Número de vias">
                <AppSelect
                  className="field"
                  value={String(config.copies)}
                  onValueChange={(value) => update({ copies: Number(value) as 1 | 2 | 3 })}
                  options={[
                    { value: "1", label: "1 via" },
                    { value: "2", label: "2 vias" },
                    { value: "3", label: "3 vias" },
                  ]}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Toggle
                checked={config.openDrawerOnPayment}
                onChange={(value) => update({ openDrawerOnPayment: value })}
              >
                Abrir gaveta ao concluir pagamento
              </Toggle>
              <Toggle
                checked={config.autoPrintOnPreparing}
                onChange={(value) => update({ autoPrintOnPreparing: value })}
              >
                Imprimir delivery automaticamente ao avançar para "Em preparo"
              </Toggle>
              <p className="ml-12 text-xs text-muted-foreground">
                {config.autoPrintOnPreparing
                  ? 'Pedidos de delivery imprimem ao avançar para "Em preparo" (e não ao serem criados).'
                  : "Pedidos de delivery imprimem quando são criados."}
              </p>
              <Toggle
                checked={config.printKitchenEnabled}
                onChange={(value) => update({ printKitchenEnabled: value })}
              >
                Imprimir neste aparelho as comandas das mesas e do delivery
              </Toggle>
              <Toggle
                checked={config.showKitchenPrices}
                onChange={(value) => update({ showKitchenPrices: value })}
              >
                Mostrar preços nas comandas das mesas
              </Toggle>
            </div>
          </Section>

          {desktopSettings && (
            <Section eyebrow="App desktop" title="Windows">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Impressora da nota (modo Navegador)">
                  <AppSelect
                    className="field"
                    value={desktopSettings.printerNota}
                    onValueChange={(value) => void updateDesktop({ printerNota: value })}
                    options={[
                      { value: "", label: "Impressora padrão do Windows" },
                      ...desktopPrinters.map((item) => ({
                        value: item.name,
                        label: `${item.displayName || item.name}${item.isDefault ? " (padrão)" : ""}`,
                      })),
                    ]}
                  />
                </Field>
                <Field label="Impressora das comandas (modo Navegador)">
                  <AppSelect
                    className="field"
                    value={desktopSettings.printerComanda}
                    onValueChange={(value) => void updateDesktop({ printerComanda: value })}
                    options={[
                      { value: "", label: "Impressora padrão do Windows" },
                      ...desktopPrinters.map((item) => ({
                        value: item.name,
                        label: `${item.displayName || item.name}${item.isDefault ? " (padrão)" : ""}`,
                      })),
                    ]}
                  />
                </Field>
              </div>
              <div className="mt-2">
                {(
                  [
                    ["iniciarComWindows", "Iniciar com o Windows"],
                    ["manterEmSegundoPlano", "Manter em segundo plano ao fechar a janela"],
                    ["impedirSuspensao", "Impedir suspensão do aplicativo"],
                  ] as const
                ).map(([key, label]) => (
                  <Toggle
                    key={key}
                    checked={desktopSettings[key]}
                    onChange={(value) => void updateDesktop({ [key]: value })}
                  >
                    {label}
                  </Toggle>
                ))}
              </div>
            </Section>
          )}

          <Section eyebrow="Histórico" title="Últimas comandas">
            {recentTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma comanda recente.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recentTickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0"
                  >
                    <span>
                      #{ticket.external?.dayNumber ?? ticket.number} ·{" "}
                      {ticket.external
                        ? `${ticket.external.origin === "entrega" ? "Entrega" : "Retirada"} · ${ticket.external.customerName}`
                        : `Mesa ${String(ticket.table ?? "—").padStart(2, "0")}`}{" "}
                      · {ticket.printedAt ? "Impressa" : "Aguardando"}
                    </span>
                    <Btn
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await imprimirComanda(ticket);
                          return `Comanda #${ticket.external?.dayNumber ?? ticket.number} reimpressa.`;
                        })
                      }
                    >
                      Reimprimir
                    </Btn>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <section id="instalar-agente" className="border-t py-5">
            <details>
              <summary className="cursor-pointer font-semibold text-ink">
                Como instalar o agente de impressão (Windows)
              </summary>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  Peça ao suporte o arquivo <strong>mesari-print-agent.exe</strong> (ou a pasta
                  print-agent) e copie para o computador do caixa.
                </li>
                <li>
                  Dê dois cliques no <strong>mesari-print-agent.exe</strong>. Uma janela preta fica
                  aberta: é o agente rodando. Se o Windows perguntar, permita o acesso.
                </li>
                <li>
                  Para iniciar junto com o Windows, rode <strong>instalar-inicializacao.bat</strong>{" "}
                  na mesma pasta.
                </li>
                <li>Volte aqui e clique em "Verificar de novo". O status deve ficar "Rodando".</li>
                <li>
                  Se o Chrome perguntar se o site pode acessar dispositivos da rede local, clique em
                  "Permitir".
                </li>
              </ol>
            </details>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

async function loadRecentTickets(): Promise<(KitchenTicket & { printedAt: number | null })[]> {
  const { data, error } = await supabase
    .from("pedidos_cozinha")
    .select(
      "id,numero,mesa_numero,setor,garcom_nome,adicional,itens,criado_em,impresso_em,origem,dados",
    )
    .order("criado_em", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).flatMap((value) => {
    const row = value as Record<string, unknown>;
    if (!Array.isArray(row["itens"])) return [];
    const origin = row["origem"];
    const external = origin === "entrega" || origin === "retirada";
    const details =
      typeof row["dados"] === "object" && row["dados"] !== null && !Array.isArray(row["dados"])
        ? (row["dados"] as Record<string, unknown>)
        : {};
    const paymentValue = details["pagamento_previsto"];
    const payment =
      typeof paymentValue === "object" && paymentValue !== null && !Array.isArray(paymentValue)
        ? (paymentValue as Record<string, unknown>)
        : {};
    const number = Number(details["numero_dia"] ?? row["numero"]);
    const ticket: KitchenTicket & { printedAt: number | null } = {
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
      items: (row["itens"] as unknown[]).map((entry) => {
        const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
          string,
          unknown
        >;
        return {
          product: String(item["produto"] ?? ""),
          quantity: Number(item["quantidade"]),
          note: String(item["observacao"] ?? ""),
          ...(typeof item["valor_unitario"] === "number"
            ? { unitPrice: item["valor_unitario"] }
            : {}),
        };
      }),
    };
    if (external) {
      ticket.external = {
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
      };
    }
    return [ticket];
  });
}
