import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  IntegerInput,
  MoneyInput,
  PasswordInput,
  PhoneInput,
  UsernameInput,
} from "@/components/inputs";

function Money({ max }: { max?: number }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <>
      <MoneyInput aria-label="Preço" required value={value} max={max} onChange={setValue} />
      <output data-testid="limpo">{String(value)}</output>
    </>
  );
}

function Phone() {
  const [value, setValue] = useState("");
  return (
    <>
      <PhoneInput aria-label="Telefone" value={value} onChange={setValue} />
      <output data-testid="limpo">{value}</output>
    </>
  );
}

describe("campos com máscara", () => {
  it("dinheiro: digitar 1250 mostra 12,50 e guarda centavos", () => {
    render(<Money />);
    const input = screen.getByRole("textbox", { name: "Preço" });
    fireEvent.change(input, { target: { value: "1250" } });
    expect(input).toHaveValue("12,50");
    expect(screen.getByTestId("limpo")).toHaveTextContent("1250");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("dinheiro: colar 'R$ 1.234,56' entende o valor", () => {
    render(<Money />);
    const input = screen.getByRole("textbox", { name: "Preço" });
    fireEvent.paste(input, { clipboardData: { getData: () => "R$ 1.234,56" } });
    expect(input).toHaveValue("1.234,56");
    expect(screen.getByTestId("limpo")).toHaveTextContent("123456");
  });

  it("dinheiro: recusa passar do máximo", () => {
    render(<Money max={50_000} />);
    const input = screen.getByRole("textbox", { name: "Preço" });
    fireEvent.change(input, { target: { value: "50000" } });
    fireEvent.change(input, { target: { value: "500,001" } });
    expect(input).toHaveValue("500,00");
  });

  it("erro só aparece depois de sair do campo", () => {
    render(<Money />);
    const input = screen.getByRole("textbox", { name: "Preço" });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o valor.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("telefone: colar com +55 formata e salva só dígitos", () => {
    render(<Phone />);
    const input = screen.getByRole("textbox", { name: "Telefone" });
    fireEvent.change(input, { target: { value: "+55 81 99999-9999" } });
    expect(input).toHaveValue("(81) 9 9999-9999");
    expect(screen.getByTestId("limpo")).toHaveTextContent("81999999999");
    expect(input).toHaveAttribute("type", "tel");
  });

  it("telefone sem DDD mostra erro ao sair do campo", () => {
    render(<Phone />);
    const input = screen.getByRole("textbox", { name: "Telefone" });
    fireEvent.change(input, { target: { value: "99999999" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o telefone com DDD");
  });

  it("usuário de cadastro tira acento, espaço e maiúscula", () => {
    function Username() {
      const [value, setValue] = useState("");
      return <UsernameInput aria-label="Usuário" value={value} onChange={setValue} />;
    }
    render(<Username />);
    const input = screen.getByRole("textbox", { name: "Usuário" });
    fireEvent.change(input, { target: { value: "João Silva" } });
    expect(input).toHaveValue("joaosilva");
  });

  it("inteiro: só dígitos e mostra o limite no erro", () => {
    function Quantity() {
      const [value, setValue] = useState<number | null>(1);
      return (
        <IntegerInput aria-label="Quantidade" min={1} max={99} value={value} onChange={setValue} />
      );
    }
    render(<Quantity />);
    const input = screen.getByRole("textbox", { name: "Quantidade" });
    fireEvent.change(input, { target: { value: "1a2" } });
    expect(input).toHaveValue("12");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("Informe um número de 1 a 99.");
  });

  it("senha: mostrar/ocultar e mínimo de 6 no cadastro", () => {
    function Password() {
      const [value, setValue] = useState("");
      return <PasswordInput aria-label="Senha" value={value} onChange={setValue} />;
    }
    const { container } = render(<Password />);
    const input = container.querySelector("input")!;
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(input).toHaveAttribute("type", "text");
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("mínimo 6 caracteres");
  });
});
