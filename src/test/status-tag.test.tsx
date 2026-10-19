import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusTag } from "@/components/ui-kit";
import { formatPercent } from "@/lib/masks";

describe("selo de status", () => {
  it("no app do garçom diz 'Pedindo conta' e nunca corta o texto", () => {
    render(<StatusTag s="conta" variant="garcom" />);
    const tag = screen.getByText("Pedindo conta");
    expect(tag).toHaveClass("whitespace-nowrap", "shrink-0");
    expect(tag).not.toHaveClass("truncate");
  });

  it("por padrão continua 'Conta solicitada'", () => {
    render(<StatusTag s="conta" />);
    expect(screen.getByText("Conta solicitada")).toHaveClass("whitespace-nowrap");
  });

  it("nos cards do caixa (short) diz 'Pedindo conta' no tamanho normal", () => {
    render(<StatusTag s="conta" short />);
    const tag = screen.getByText("Pedindo conta");
    expect(tag).toHaveClass("text-xs");
    expect(tag).not.toHaveClass("text-[11px]");
  });
});

describe("percentual dos cards de forma de pagamento", () => {
  it("usa vírgula pt-BR e não mostra ',0' à toa", () => {
    expect(formatPercent(100)).toBe("100");
    expect(formatPercent(52.34)).toBe("52,3");
    expect(formatPercent(0)).toBe("0");
  });
});
