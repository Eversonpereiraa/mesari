import { describe, expect, it } from "vitest";
import {
  caretByDigits,
  centsFromTyping,
  cleanCpfCnpj,
  cleanInstagram,
  cleanPhone,
  cleanText,
  cleanUsername,
  cpfCnpjError,
  displayCpfCnpj,
  displayPhone,
  formatCents,
  formatCpfCnpj,
  formatPhone,
  instagramError,
  integerError,
  integerFromTyping,
  isValidCnpj,
  isValidCpf,
  loginUsername,
  moneyError,
  parseMoneyToCents,
  parsePercent,
  percentError,
  percentFromTyping,
  phoneError,
  typingText,
  usernameError,
} from "@/lib/masks";

describe("dinheiro", () => {
  it("digitar entra pelos centavos: 1250 vira 12,50", () => {
    const typed = ["1", "12", "125", "1250"].map((raw) => formatCents(centsFromTyping(raw) ?? 0));
    expect(typed).toEqual(["0,01", "0,12", "1,25", "12,50"]);
    expect(formatCents(centsFromTyping("12,505") ?? 0)).toBe("125,05");
    expect(formatCents(9_999_999)).toBe("99.999,99");
  });

  it("colar 'R$ 1.234,56', '12.5' e outros formatos comuns", () => {
    expect(parseMoneyToCents("R$ 1.234,56")).toBe(123456);
    expect(parseMoneyToCents("12.5")).toBe(1250);
    expect(parseMoneyToCents("12,5")).toBe(1250);
    expect(parseMoneyToCents("1.234")).toBe(123400);
    expect(parseMoneyToCents("50")).toBe(5000);
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-5,00")).toBeNull();
    expect(parseMoneyToCents(18.9)).toBe(1890);
  });

  it("apagar: tira o dígito e o valor volta a se ajustar; tudo apagado = vazio", () => {
    // "12,50" com o "2" apagado → "1,50"
    expect(formatCents(centsFromTyping("1,50") ?? 0)).toBe("1,50");
    expect(centsFromTyping("0,0")).toBe(0);
    expect(centsFromTyping("")).toBeNull();
  });

  it("cursor fica no lugar ao apagar no meio (âncora à direita)", () => {
    // "1.234,56": apagou o "3" com o cursor depois dele → "1.24,56", cursor antes do "4".
    const raw = "1.24,56";
    const formatted = formatCents(centsFromTyping(raw) ?? 0);
    expect(formatted).toBe("124,56");
    expect(caretByDigits(raw, 3, formatted, "right")).toBe(2);
  });

  it("limites: nunca negativo, máximo 99.999,99 e taxa de entrega até 500,00", () => {
    expect(moneyError(9_999_999)).toBeNull();
    expect(moneyError(10_000_000)).toBe("O valor máximo é R$ 99.999,99.");
    expect(moneyError(50_001, { max: 50_000 })).toBe("O valor máximo é R$ 500,00.");
    expect(moneyError(null, { required: true })).toBe("Informe o valor.");
    expect(moneyError(null)).toBeNull();
  });
});

describe("telefone", () => {
  it("fixo (10 dígitos) e celular (11 dígitos)", () => {
    expect(formatPhone("8133333333")).toBe("(81) 3333-3333");
    expect(formatPhone("81999999999")).toBe("(81) 9 9999-9999");
    expect(phoneError("8133333333")).toBeNull();
    expect(phoneError("81999999999")).toBeNull();
  });

  it("formata aos poucos enquanto digita", () => {
    expect(["8", "81", "813", "813333", "8133334"].map(formatPhone)).toEqual([
      "(8",
      "(81",
      "(81) 3",
      "(81) 3333",
      "(81) 3333-4",
    ]);
  });

  it("colar com +55 tira o código do país", () => {
    expect(cleanPhone("+55 (81) 9 9999-9999")).toBe("81999999999");
    expect(cleanPhone("+55 81 3333-3333")).toBe("8133333333");
    expect(cleanPhone("081 99999-9999")).toBe("81999999999");
  });

  it("sem DDD (ou celular sem o 9) é inválido; vazio é aceito no campo opcional", () => {
    expect(phoneError("99999999")).toBe("Informe o telefone com DDD, ex.: (81) 9 9999-9999.");
    expect(phoneError("81899999999")).toBe("Telefone inválido. Confira o DDD e o número.");
    expect(phoneError("")).toBeNull();
    expect(phoneError("", { required: true })).toBe("Informe o telefone.");
  });

  it("dado antigo formatado é normalizado e exibido formatado", () => {
    expect(cleanPhone("(81) 3333-3333")).toBe("8133333333");
    expect(displayPhone("81999999999")).toBe("(81) 9 9999-9999");
    expect(displayPhone("ramal 20")).toBe("ramal 20");
  });

  it("cursor não pula para o fim ao digitar no meio", () => {
    // "(81) 3333-3333" com "9" digitado depois de "(81) " → 11 dígitos (celular).
    const raw = "(81) 93333-3333";
    const formatted = formatPhone(cleanPhone(raw));
    expect(formatted).toBe("(81) 9 3333-3333");
    expect(formatted.slice(0, caretByDigits(raw, 6, formatted))).toBe("(81) 9");
  });
});

