import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { MenuPicker, type MenuCartEntry } from "@/components/menu-picker";
import type { MenuItem } from "@/lib/store";

const cerveja: MenuItem = {
  id: "p1",
  name: "Cerveja",
  categoryId: "c1",
  price: 12,
  description: "",
  active: true,
};

function Harness({ onSubmit }: { onSubmit: (entries: MenuCartEntry[]) => Promise<void> }) {
  const [cart, setCart] = useState<MenuCartEntry[]>([{ item: cerveja, qty: 2, note: "gelada" }]);
  return (
    <MenuPicker
      mobile
      onAdd={vi.fn()}
      onSubmit={onSubmit}
      externalCart={cart}
      onCartChange={setCart}
    />
  );
}

describe("envio do pedido com falha", () => {
  it("mantém o carrinho e reenvia os mesmos itens em 'Tentar de novo'", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(undefined);
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("o pedido NÃO foi enviado");
    expect(screen.getByText(/2 itens/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[0]).toEqual([{ item: cerveja, qty: 2, note: "gelada" }]);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
