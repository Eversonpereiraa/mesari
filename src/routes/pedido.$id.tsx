import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { actions, useStore } from "@/lib/store";
import { MobileFrame } from "@/components/mobile-frame";
import { MenuPicker } from "@/components/menu-picker";
import { isKitchenStationOnline } from "@/lib/kitchen-presence";

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
  const navigate = useNavigate();
  return (
    <MobileFrame
      title={`Mesa ${String(t?.number ?? "").padStart(2, "0")}`}
      subtitle="Novo pedido"
      onBack={() => navigate({ to: "/mesa/$id", params: { id } })}
    >
      <div className="h-full">
        <MenuPicker
          mobile
          onAdd={(item, quantity, note, print = true) =>
            actions.addLine(id, item, quantity, note, print)
          }
          onSubmit={async (entries, print = true) => {
            const stationOnline = isKitchenStationOnline();
            await actions.addLines(id, entries, print);
            sessionStorage.setItem(
              "mesari-order-sent",
              `${id}:${print && !stationOnline ? "offline" : "ok"}`,
            );
            navigate({ to: "/mesa/$id", params: { id } });
          }}
        />
      </div>
    </MobileFrame>
  );
}
