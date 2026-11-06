/**
 * Logo para impressão térmica. No upload a imagem é processada uma vez (cinza, contraste,
 * no máximo 384 x 200 pontos, 1 bit com Floyd–Steinberg) e o PNG preto e branco vai para o
 * Storage. Na impressão, o bitmap já empacotado fica em cache neste aparelho.
 */

export const LOGO_MAX_WIDTH = 384;
export const LOGO_MAX_HEIGHT = 200;
export const LOGO_DETAIL_WARNING = "Logos simples, em preto e branco, saem melhor.";

/** Bitmap de 1 bit pronto para o GS v 0 (linhas empacotadas, bit 7 = ponto mais à esquerda). */
export type PrintLogo = {
  width: number;
  height: number;
  /** ceil(width / 8) bytes por linha, 1 = ponto preto. */
  bits: Uint8Array;
  /** Imagem para o HTML (data URI ou URL). */
  src: string;
};

/** Tamanho final mantendo a proporção, sem ampliar. */
export function logoSize(width: number, height: number) {
  const scale = Math.min(1, LOGO_MAX_WIDTH / width, LOGO_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * RGBA -> 1 bit. Transparente vira branco; os níveis são esticados (2% a 98%) e o contraste
 * aumentado antes do Floyd–Steinberg. `detailed` indica degradê ou muitos tons intermediários.
 */
export function ditherLogo(rgba: ArrayLike<number>, width: number, height: number) {
  const count = width * height;
  const gray = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const alpha = rgba[i * 4 + 3]! / 255;
    const luma = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
    gray[i] = luma * alpha + 255 * (1 - alpha);
  }
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const low = sorted[Math.floor(count * 0.02)] ?? 0;
  const high = sorted[Math.min(count - 1, Math.floor(count * 0.98))] ?? 255;
  const stretch = high - low >= 32;
  let midTones = 0;
  for (let i = 0; i < count; i += 1) {
    let value = stretch ? ((gray[i]! - low) / (high - low)) * 255 : gray[i]!;
    value = (value - 128) * 1.3 + 128;
    value = Math.max(0, Math.min(255, value));
    if (value > 48 && value < 208) midTones += 1;
    gray[i] = value;
  }
  const dots = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const old = gray[i]!;
      const next = old < 128 ? 0 : 255;
      dots[i] = next === 0 ? 1 : 0;
      const error = old - next;
      if (x + 1 < width) gray[i + 1]! += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1]! += (error * 3) / 16;
        gray[i + width]! += (error * 5) / 16;
        if (x + 1 < width) gray[i + width + 1]! += error / 16;
      }
    }
  }
  return { dots, detailed: midTones / Math.max(1, count) > 0.15 };
}

/** Um byte por ponto (1 = preto) -> linhas empacotadas para o GS v 0. */
export function packDots(dots: ArrayLike<number>, width: number, height: number) {
  const rowBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (dots[y * width + x]) bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return bits;
}

/** Ponto (x, y) do bitmap empacotado. */
export function logoDot(logo: Pick<PrintLogo, "width" | "bits">, x: number, y: number) {
  const rowBytes = Math.ceil(logo.width / 8);
  return (logo.bits[y * rowBytes + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
}

// ---------------------------------------------------------------------------------------------
// Navegador (canvas)

async function loadImage(source: Blob | string) {
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(url);
  }
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Não foi possível processar a imagem da logo.");
  return { canvas, context };
}

export type ProcessedLogo = {
  png: Blob;
  dataUrl: string;
  width: number;
  height: number;
  /** true: degradê/muitos detalhes, mostrar LOGO_DETAIL_WARNING. */
  detailed: boolean;
};

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler a imagem."));
    reader.readAsDataURL(blob);
  });
}

/** Processa a imagem enviada (PNG/JPG) e devolve o PNG preto e branco pronto para guardar. */
export async function processLogoFile(file: Blob): Promise<ProcessedLogo> {
  const image = await loadImage(file);
  const { width, height } = logoSize(image.naturalWidth, image.naturalHeight);
  const { canvas, context } = canvas2d(width, height);
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const { dots, detailed } = ditherLogo(pixels.data, width, height);
  for (let i = 0; i < dots.length; i += 1) {
    const value = dots[i] ? 0 : 255;
    pixels.data[i * 4] = value;
    pixels.data[i * 4 + 1] = value;
    pixels.data[i * 4 + 2] = value;
    pixels.data[i * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Não foi possível processar a imagem da logo.");
  return { png, dataUrl: await blobToDataUrl(png), width, height, detailed };
}

// ---------------------------------------------------------------------------------------------
// Cache no aparelho

const CACHE_KEY = "mesari-logo-impressao";
const memory = new Map<string, Promise<PrintLogo>>();

type Cached = { url: string; width: number; height: number; bits: string; src: string };

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function readCache(url: string): PrintLogo | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    const cached = raw ? (JSON.parse(raw) as Cached) : null;
    if (!cached || cached.url !== url) return null;
    return {
      width: cached.width,
      height: cached.height,
      bits: fromBase64(cached.bits),
      src: cached.src,
    };
  } catch {
    return null;
  }
}

function writeCache(url: string, logo: PrintLogo) {
  try {
    const value: Cached = { url, ...logo, bits: toBase64(logo.bits) };
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Sem espaço/sem armazenamento: o bitmap fica só na memória desta sessão.
  }
}

async function fetchLogo(url: string): Promise<PrintLogo> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Logo de impressão indisponível (${response.status}).`);
  const blob = await response.blob();
  const src = await blobToDataUrl(blob);
  const image = await loadImage(src);
  const width = Math.min(image.naturalWidth, LOGO_MAX_WIDTH);
  const height = Math.min(
    image.naturalHeight,
    Math.round((image.naturalHeight * width) / image.naturalWidth),
  );
  const { context } = canvas2d(width, height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const dots = new Uint8Array(width * height);
  // O PNG guardado já é 1 bit: aqui é só limiar.
  for (let i = 0; i < dots.length; i += 1) {
    dots[i] = data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]! < 384 ? 1 : 0;
  }
  const logo = { width, height, bits: packDots(dots, width, height), src };
  writeCache(url, logo);
  return logo;
}

/** Bitmap da logo (cache do aparelho; baixa e converte só quando a URL muda). */
export function loadPrintLogo(url: string): Promise<PrintLogo> {
  const cached = readCache(url);
  if (cached) return Promise.resolve(cached);
  let pending = memory.get(url);
  if (!pending) {
    pending = fetchLogo(url);
    pending.catch(() => memory.delete(url));
    memory.set(url, pending);
  }
  return pending;
}
