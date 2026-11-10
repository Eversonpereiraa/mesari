import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  cleanName,
  displayCpfCnpj,
  formatCep,
  formatCnpj,
  formatCpf,
  formatCpfCnpj,
  formatDecimal,
  formatInstagram,
  formatInteger,
  formatIp,
  formatMoneyInput,
  formatPercent,
  formatPhone,
  formatPort,
  formatRestaurantCode,
  formatUsername,
  isValidCnpj,
  isValidCpf,
  isValidIp,
  isValidPhone,
  isValidPort,
  maskError,
  moneyFromDigits,
  onlyDigits,
  parseDecimal,
  parseInteger,
  parseMoney,
  phoneDigits,
} from "@/lib/masks";
import { MaskedInput, MoneyInput, type Mask } from "@/components/masked-input";

describe("telefone", () => {
  it("formata celular (11 dígitos) e fixo (10 dígitos)", () => {
    expect(formatPhone("81999998888")).toBe("(81) 99999-8888");
    expect(formatPhone("8133334444")).toBe("(81) 3333-4444");
  });

  it("formata enquanto digita", () => {
    expect(formatPhone("8")).toBe("(8");
    expect(formatPhone("81")).toBe("(81");
    expect(formatPhone("819")).toBe("(81) 9");
    expect(formatPhone("8133334")).toBe("(81) 3333-4");
  });

  it("aceita colar formatado, com +55, e corta em 11 dígitos", () => {
    expect(formatPhone("(81) 99999-8888")).toBe("(81) 99999-8888");
    expect(phoneDigits("+55 (81) 99999-8888")).toBe("81999998888");
    expect(phoneDigits("5581999998888")).toBe("81999998888");
    expect(phoneDigits("819999988887777")).toBe("81999998888");
    // DDD 55 (RS) não perde o 55.
    expect(phoneDigits("55999998888")).toBe("55999998888");
  });

  it("valida fixo e celular completos", () => {
    expect(isValidPhone("(81) 99999-8888")).toBe(true);
    expect(isValidPhone("(81) 3333-4444")).toBe(true);
    expect(isValidPhone("(81) 9999-8888")).toBe(false);
    expect(isValidPhone("(81) 3333-444")).toBe(false);
    expect(maskError("phone", "819999")).toMatch(/incompleto/);
    expect(maskError("phone", "8199998888")).toMatch(/Celular precisa ter 11/);
    expect(maskError("phone", "")).toBe("");
  });
});

describe("CPF e CNPJ", () => {
  it("formata CPF e CNPJ", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatCpf("5299")).toBe("529.9");
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatCnpj("112223330")).toBe("11.222.333/0");
  });

  it("escolhe CPF ou CNPJ pelo tamanho", () => {
    expect(formatCpfCnpj("52998224725")).toBe("529.982.247-25");
    expect(formatCpfCnpj("112223330001")).toBe("11.222.333/0001");
    expect(formatCpfCnpj("11.222.333/0001-81")).toBe("11.222.333/0001-81");
    expect(displayCpfCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("valida os dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
    expect(maskError("cpfCnpj", "52998224724")).toBe("CPF inválido. Confira os números.");
    expect(maskError("cpfCnpj", "11222333000180")).toBe("CNPJ inválido. Confira os números.");
    expect(maskError("cpfCnpj", "1122233")).toMatch(/incompleto/);
    expect(maskError("cpfCnpj", "11222333000181")).toBe("");
  });

  it("tira a máscara para o banco", () => {
    expect(onlyDigits("11.222.333/0001-81")).toBe("11222333000181");
  });
});

