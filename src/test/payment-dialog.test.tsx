import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaymentDialog } from "@/components/payment-dialog";

describe("modal de pagamento", () => {
  it("preenche a primeira forma com o total a pagar", () => {
    render(<PaymentDialog table={12} totalCents={10005} onClose={vi.fn()} onConfirm={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Pix" }));

    expect(screen.getByRole("textbox", { name: "Valor do pagamento 1" })).toHaveValue("100,05");
    expect(screen.getByRole("button", { name: "Confirmar e imprimir" })).toBeEnabled();
  });

  it("calcula troco em centavos e confirma o dinheiro recebido", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<PaymentDialog table={12} totalCents={10005} onClose={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Dinheiro" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor do pagamento 1" }), {
      target: { value: "120,00" },
    });

    expect(screen.getByText("TROCO")).toBeInTheDocument();
    expect(screen.getByText(/19,95/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e imprimir" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith([{ forma: "dinheiro", valor: 100.05, recebido: 120 }]),
    );
  });

  it("preenche a nova forma com o restante e não deixa cartão passar dele", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<PaymentDialog table={5} totalCents={10000} onClose={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Pix" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor do pagamento 1" }), {
      target: { value: "60,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar forma de pagamento/ }));

    const second = screen.getByRole("textbox", { name: "Valor do pagamento 2" });
    expect(second).toHaveValue("40,00");

    const secondCredit = screen.getAllByRole("button", { name: "Crédito" })[1]!;
    fireEvent.click(secondCredit);
    fireEvent.change(second, { target: { value: "50,00" } });

    expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent(
      "Crédito não pode passar do restante",
    );
    expect(screen.queryByText("TROCO")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar e imprimir" })).toBeDisabled();

    fireEvent.change(second, { target: { value: "40,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e imprimir" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith([
        { forma: "pix", valor: 60 },
        { forma: "credito", valor: 40 },
      ]),
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
