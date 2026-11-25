import { describe, expect, it } from "vitest";
import {
  dadosDoPedido,
  decidir,
  faltando,
  normalizarRascunho,
  pareceConfirmacao,
  rascunhoVazio,
  resumo,
  totais,
  type ProdutoCardapio,
  type Rascunho,
} from "../../supabase/functions/_shared/pedido-whatsapp";

const cardapio: ProdutoCardapio[] = [
  { id: "p-cuscuz-frango", nome: "Cuscuz recheado de filé de frango", preco: 18.5 },
  { id: "p-cuscuz-carne", nome: "Cuscuz recheado de carne de sol", preco: 21 },
  { id: "p-coca", nome: "Coca-Cola lata", preco: 6 },
];

const completo: Rascunho = {
  ...rascunhoVazio(),
  tipo: "entrega",
  cliente_nome: "Maria",
  endereco: "Rua A, 10",
  pagamento: "pix",
  itens: [
    { produto_id: "p-cuscuz-frango", quantidade: 2, observacao: "sem cebola" },
    { produto_id: "p-coca", quantidade: 1, observacao: "" },
  ],
};

const base = { cardapio, taxaEntrega: 5, respostaIA: "ok", mensagemCliente: "" };

describe("normalizarRascunho", () => {
  it("descarta item que não está no cardápio e junta linhas repetidas", () => {
    const { rascunho, descartados } = normalizarRascunho(
      {
        tipo: "entrega",
        itens: [
          { produto_id: "p-coca", quantidade: 1 },
          { produto_id: "p-coca", quantidade: 2 },
          { produto_id: "pizza-inventada", quantidade: 1 },
          { produto_id: "p-cuscuz-carne", quantidade: 0 },
        ],
      },
      cardapio,
    );
    expect(descartados).toEqual(["pizza-inventada"]);
    expect(rascunho.itens).toEqual([{ produto_id: "p-coca", quantidade: 3, observacao: "" }]);
  });

  it("ignora troco quando o pagamento não é dinheiro e endereço na retirada", () => {
    const { rascunho } = normalizarRascunho(
      { tipo: "retirada", endereco: "Rua X", pagamento: "pix", troco_para: 50, itens: [] },
      cardapio,
    );
    expect(rascunho.troco_para).toBeNull();
    expect(rascunho.endereco).toBeNull();
  });

  it("aceita resposta quebrada da IA sem lançar erro", () => {
    expect(normalizarRascunho(null, cardapio).rascunho).toEqual(rascunhoVazio());
    expect(normalizarRascunho({ itens: "x" }, cardapio).rascunho.itens).toEqual([]);
  });
});

describe("valores", () => {
  it("calcula com os preços do cardápio e a taxa só na entrega", () => {
    expect(totais(completo, cardapio, 5)).toEqual({ subtotal: 43, taxa: 5, total: 48 });
    expect(totais({ ...completo, tipo: "retirada" }, cardapio, 5).total).toBe(43);
  });

  it("monta o resumo com valores do sistema", () => {
    const texto = resumo(completo, cardapio, 5);
    expect(texto).toContain("2x Cuscuz recheado de filé de frango (sem cebola) — R$ 37,00");
    expect(texto).toContain("*Total: R$ 48,00*");
    expect(texto).toContain("Responda *SIM*");
  });
});

describe("faltando", () => {
  it("lista o que falta e libera quando completo", () => {
    expect(faltando(rascunhoVazio())).toHaveLength(4);
    expect(faltando({ ...completo, endereco: null })).toEqual(["o endereço de entrega"]);
    expect(faltando(completo)).toEqual([]);
  });
});

