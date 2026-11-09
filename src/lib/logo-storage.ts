import { supabase } from "@/lib/supabase";
import { requireRestaurantId } from "@/lib/tenant";

const BUCKET = "marca";
const MAX_SIDE = 400;
const QUALITY = 0.8;
/** Nome único a cada troca: a URL nunca muda de conteúdo, então o navegador pode guardar por 1 ano. */
const CACHE_SECONDS = String(365 * 24 * 60 * 60);

async function loadImage(source: Blob) {
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Reduz para no máximo 400 px no maior lado e converte para WebP (PNG se o navegador não gerar WebP). */
export async function compressLogo(source: Blob): Promise<Blob> {
  const image = await loadImage(source);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível processar a imagem do logo.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const webp = await canvasBlob(canvas, "image/webp", QUALITY);
  if (webp?.type === "image/webp") return webp;
  const png = await canvasBlob(canvas, "image/png");
  if (!png) throw new Error("Não foi possível processar a imagem do logo.");
  return png;
}

export const isDataUrl = (value: string) => value.startsWith("data:");

export async function dataUrlToBlob(value: string) {
  return (await fetch(value)).blob();
}

/** Caminho do arquivo dentro do bucket, ou null se a URL não for do bucket do logo. */
export function logoPath(url: string) {
  const match = /\/storage\/v1\/object\/public\/marca\/([^?#]+)/.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Comprime e envia o logo; devolve a URL pública. */
export async function uploadLogo(source: Blob) {
  const blob = await compressLogo(source);
  const extension = blob.type === "image/webp" ? "webp" : "png";
  const path = `${requireRestaurantId()}/logo-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    cacheControl: CACHE_SECONDS,
    contentType: blob.type,
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Envia a logo de impressão (PNG preto e branco já processado) sem recomprimir: cada ponto
 * importa para a impressora térmica. Devolve a URL pública.
 */
export async function uploadPrintLogo(png: Blob) {
  const path = `${requireRestaurantId()}/logo-impressao-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, png, {
    cacheControl: CACHE_SECONDS,
    contentType: "image/png",
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Apaga do bucket o arquivo de um logo antigo. URLs de fora do bucket (ou base64) são ignoradas. */
export async function removeLogo(url: string) {
  const path = logoPath(url);
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
