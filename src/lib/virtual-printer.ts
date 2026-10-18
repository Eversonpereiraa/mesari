import { useSyncExternalStore } from "react";

/** Um "papel" que sairia da impressora no modo simulação. */
export type VirtualPrintJob = {
  id: string;
  tipo: "comanda" | "recibo" | "conferencia" | "teste";
  criadoEm: number;
  html: string;
  escpos?: Uint8Array;
  larguraMm: 58 | 80;
  colunas: number;
  setor?: "cozinha" | "bar";
  mesa?: number | null;
  titulo: string;
  reimpressao?: boolean;
};

type StoredJob = Omit<VirtualPrintJob, "escpos"> & { escpos?: string };

export const VIRTUAL_PRINTER_KEY = "mesari-impressora-virtual";
const MAX_JOBS = 50;

let cache: VirtualPrintJob[] | null = null;
const listeners = new Set<() => void>();

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function readStorage(): VirtualPrintJob[] {
  try {
    const raw = localStorage.getItem(VIRTUAL_PRINTER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as StoredJob[]).map(({ escpos, ...job }) =>
      escpos ? { ...job, escpos: fromBase64(escpos) } : job,
    );
  } catch {
    return [];
  }
}

function writeStorage(jobs: VirtualPrintJob[]) {
  try {
    const stored: StoredJob[] = jobs.map(({ escpos, ...job }) =>
      escpos ? { ...job, escpos: toBase64(escpos) } : job,
    );
    localStorage.setItem(VIRTUAL_PRINTER_KEY, JSON.stringify(stored));
  } catch {
    // Sem localStorage (aba anônima, cota cheia): a fila continua só em memória.
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getVirtualJobs(): VirtualPrintJob[] {
  cache ??= readStorage();
  return cache;
}

/** Guarda um trabalho no topo da fila (mais recente primeiro). */
export function addVirtualJob(
  job: Omit<VirtualPrintJob, "id" | "criadoEm"> & { criadoEm?: number },
) {
  const full: VirtualPrintJob = {
    ...job,
    id: crypto.randomUUID(),
    criadoEm: job.criadoEm ?? Date.now(),
  };
  cache = [full, ...getVirtualJobs()].slice(0, MAX_JOBS);
  writeStorage(cache);
  notify();
  return full;
}

export function reprintVirtualJob(id: string) {
  const job = getVirtualJobs().find((entry) => entry.id === id);
  if (!job) throw new Error("Esse trabalho não está mais na fila.");
  const { id: _id, criadoEm: _criadoEm, ...rest } = job;
  return addVirtualJob({ ...rest, reimpressao: true });
}

export function clearVirtualJobs() {
  cache = [];
  writeStorage(cache);
  notify();
}

export function subscribeVirtualJobs(listener: () => void) {
  listeners.add(listener);
  // Outra aba/janela (ex.: a janela lateral do modo demonstração) imprimiu algo.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== VIRTUAL_PRINTER_KEY) return;
    cache = readStorage();
    listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: VirtualPrintJob[] = [];

export function useVirtualJobs() {
  return useSyncExternalStore(subscribeVirtualJobs, getVirtualJobs, () => EMPTY);
}

/** Só para testes. */
export function resetVirtualPrinterForTests() {
  cache = null;
}
