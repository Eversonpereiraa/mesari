import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCheck,
  FlaskConical,
  Hand,
  MessageCircle,
  PackageCheck,
  Send,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, Btn, Field } from "@/components/ui-kit";
import { supabase } from "@/lib/supabase";
import { brl, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  lerConfig,
  listarConversas,
  listarMensagens,
  mapMensagem,
  marcarLida,
  mudarStatus,
  responderCliente,
  salvarConfig,
  simularCliente,
  statusInfo,
  telefoneLegivel,
  type ConfigWhatsapp,
  type Conversa,
  type ConversaStatus,
  type Mensagem,
} from "@/lib/whatsapp";
import { errorMessage } from "@/lib/store";

export const Route = createFileRoute("/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp | Mesari" },
      { name: "description", content: "Atendimento e pedidos pelo WhatsApp com robô." },
    ],
  }),
  component: WhatsappPage,
});

const colunas: ConversaStatus[] = ["humano", "bot", "pedido", "finalizado"];

const hora = (ms: number) => {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const hoje = new Date();
  return d.toDateString() === hoje.toDateString()
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

const telefoneTeste = () => `55819${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

function WhatsappPage() {
  const user = useStore((s) => s.user);
  const loading = useStore((s) => s.loading);
  const deliveryAllowed = useStore((s) => s.plan?.plan.delivery ?? true);
  const navigate = useNavigate();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<ConversaStatus>("bot");
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);
  const [configAberta, setConfigAberta] = useState(false);
  const [config, setConfig] = useState<ConfigWhatsapp | null>(null);
  const statusAnterior = useRef(new Map<string, ConversaStatus>());
  const primeiraCarga = useRef(false);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/", replace: true });
    if (user && user.role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [loading, navigate, user]);

  const recarregar = useCallback(async () => {
    try {
      const lista = await listarConversas();
      // Aviso quando o robô passa uma conversa para o dono.
      for (const c of lista) {
        const antes = statusAnterior.current.get(c.id);
        if (antes && antes !== "humano" && c.status === "humano") {
          toast.warning(`${c.nome || telefoneLegivel(c.telefone)} precisa de você no WhatsApp.`);
        }
        statusAnterior.current.set(c.id, c.status);
      }
      setConversas(lista);
      if (!primeiraCarga.current) {
        primeiraCarga.current = true;
        if (lista.some((c) => c.status === "humano")) setAba("humano");
      }
      setErro("");
    } catch (e) {
      setErro(errorMessage(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== "caixa") return;
    void recarregar();
    void lerConfig()
      .then(setConfig)
      .catch(() => setConfig({ roboAtivo: true, instrucoes: "" }));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canal = supabase
      .channel("whatsapp-conversas")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversas" }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void recarregar(), 150);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(canal);
    };
  }, [recarregar, user?.id, user?.role]);

  const contagem = useMemo(() => {
    const c: Record<ConversaStatus, number> = { bot: 0, humano: 0, pedido: 0, finalizado: 0 };
    conversas.forEach((x) => (c[x.status] += 1));
    return c;
  }, [conversas]);
  const visiveis = conversas.filter((c) => c.status === aba);
  const selecionada = conversas.find((c) => c.id === selecionadaId) ?? null;

  if (user?.role !== "caixa") return null;

  if (!deliveryAllowed) {
    return (
      <AppShell center="WhatsApp">
        <div className="mx-auto max-w-lg p-8 text-center">
          <MessageCircle className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 font-display text-xl font-extrabold text-ink">WhatsApp com robô</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Disponível a partir do plano Profissional, junto com o Delivery.
          </p>
          <Link
            to="/plano"
            className="mt-4 inline-block text-sm font-semibold text-primary underline"
          >
            Ver planos
          </Link>
        </div>
      </AppShell>
    );
  }

  const alternarRobo = async () => {
    if (!config) return;
    const proximo = { ...config, roboAtivo: !config.roboAtivo };
    setConfig(proximo);
    try {
      await salvarConfig(proximo);
      toast.success(
        proximo.roboAtivo ? "Robô ligado." : "Robô desligado: novas conversas vão para você.",
      );
    } catch (e) {
      setConfig(config);
      toast.error(errorMessage(e));
    }
  };

  return (
    <AppShell center="WhatsApp">
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[1440px] flex-col gap-3 p-3 md:p-5">
        <header
          className={cn("flex flex-wrap items-center gap-3", selecionada && "hidden lg:flex")}
        >
          <div className="min-w-[240px] flex-1">
            <h1 className="font-display text-2xl font-extrabold text-ink">WhatsApp</h1>
            <p className="text-sm text-muted-foreground">
              O robô anota o pedido, confirma com o cliente e manda direto para o Delivery.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config?.roboAtivo ?? true}
            disabled={!config}
            onClick={() => void alternarRobo()}
            className={cn(
              "flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold",
              config?.roboAtivo === false
                ? "border-border bg-muted text-muted-foreground"
                : "border-free/30 bg-free-bg text-free",
            )}
          >
            <Bot className="h-4 w-4" /> Robô {config?.roboAtivo === false ? "desligado" : "ligado"}
          </button>
          <Btn variant="outline" onClick={() => setConfigAberta(true)} disabled={!config}>
            <Settings2 className="h-4 w-4" /> Instruções
          </Btn>
          <Btn onClick={() => setNovaAberta(true)}>
            <FlaskConical className="h-4 w-4" /> Testar como cliente
          </Btn>
        </header>

        {erro && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {erro}
          </p>
        )}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(300px,380px)_1fr]">
          <section
            className={cn(
              "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card",
              selecionada && "hidden lg:flex",
            )}
          >
            <nav className="grid grid-cols-4 border-b" aria-label="Filtrar conversas">
              {colunas.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setAba(s)}
                  aria-pressed={aba === s}
                  className={cn(
                    "flex flex-col items-center gap-0.5 border-b-2 px-1 py-2 text-[11px] font-semibold",
                    aba === s
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-ink",
                  )}
                >
                  <span
                    className={cn(
                      "num min-w-6 rounded-full px-1.5 text-xs font-bold",
                      s === "humano" && contagem.humano > 0
                        ? "bg-busy text-white"
                        : "bg-muted text-ink",
                    )}
                  >
                    {contagem[s]}
                  </span>
                  <span className="text-center leading-tight">{statusInfo[s].label}</span>
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 divide-y overflow-y-auto">
              {carregando ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Carregando conversas...
                </p>
              ) : visiveis.length === 0 ? (
                <Vazio
                  aba={aba}
                  semNenhuma={conversas.length === 0}
                  onTestar={() => setNovaAberta(true)}
                />
              ) : (
                visiveis.map((c) => (
                  <ItemConversa
                    key={c.id}
                    conversa={c}
                    ativa={c.id === selecionadaId}
                    onClick={() => setSelecionadaId(c.id)}
                  />
                ))
              )}
            </div>
          </section>

          <section
            className={cn(
              "min-h-0 overflow-hidden rounded-xl border bg-card",
              !selecionada && "hidden lg:block",
            )}
          >
            {selecionada ? (
              <Chat
                key={selecionada.id}
                conversa={selecionada}
                onVoltar={() => setSelecionadaId(null)}
                onStatus={(s) => setAba(s)}
              />
            ) : (
              <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
                <div>
                  <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Escolha uma conversa ao lado.
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {novaAberta && (
        <NovaSimulacao
          onClose={() => setNovaAberta(false)}
          onCriada={(id) => {
            setNovaAberta(false);
            setAba("bot");
            setSelecionadaId(id);
            void recarregar();
          }}
        />
      )}
      {configAberta && config && (
        <ConfigDialog
          config={config}
          onClose={() => setConfigAberta(false)}
          onSalvo={(c) => {
            setConfig(c);
            setConfigAberta(false);
          }}
        />
      )}
    </AppShell>
  );
}

function Vazio({
  aba,
  semNenhuma,
  onTestar,
}: {
  aba: ConversaStatus;
  semNenhuma: boolean;
  onTestar: () => void;
}) {
  if (semNenhuma) {
    return (
      <div className="space-y-3 p-6 text-center text-sm text-muted-foreground">
        <Bot className="mx-auto h-8 w-8 text-primary" />
        <p>
          Ainda não há conversas. Teste agora: você escreve como se fosse o cliente e vê o robô
          montar o pedido sozinho.
        </p>
        <Btn size="sm" onClick={onTestar}>
          <FlaskConical className="h-4 w-4" /> Testar como cliente
        </Btn>
      </div>
    );
  }
  const textos: Record<ConversaStatus, string> = {
    humano: "Nenhuma conversa esperando por você.",
    bot: "O robô não está atendendo ninguém agora.",
    pedido: "Nenhum pedido lançado pelo WhatsApp.",
    finalizado: "Nenhuma conversa finalizada.",
  };
  return <p className="p-6 text-center text-sm text-muted-foreground">{textos[aba]}</p>;
}

function ItemConversa({
  conversa,
  ativa,
  onClick,
}: {
  conversa: Conversa;
  ativa: boolean;
  onClick: () => void;
}) {
  const nome = conversa.nome || telefoneLegivel(conversa.telefone);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 p-3 text-left hover:bg-muted/60",
        ativa && "bg-accent",
      )}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">
        {nome.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-ink">{nome}</span>
          {conversa.canal === "simulador" && (
            <span className="rounded bg-bill-bg px-1.5 py-0.5 text-[10px] font-bold text-ink">
              TESTE
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {hora(conversa.ultimaEm)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="line-clamp-1 flex-1 text-xs text-muted-foreground">
            {conversa.ultimaMensagem}
          </span>
          {conversa.naoLidas > 0 && (
            <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-free px-1 text-[11px] font-bold text-white">
              {conversa.naoLidas}
            </span>
          )}
        </span>
        {conversa.itens.length > 0 && conversa.status !== "pedido" && (
          <span className="mt-1 block text-[11px] font-semibold text-primary">
            {conversa.etapa === "confirmando" ? "Aguardando confirmação" : "Montando pedido"} ·{" "}
            {conversa.itens.reduce((s, i) => s + i.quantidade, 0)} item(ns)
          </span>
        )}
      </span>
    </button>
  );
}

function Chat({
  conversa,
  onVoltar,
  onStatus,
}: {
  conversa: Conversa;
  onVoltar: () => void;
  onStatus: (s: ConversaStatus) => void;
}) {
  const produtos = useStore((s) => s.items);
  const taxa = useStore((s) => s.restaurant.deliveryFee);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [comoCliente, setComoCliente] = useState(conversa.canal === "simulador");
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const nome = conversa.nome || telefoneLegivel(conversa.telefone);

  useEffect(() => {
    let ativo = true;
    void listarMensagens(conversa.id)
      .then((m) => ativo && setMensagens(m))
      .catch((e) => ativo && setErro(errorMessage(e)));
    const canal = supabase
      .channel(`whatsapp-mensagens-${conversa.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "whatsapp_mensagens",
          filter: `conversa_id=eq.${conversa.id}`,
        },
        (payload) => {
          const nova = mapMensagem(payload.new);
          setMensagens((atual) => (atual.some((m) => m.id === nova.id) ? atual : [...atual, nova]));
        },
      )
      .subscribe();
    return () => {
      ativo = false;
      void supabase.removeChannel(canal);
    };
  }, [conversa.id]);

  // Conversa aberta = lida.
  useEffect(() => {
    if (conversa.naoLidas > 0) void marcarLida(conversa.id).catch(() => undefined);
  }, [conversa.id, conversa.naoLidas]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length, enviando]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo || enviando) return;
    setEnviando(true);
    setErro("");
    setTexto("");
    try {
      if (comoCliente) {
        await simularCliente({ telefone: conversa.telefone, nome: conversa.nome, texto: conteudo });
      } else {
        await responderCliente(conversa.id, conteudo);
      }
      // Garante a lista atualizada mesmo se o tempo real atrasar.
      setMensagens(await listarMensagens(conversa.id));
    } catch (err) {
      setErro(errorMessage(err));
      setTexto(conteudo);
    } finally {
      setEnviando(false);
    }
  };

  const status = async (s: ConversaStatus) => {
    try {
      await mudarStatus(conversa.id, s);
      onStatus(s);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const linhas = conversa.itens.map((i) => {
    const p = produtos.find((x) => x.id === i.produtoId);
    return { ...i, nome: p?.name ?? "Produto", valor: (p?.price ?? 0) * i.quantidade };
  });
  const subtotal = linhas.reduce((s, l) => s + l.valor, 0);
  const total = subtotal + (conversa.tipo === "entrega" ? taxa : 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b p-3">
        <button
          type="button"
          onClick={onVoltar}
          aria-label="Voltar"
          className="rounded-md p-1 lg:hidden"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 font-bold text-primary">
          {nome.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <div className="truncate font-semibold text-ink">{nome}</div>
          <div className="text-xs text-muted-foreground">
            {telefoneLegivel(conversa.telefone)} · {statusInfo[conversa.status].label}
            {conversa.canal === "simulador" && " · conversa de teste"}
          </div>
        </div>
        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
          {conversa.status === "bot" && (
            <Btn size="sm" variant="outline" onClick={() => void status("humano")}>
              <Hand className="h-4 w-4" /> Assumir
            </Btn>
          )}
          {conversa.status === "humano" && (
            <Btn size="sm" variant="outline" onClick={() => void status("bot")}>
              <Bot className="h-4 w-4" /> Devolver ao robô
            </Btn>
          )}
          {conversa.pedidoId && conversa.status === "pedido" && (
            <Link
              to="/delivery"
              className="inline-flex h-8 items-center gap-1 rounded-md bg-success px-3 text-sm font-medium text-success-foreground"
            >
              <PackageCheck className="h-4 w-4" /> Ver no Delivery
            </Link>
          )}
          {conversa.status !== "finalizado" && (
            <Btn size="sm" variant="ghost" onClick={() => void status("finalizado")}>
              <CheckCheck className="h-4 w-4" /> Finalizar
            </Btn>
          )}
        </div>
      </header>

      {linhas.length > 0 && (conversa.status === "bot" || conversa.status === "humano") && (
        <div className="border-b bg-accent/60 px-4 py-2 text-xs">
          <div className="mb-1 font-semibold text-ink">
            {conversa.etapa === "confirmando"
              ? "Resumo enviado — aguardando o cliente confirmar"
              : "Pedido sendo montado"}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
            {linhas.map((l) => (
              <span key={`${l.produtoId}-${l.observacao}`}>
                {l.quantidade}x {l.nome}
                {l.observacao && ` (${l.observacao})`}
              </span>
            ))}
            <span className="num font-semibold text-ink">≈ {brl(total)}</span>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/40 p-4">
        {mensagens.map((m) => (
          <Bolha key={m.id} mensagem={m} />
        ))}
        {enviando && comoCliente && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bot className="h-4 w-4 animate-pulse" /> Robô digitando...
          </div>
        )}
        <div ref={fim} />
      </div>

      {erro && (
        <p role="alert" className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <form onSubmit={(e) => void enviar(e)} className="space-y-2 border-t p-3">
        {conversa.canal === "simulador" && (
          <div
            className="flex flex-wrap items-center gap-1 text-xs"
            role="radiogroup"
            aria-label="Escrever como"
          >
            <span className="mr-1 text-muted-foreground">Escrever como:</span>
            {[
              { v: true, label: "Cliente (teste)", Icon: UserRound },
              { v: false, label: "Atendente (você)", Icon: Hand },
            ].map(({ v, label, Icon }) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={comoCliente === v}
                onClick={() => setComoCliente(v)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold",
                  comoCliente === v
                    ? "border-primary bg-primary text-white"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="field flex-1"
            placeholder={
              comoCliente ? "Ex.: quero um cuscuz de frango pra entrega" : "Responder ao cliente..."
            }
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={2000}
            aria-label="Mensagem"
          />
          <Btn type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar">
            <Send className="h-4 w-4" />
          </Btn>
        </div>
        {!comoCliente && conversa.status === "bot" && (
          <p className="text-[11px] text-muted-foreground">
            Ao responder você assume a conversa e o robô para.
          </p>
        )}
      </form>
    </div>
  );
}

function Bolha({ mensagem }: { mensagem: Mensagem }) {
  if (mensagem.autor === "sistema") {
    return (
      <div className="mx-auto flex max-w-md items-start gap-2 rounded-lg bg-bill-bg px-3 py-2 text-xs text-ink">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {mensagem.texto}
      </div>
    );
  }
  const cliente = mensagem.autor === "cliente";
  return (
    <div className={cn("flex", cliente ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm",
          cliente ? "rounded-bl-sm bg-card text-ink" : "rounded-br-sm",
          mensagem.autor === "bot" && "bg-free-bg text-ink",
          mensagem.autor === "atendente" && "bg-primary text-white",
        )}
      >
        {!cliente && (
          <div className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase opacity-70">
            {mensagem.autor === "bot" ? <Bot className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
            {mensagem.autor === "bot" ? "Robô" : "Você"}
          </div>
        )}
        {formatarWhatsapp(mensagem.texto)}
        <div className="mt-0.5 text-right text-[10px] opacity-60">{hora(mensagem.em)}</div>
        {mensagem.erroEnvio && (
          <div className="mt-1 rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            Não enviado: {mensagem.erroEnvio}
          </div>
        )}
      </div>
    </div>
  );
}

/** *negrito* do WhatsApp vira negrito na tela. */
function formatarWhatsapp(texto: string) {
  return texto
    .split(/(\*[^*\n]+\*)/g)
    .map((parte, i) =>
      /^\*[^*\n]+\*$/.test(parte) ? <strong key={i}>{parte.slice(1, -1)}</strong> : parte,
    );
}

function NovaSimulacao({
  onClose,
  onCriada,
}: {
  onClose: () => void;
  onCriada: (id: string) => void;
}) {
  const [nome, setNome] = useState("Cliente teste");
  const [telefone] = useState(telefoneTeste);
  const [texto, setTexto] = useState("Boa noite! Quero um cuscuz recheado pra entrega");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      const r = await simularCliente({ telefone, nome, texto });
      onCriada(String(r["conversaId"] ?? ""));
    } catch (err) {
      setErro(errorMessage(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <form
        onSubmit={(e) => void enviar(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-xl border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">Testar como cliente</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Você escreve como se fosse o cliente no WhatsApp. O robô responde usando o seu
              cardápio. Pedidos confirmados aqui entram de verdade no Delivery (e imprimem).
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <Field label="Nome do cliente">
          <input
            className="field"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={80}
          />
        </Field>
        <Field label="Primeira mensagem">
          <textarea
            className="field min-h-20 py-2"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={2000}
            required
          />
        </Field>
        {erro && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {erro}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" disabled={enviando || !texto.trim()}>
            {enviando ? "Robô pensando..." : "Enviar"}
          </Btn>
        </div>
      </form>
    </div>
  );
}

function ConfigDialog({
  config,
  onClose,
  onSalvo,
}: {
  config: ConfigWhatsapp;
  onClose: () => void;
  onSalvo: (c: ConfigWhatsapp) => void;
}) {
  const [instrucoes, setInstrucoes] = useState(config.instrucoes);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      const proximo = { ...config, instrucoes };
      await salvarConfig(proximo);
      toast.success("Instruções do robô salvas.");
      onSalvo(proximo);
    } catch (err) {
      setErro(errorMessage(err));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <form
        onSubmit={(e) => void salvar(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-5 shadow-2xl"
      >
        <h2 className="font-display text-xl font-bold text-ink">Instruções para o robô</h2>
        <p className="text-sm text-muted-foreground">
          O robô já usa o cardápio, os preços e a taxa de entrega do Mesari. Aqui vão regras da
          casa.
        </p>
        <Field label="Instruções" hint={`${instrucoes.length}/2000`}>
          <textarea
            className="field min-h-40 py-2"
            value={instrucoes}
            onChange={(e) => setInstrucoes(e.target.value.slice(0, 2000))}
            placeholder={
              "Ex.:\n- Funcionamos das 18h às 23h, de terça a domingo.\n- Não entregamos na zona rural.\n- O cuscuz recheado pode ser de milho ou de arroz; pergunte qual."
            }
          />
        </Field>
        {erro && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {erro}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Btn>
        </div>
      </form>
    </div>
  );
}