describe("decidir", () => {
  it("mostra o resumo antes de lançar, mesmo se a IA já disser confirmar", () => {
    const d = decidir({
      ...base,
      acao: "confirmar",
      etapaAnterior: "coletando",
      anterior: completo,
      atual: completo,
    });
    expect(d).toMatchObject({ tipo: "responder", etapa: "confirmando" });
  });

  it("lança depois do resumo quando o cliente confirma", () => {
    const d = decidir({
      ...base,
      acao: "confirmar",
      etapaAnterior: "confirmando",
      anterior: completo,
      atual: completo,
    });
    expect(d).toEqual({ tipo: "lancar" });
  });

  it("um 'sim' claro confirma mesmo se a IA não marcar", () => {
    const d = decidir({
      ...base,
      acao: "continuar",
      mensagemCliente: "Sim!",
      etapaAnterior: "confirmando",
      anterior: completo,
      atual: completo,
    });
    expect(d).toEqual({ tipo: "lancar" });
  });

  it("IA confirmando com algo mudado mostra o resumo de novo em vez de lançar", () => {
    const d = decidir({
      ...base,
      acao: "confirmar",
      mensagemCliente: "pode ser, mas entrega na Rua B, 20",
      etapaAnterior: "confirmando",
      anterior: completo,
      atual: { ...completo, endereco: "Rua B, 20" },
    });
    expect(d).toMatchObject({ tipo: "responder", etapa: "confirmando" });
    expect(d.tipo === "responder" && d.texto).toContain("Rua B, 20");
  });

  it("pedido mudado depois do resumo pede confirmação de novo mesmo com 'continuar'", () => {
    const d = decidir({
      ...base,
      acao: "continuar",
      mensagemCliente: "coloca mais uma coca",
      etapaAnterior: "confirmando",
      anterior: completo,
      atual: {
        ...completo,
        itens: [
          ...completo.itens.slice(0, 1),
          { produto_id: "p-coca", quantidade: 2, observacao: "" },
        ],
      },
    });
    expect(d).toMatchObject({ tipo: "responder", etapa: "confirmando" });
  });

  it("não deixa confirmar pedido incompleto", () => {
    const d = decidir({
      ...base,
      acao: "pedir_confirmacao",
      etapaAnterior: "coletando",
      anterior: rascunhoVazio(),
      atual: { ...completo, pagamento: null },
    });
    expect(d).toEqual({
      tipo: "responder",
      texto: "Quase lá! Só preciso de: a forma de pagamento (Pix, dinheiro, crédito ou débito).",
      etapa: "coletando",
    });
  });

  it("passa para humano quando a IA pede", () => {
    expect(
      decidir({
        ...base,
        acao: "chamar_humano",
        respostaIA: "",
        etapaAnterior: "coletando",
        anterior: rascunhoVazio(),
        atual: rascunhoVazio(),
      }).tipo,
    ).toBe("humano");
  });

  it("reconhece confirmações comuns e não confunde com pedido", () => {
    for (const s of ["sim", "SIM", "pode mandar", "ok", "blz", "isso mesmo", "fechado 👍"]) {
      expect(pareceConfirmacao(s)).toBe(true);
    }
    for (const s of ["sim, mas troca a coca", "quero mais um", "não"]) {
      expect(pareceConfirmacao(s)).toBe(false);
    }
  });
});

describe("dadosDoPedido", () => {
  it("gera o formato da criar_pedido_externo", () => {
    const dados = dadosDoPedido(
      { ...completo, pagamento: "dinheiro", troco_para: 100 },
      "+55 (81) 99999-0000",
      cardapio,
      5,
    );
    expect(dados).toMatchObject({
      canal: "whatsapp",
      tipo: "entrega",
      telefone: "5581999990000",
      pagamento_previsto: { forma: "dinheiro", pago: false, troco_para: 100 },
    });
    expect(dados.itens).toHaveLength(2);
  });

  it("descarta troco menor que o total e telefone inválido", () => {
    const dados = dadosDoPedido(
      { ...completo, pagamento: "dinheiro", troco_para: 20 },
      "123",
      cardapio,
      5,
    );
    expect(dados.pagamento_previsto.troco_para).toBeNull();
    expect(dados.telefone).toBeNull();
  });
});