describe("CPF e CNPJ", () => {
  it("detecta pelo tamanho e formata", () => {
    expect(formatCpfCnpj("52998224725")).toBe("529.982.247-25");
    expect(formatCpfCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatCpfCnpj("5299")).toBe("529.9");
    expect(cleanCpfCnpj("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("valida dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-26")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });

  it("mensagens: opcional, CPF/CNPJ inválido e incompleto", () => {
    expect(cpfCnpjError("")).toBeNull();
    expect(cpfCnpjError("52998224725")).toBeNull();
    expect(cpfCnpjError("52998224726")).toBe("CPF inválido. Confira os números.");
    expect(cpfCnpjError("11222333000182")).toBe("CNPJ inválido. Confira os números.");
    expect(cpfCnpjError("1122233")).toMatch(/completo/);
    expect(displayCpfCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("Instagram", () => {
  it("link colado vira @usuario", () => {
    expect(cleanInstagram("https://www.instagram.com/Bar.Do_Ze/?hl=pt-br")).toBe("@bar.do_ze");
    expect(cleanInstagram("instagram.com/restaurante")).toBe("@restaurante");
  });

  it("sempre com @, minúsculo, só letras, números, ponto e _ (até 30)", () => {
    expect(cleanInstagram("Restaurante Açaí!")).toBe("@restauranteacai");
    expect(cleanInstagram("@@meu-bar")).toBe("@meubar");
    expect(cleanInstagram("a".repeat(40))).toBe(`@${"a".repeat(30)}`);
    expect(cleanInstagram("")).toBe("");
    expect(instagramError("@bar..ze")).toMatch(/ponto/);
    expect(instagramError("@bar.ze")).toBeNull();
  });
});

describe("usuário", () => {
  it("cadastro: tira acento, espaço e maiúscula", () => {
    expect(cleanUsername("João Silva")).toBe("joaosilva");
    expect(cleanUsername("MARIA.Ção_1-2")).toBe("maria.cao_1-2");
    expect(cleanUsername("x".repeat(40))).toHaveLength(30);
  });

  it("regra do banco: 3 a 30, só a-z 0-9 . _ -", () => {
    expect(usernameError("jo")).toBe("O usuário deve ter de 3 a 30 caracteres.");
    expect(usernameError("joao")).toBeNull();
    expect(usernameError("")).toBe("Informe o usuário.");
    expect(usernameError("joão")).toBe("Use só letras minúsculas, números, ponto, _ ou -.");
  });

  it("login: só minúsculo + trim, sem barrar usuários antigos", () => {
    expect(loginUsername("  Caixa ")).toBe("caixa");
    expect(loginUsername("José")).toBe("josé");
  });
});

describe("inteiros", () => {
  it("só dígitos, cortando no tamanho do máximo", () => {
    expect(integerFromTyping("12a", 999)).toBe(12);
    expect(integerFromTyping("1234", 999)).toBe(123);
    expect(integerFromTyping("007", 99)).toBe(7);
    expect(integerFromTyping("", 99)).toBeNull();
  });

  it("limites: mesa 1–999, lugares 1–50, quantidade 1–99, colunas 16–64", () => {
    expect(integerError(0, { min: 1, max: 999 })).toBe("Informe um número de 1 a 999.");
    expect(integerError(999, { min: 1, max: 999 })).toBeNull();
    expect(integerError(51, { min: 1, max: 50 })).toBe("Informe um número de 1 a 50.");
    expect(integerError(99, { min: 1, max: 99 })).toBeNull();
    expect(integerError(100, { min: 1, max: 99 })).toBe("Informe um número de 1 a 99.");
    expect(integerError(15, { min: 16, max: 64 })).toBe("Informe um número de 16 a 64.");
    expect(integerError(null, { min: 16, max: 64 })).toBe("Informe um número de 16 a 64.");
  });
});

describe("percentual", () => {
  it("aceita vírgula e ponto, uma casa decimal, de 0 a 30", () => {
    expect(percentFromTyping("10.55")).toBe("10,5");
    expect(percentFromTyping("10,")).toBe("10,");
    expect(parsePercent("12,5")).toBe(12.5);
    expect(percentError(30)).toBeNull();
    expect(percentError(30.5)).toBe("Informe um percentual de 0 a 30%.");
  });
});

describe("texto livre", () => {
  it("junta espaços duplos, sem espaço no começo, corta no limite e apara ao salvar", () => {
    expect(typingText("  Ana   Maria ", 60)).toBe("Ana Maria ");
    expect(typingText("x".repeat(80), 60)).toHaveLength(60);
    expect(cleanText("  Ana   Maria  ", 60)).toBe("Ana Maria");
  });
});
