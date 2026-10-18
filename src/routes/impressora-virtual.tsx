import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Printer, RotateCcw, Scissors, Trash2 } from "lucide-react";
import { AppShell, Btn } from "@/components/ui-kit";
import { useConfirm } from "@/components/system-dialog-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { decodeEscPos, previewToText, type LinhaPreview } from "@/lib/escpos-preview";
import { getPrintSettings } from "@/lib/printing";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  clearVirtualJobs,
  reprintVirtualJob,
  useVirtualJobs,
  type VirtualPrintJob,
} from "@/lib/virtual-printer";

export const Route = createFileRoute("/impressora-virtual")({
  head: () => ({
    meta: [
      { title: "Impressora virtual | Mesari" },
      {
        name: "description",
        content: "Veja na tela o que sairia na impressora térmica, sem precisar de impressora.",
      },
    ],
  }),
  component: ImpressoraVirtual,
});

const tipoLabel: Record<VirtualPrintJob["tipo"], string> = {
  comanda: "Comanda",
  recibo: "Recibo",
  teste: "Teste",
};

function ImpressoraVirtual() {
  const role = useStore((snapshot) => snapshot.user?.role);
  const navigate = useNavigate();
  const jobs = useVirtualJobs();
  const confirmar = useConfirm();
  // ?janela=1: janela lateral do modo demonstração, sem o menu do sistema.
  const compact =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("janela") === "1";
  const simulating = getPrintSettings().printerMode === "simulacao";

  useEffect(() => {
    if (role && role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [navigate, role]);
  if (role !== "caixa") return null;

  const clear = async () => {
    if (
      await confirmar({
        title: "Limpar a fila?",
        description: "Todos os papéis da impressora virtual serão apagados desta tela.",
        confirmText: "Limpar",
        variant: "danger",
      })
    ) {
      clearVirtualJobs();
    }
  };

  const content = (
    <main className={cn("mx-auto max-w-5xl", compact ? "p-3" : "p-5")}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="font-display text-xl font-extrabold text-ink">Impressora virtual</h1>
          <p className="text-xs text-muted-foreground">
            {jobs.length} {jobs.length === 1 ? "papel" : "papéis"} · mais recente primeiro · guarda
            os últimos 50
          </p>
        </div>
        <Btn variant="outline" disabled={!jobs.length} onClick={() => void clear()}>
          <Trash2 className="h-4 w-4" />
          Limpar fila
        </Btn>
      </div>
      {!simulating && (
        <p className="mb-4 rounded-lg border border-bill/30 bg-bill-bg px-4 py-3 text-sm text-ink">
          A simulação está desligada: as impressões estão indo para a impressora de verdade.{" "}
          <Link to="/impressao" className="font-semibold text-primary underline">
            Ligar em Impressão
          </Link>
        </p>
      )}
      {jobs.length === 0 ? (
        <div className="grid min-h-60 place-items-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>
            <Printer className="mx-auto mb-2 h-8 w-8" />
            Nenhum papel ainda. Lance um pedido, feche uma conta ou imprima uma página de teste.
          </p>
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-5",
            compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(330px,1fr))]",
          )}
        >
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </main>
  );

  return compact ? content : <AppShell center="Impressora virtual">{content}</AppShell>;
}

