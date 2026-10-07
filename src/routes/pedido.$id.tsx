import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { actions, useStore } from "@/lib/store";
import { MobileFrame } from "@/components/mobile-frame";
import { MenuPicker } from "@/components/menu-picker";

export const Route = createFileRoute("/pedido/$id")({
  head: () => ({
    meta: [
      { title: "Adicionar pedido | Mesari" },
      { name: "description", content: "Escolha itens do cardápio e lance na mesa." },
      { property: "og:title", content: "Adicionar pedido | Mesari" },
      { property: "og:description", content: "Escolha itens do cardápio e lance na mesa." },
    ],
  }),
  component: Pedido,
});

function Pedido() {
  const { id } = Route.useParams();
  const t = useStore((s) => s.tables.find((x) => x.id === id));
  const user = useStore((s) => s.user);
  return (
    <MobileFrame
      header={
        <>
          <Link to="/mesa/$id" params={{ id }} aria-label="Voltar" className="-ml-2 p-2 text-ink"><ChevronLeft className="h-5 w-5" /></Link>
          <h1 className="font-semibold text-ink">Pedido · Mesa {String(t?.number ?? "").padStart(2, "0")}</h1>
        </>
      }
    >
      <div className="h-full">
        <MenuPicker mobile onAdd={(i, q, n) => actions.addLine(id, i, q, n, user?.name ?? "Garçom")} />
      </div>
    </MobileFrame>
  );
}