describe("dinheiro", () => {
  it("cada dígito entra pela direita", () => {
    expect(moneyFromDigits("1")).toBe(0.01);
    expect(moneyFromDigits("12")).toBe(0.12);
    expect(moneyFromDigits("123456")).toBe(1234.56);
    expect(moneyFromDigits("")).toBeNull();
    // Digitar mais um número no campo já formatado.
    expect(moneyFromDigits("R$ 1.234,567")).toBe(12345.67);
    // Apagar o último.
    expect(moneyFromDigits("R$ 1.234,5")).toBe(123.45);
  });

  it("mostra R$ 1.234,56", () => {
    expect(formatMoneyInput(1234.56)).toBe("R$ 1.234,56");
    expect(formatMoneyInput(1234.56, false)).toBe("1.234,56");
    expect(formatMoneyInput(null)).toBe("");
  });

  it("entende o que é colado", () => {
    expect(parseMoney("R$ 1.234,56")).toBe(1234.56);
    expect(parseMoney("1234.56")).toBe(1234.56);
    expect(parseMoney("1.234,56")).toBe(1234.56);
    expect(parseMoney("1,234.56")).toBe(1234.56);
    expect(parseMoney("1234,5")).toBe(1234.5);
    expect(parseMoney("50")).toBe(50);
    expect(parseMoney("1.234")).toBe(1234);
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("números, rede e textos", () => {
  it("inteiro com limites", () => {
    expect(formatInteger("a1b2")).toBe("12");
    expect(formatInteger("007")).toBe("7");
    expect(formatInteger("25", { max: 20 })).toBe("20");
    expect(parseInteger("0", { min: 1 })).toBe(1);
    expect(parseInteger("")).toBeNull();
  });

  it("decimal e porcentagem com vírgula", () => {
    expect(formatDecimal("12.5", { decimals: 1 })).toBe("12,5");
    expect(formatDecimal("12,55", { decimals: 1 })).toBe("12,5");
    expect(formatDecimal(",5")).toBe("0,5");
    expect(formatPercent("12,5")).toBe("12,5");
    expect(formatPercent("150")).toBe("100");
    expect(formatPercent("10,999")).toBe("10,99");
    expect(parseDecimal("12,5")).toBe(12.5);
    expect(parseDecimal("")).toBeNull();
  });

  it("IP e porta", () => {
    expect(formatIp("192168050")).toBe("192.168.050");
    expect(formatIp("192.168.0.50")).toBe("192.168.0.50");
    expect(formatIp("192..168")).toBe("192.168");
    expect(formatIp("1.2.3.4.5")).toBe("1.2.3.45");
    expect(isValidIp("192.168.0.50")).toBe(true);
    expect(isValidIp("192.168.0.256")).toBe(false);
    expect(isValidIp("192.168.0")).toBe(false);
    expect(formatPort("99999")).toBe("65535");
    expect(isValidPort("9100")).toBe(true);
    expect(isValidPort("0")).toBe(false);
  });

  it("CEP, código, usuário, Instagram e nomes", () => {
    expect(formatCep("50030230")).toBe("50030-230");
    expect(formatRestaurantCode("12a3456789")).toBe("123456");
    expect(formatUsername("João Silva")).toBe("joaosilva");
    expect(formatInstagram("meu restaurante")).toBe("@meurestaurante");
    expect(formatInstagram("@@cantina")).toBe("@cantina");
    expect(formatInstagram("https://www.instagram.com/cantina/")).toBe("@cantina");
    expect(formatInstagram("")).toBe("");
    expect(cleanName("  Maria   da  Silva ")).toBe("Maria da Silva");
  });
});

function Masked({ mask, initial = "" }: { mask: Mask; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MaskedInput aria-label="campo" mask={mask} value={value} onValueChange={setValue} />
      <output data-testid="valor">{value}</output>
    </>
  );
}

function Money() {
  const [value, setValue] = useState<number | null>(null);
  return (
    <>
      <MoneyInput aria-label="valor" value={value} onValueChange={setValue} />
      <output data-testid="numero">{String(value)}</output>
    </>
  );
}

describe("campos com máscara", () => {
  it("telefone mostra formatado e guarda só dígitos", () => {
    render(<Masked mask="phone" />);
    const input = screen.getByRole("textbox", { name: "campo" });
    fireEvent.change(input, { target: { value: "81999998888" } });
    expect(input).toHaveValue("(81) 99999-8888");
    expect(screen.getByTestId("valor")).toHaveTextContent(/^81999998888$/);
    expect(input).toHaveAttribute("inputmode", "tel");
    expect(input).toHaveAttribute("autocomplete", "tel");
  });

  it("mostra erro de CPF inválido ao sair do campo", () => {
    render(<Masked mask="cpfCnpj" />);
    const input = screen.getByRole("textbox", { name: "campo" });
    fireEvent.change(input, { target: { value: "529.982.247-24" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("CPF inválido");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "529.982.247-25" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dinheiro: digitar forma o valor da direita para a esquerda e guarda número", () => {
    render(<Money />);
    const input = screen.getByRole("textbox", { name: "valor" });
    fireEvent.change(input, { target: { value: "1" } });
    expect(input).toHaveValue("R$ 0,01");
    fireEvent.change(input, { target: { value: "R$ 0,012" } });
    expect(input).toHaveValue("R$ 0,12");
    fireEvent.change(input, { target: { value: "R$ 0,1234" } });
    expect(input).toHaveValue("R$ 12,34");
    expect(screen.getByTestId("numero")).toHaveTextContent("12.34");
  });

  it("dinheiro: colar 'R$ 1.234,56' e '1234.56'", () => {
    render(<Money />);
    const input = screen.getByRole("textbox", { name: "valor" });
    fireEvent.paste(input, { clipboardData: { getData: () => "R$ 1.234,56" } });
    expect(input).toHaveValue("R$ 1.234,56");
    expect(screen.getByTestId("numero")).toHaveTextContent("1234.56");
    fireEvent.paste(input, { clipboardData: { getData: () => "1234.56" } });
    expect(input).toHaveValue("R$ 1.234,56");
    fireEvent.paste(input, { clipboardData: { getData: () => "50" } });
    expect(input).toHaveValue("R$ 50,00");
    expect(screen.getByTestId("numero")).toHaveTextContent("50");
  });

  it("nome tira espaços duplos ao sair do campo", () => {
    render(<Masked mask="name" />);
    const input = screen.getByRole("textbox", { name: "campo" });
    fireEvent.change(input, { target: { value: "  Maria   Silva " } });
    fireEvent.blur(input);
    expect(input).toHaveValue("Maria Silva");
  });
});