export function JobCard({ job }: { job: VirtualPrintJob }) {
  const preview = useMemo(
    () => (job.escpos ? decodeEscPos(job.escpos, { columns: job.colunas }) : null),
    [job.escpos, job.colunas],
  );
  const overflow = preview?.linhas.filter(
    (linha) => linha.tipo === "texto" && linha.estoura,
  ).length;

  const download = () => {
    const text = preview
      ? previewToText(preview, job.colunas)
      : (new DOMParser().parseFromString(job.html, "text/html").body.innerText ?? "");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date(job.criadoEm).toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = url;
    link.download = `mesari-${job.tipo}-${stamp}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article className="rounded-xl border bg-card p-3 shadow-sm">
      <header className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-sm bg-primary px-2 py-0.5 font-semibold text-white">
          {tipoLabel[job.tipo]}
        </span>
        {job.setor && (
          <span className="rounded-sm bg-muted px-2 py-0.5 font-semibold uppercase text-ink">
            {job.setor}
          </span>
        )}
        {typeof job.mesa === "number" && (
          <span className="rounded-sm bg-muted px-2 py-0.5 font-semibold text-ink">
            Mesa {String(job.mesa).padStart(2, "0")}
          </span>
        )}
        {job.reimpressao && (
          <span className="rounded-sm bg-bill-bg px-2 py-0.5 font-semibold text-bill">
            Reimpressão
          </span>
        )}
        <span className="ml-auto text-muted-foreground">
          {new Date(job.criadoEm).toLocaleString("pt-BR")}
        </span>
      </header>
      <div className="mb-2 text-sm font-semibold text-ink">
        {job.titulo} · {job.larguraMm} mm
      </div>
      {overflow ? (
        <p className="mb-2 rounded-md bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
          {overflow} {overflow === 1 ? "linha passa" : "linhas passam"} de {job.colunas} colunas
        </p>
      ) : null}
      <Tabs defaultValue={preview ? "termica" : "visual"}>
        <TabsList className="mb-2 grid w-full grid-cols-2">
          <TabsTrigger value="visual">Visual (HTML)</TabsTrigger>
          <TabsTrigger value="termica" disabled={!preview}>
            Térmica (ESC/POS)
          </TabsTrigger>
        </TabsList>
        <TabsContent value="visual">
          <PaperRoll widthMm={job.larguraMm}>
            <HtmlPaper html={job.html} widthMm={job.larguraMm} />
          </PaperRoll>
        </TabsContent>
        <TabsContent value="termica">
          {preview ? (
            <PaperRoll widthMm={job.larguraMm}>
              <ThermalPaper linhas={preview.linhas} widthMm={job.larguraMm} columns={job.colunas} />
            </PaperRoll>
          ) : (
            <p className="p-4 text-center text-xs text-muted-foreground">
              O recibo é impresso a partir do HTML (não tem versão ESC/POS).
            </p>
          )}
          {preview && (
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              Tabela {preview.tabela} · {job.colunas} colunas
            </p>
          )}
        </TabsContent>
      </Tabs>
      <footer className="mt-3 flex flex-wrap gap-2">
        <Btn variant="outline" size="sm" onClick={() => reprintVirtualJob(job.id)}>
          <RotateCcw className="h-4 w-4" />
          Reimprimir na fila
        </Btn>
        <Btn variant="outline" size="sm" onClick={download}>
          <Download className="h-4 w-4" />
          Baixar .txt
        </Btn>
      </footer>
    </article>
  );
}

/** Fundo cinza com a bobina branca na largura real (CSS mm ≈ mm na tela em 96 dpi). */
function PaperRoll({ widthMm, children }: { widthMm: number; children: ReactNode }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg bg-muted/60 p-3">
      <div
        className="mx-auto bg-white text-black shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
        style={{ width: `${widthMm}mm` }}
      >
        {children}
      </div>
    </div>
  );
}

function HtmlPaper({ html, widthMm }: { html: string; widthMm: number }) {
  const [height, setHeight] = useState(200);
  return (
    <iframe
      title="Papel impresso"
      srcDoc={html}
      // Sem scripts; same-origin só para medir a altura do conteúdo.
      sandbox="allow-same-origin"
      className="block border-0"
      style={{ width: `${widthMm}mm`, height }}
      onLoad={(event) => {
        const body = event.currentTarget.contentDocument?.body;
        if (body) setHeight(Math.max(80, body.scrollHeight + 8));
      }}
    />
  );
}

function ThermalPaper({
  linhas,
  widthMm,
  columns,
}: {
  linhas: LinhaPreview[];
  widthMm: number;
  columns: number;
}) {
  // Área imprimível aproximada: 48 mm na bobina de 58 e 72 mm na de 80.
  const printableMm = widthMm === 58 ? 48 : 72;
  const fontMm = printableMm / (columns * 0.6);
  return (
    <div
      className="py-3 font-mono leading-[1.35]"
      style={{ fontSize: `${fontMm}mm`, paddingInline: `${(widthMm - printableMm) / 2}mm` }}
    >
      {linhas.map((linha, index) => {
        if (linha.tipo === "corte") {
          return (
            <div
              key={index}
              className="my-2 flex items-center gap-1 border-t-2 border-dashed border-neutral-400 pt-1 text-[10px] text-neutral-500"
            >
              <Scissors className="h-3 w-3" />
              {linha.parcial ? "corte parcial" : "corte total"}
            </div>
          );
        }
        if (linha.tipo === "gaveta") {
          return (
            <div key={index} className="text-[10px] text-neutral-500">
              [abre a gaveta]
            </div>
          );
        }
        return (
          <div
            key={index}
            title={linha.estoura ? `Passa de ${columns} colunas (${linha.colunas})` : undefined}
            className={cn(
              "min-h-[1.35em] whitespace-pre",
              linha.negrito && "font-bold",
              linha.estoura && "bg-red-100 text-red-700 outline outline-1 outline-red-500",
            )}
            style={{
              textAlign:
                linha.alinhamento === "centro"
                  ? "center"
                  : linha.alinhamento === "direita"
                    ? "right"
                    : "left",
              fontSize: linha.tamanhoDuplo ? "2em" : undefined,
              lineHeight: linha.tamanhoDuplo ? 1.15 : undefined,
            }}
          >
            {linha.texto}
          </div>
        );
      })}
    </div>
  );
}
