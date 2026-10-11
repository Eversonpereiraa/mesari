import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaymentDialog } from "@/components/payment-dialog";

describe("modal de pagamento", () => {
  it("calcula troco em centavos e confirma o dinheiro recebido", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<PaymentDialog table={12} totalCents={10005} onClose={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Dinheiro" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor recebido do pagamento 1" }), {
      target: { value: "120,00" },
    });

    expect(screen.getByText("TROCO")).toBeInTheDocument();
    expect(screen.getByText(/19,95/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e imprimir" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith([{ forma: "dinheiro", valor: 100.05, recebido: 120 }]),
    );
  });

  it("mantém o modal aberto e mostra a mensagem real da RPC após falha", async () => {
    const onConfirm = vi.fn().mockRejectedValue({ message: "Falha ao fechar no banco" });
    render(<PaymentDialog table={4} totalCents={2500} onClose={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e imprimir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao fechar no banco");
    expect(screen.getByRole("dialog", { name: "Pagamento – Mesa 4" })).toBeInTheDocument();
  });
});
