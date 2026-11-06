/** HTML da nota com logo, usado quando a impressão é pelo navegador ou pelo app desktop. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import receiptFontRegularUrl from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url";
import receiptFontBoldUrl from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2?url";
import defaultReceiptLogo from "@/assets/branding/logo-mesari-preto.png?url";
import receiptStyles from "@/components/receipt-content.css?inline";
import { ReceiptContent } from "@/components/receipt-content";
import type { PrintReceipt, PrintRestaurant } from "./types";
import type { HtmlLayout } from "./documents";

/** Logo e fontes convertidos uma vez por sessão: cada impressão não baixa de novo. */
const assetCache = new Map<string, Promise<string>>();

function assetDataUri(src: string) {
  if (src.startsWith("data:")) return Promise.resolve(src);
  let cached = assetCache.get(src);
  if (!cached) {
    cached = fetchDataUri(src);
    cached.catch(() => assetCache.delete(src));
    assetCache.set(src, cached);
  }
  return cached;
}

async function fetchDataUri(src: string) {
  const response = await fetch(new URL(src, window.location.href));
  if (!response.ok) throw new Error(`Recurso da nota indisponível: ${src}`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

export async function receiptHtml(
  receipt: PrintReceipt,
  restaurant: PrintRestaurant,
  layout: HtmlLayout,
) {
  const width = layout.paperWidth;
  const [logo, regularFont, boldFont] = await Promise.all([
    // Logo do Storage indisponível: imprime com o logo padrão em vez de falhar a nota.
    assetDataUri(restaurant.logo || defaultReceiptLogo).catch(() =>
      assetDataUri(defaultReceiptLogo),
    ),
    assetDataUri(receiptFontRegularUrl),
    assetDataUri(receiptFontBoldUrl),
  ]);
  const body = renderToStaticMarkup(
    createElement(ReceiptContent, {
      receipt,
      restaurant: { ...restaurant, logo },
      via2: Boolean(receipt.reprint),
      width,
    }),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:400;src:url("${regularFont}") format("woff2")}@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:700;src:url("${boldFont}") format("woff2")}${receiptStyles}\n@page{size:${width}mm auto;margin:0}html,body{width:${width}mm;margin:0;padding:0;background:#fff;color:#000}.receipt-paper{width:${layout.printableMm}mm!important;max-width:100%!important;margin:0 auto!important;padding:2mm 1mm!important;transform:translateX(${layout.offsetMm}mm);border:0!important;border-radius:0!important;background:#fff!important;color:#000!important;box-shadow:none!important;filter:none!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}</body></html>`;
}
