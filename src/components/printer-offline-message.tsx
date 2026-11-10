import { Link } from "@tanstack/react-router";

/** Pedido salvo, mas nenhuma impressora pronta: o caixa vai resolver; o garçom avisa o caixa. */
export function PrinterOfflineMessage({ cashier }: { cashier: boolean }) {
  if (!cashier) return <>Impressora desconectada. O pedido foi enviado, avise o caixa.</>;
  return (
    <>
      Pedido enviado, mas a impressora não respondeu.{" "}
      <Link to="/impressao" className="underline">
        Veja em Impressão.
      </Link>
    </>
  );
}
