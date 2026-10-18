import { createClient } from "@supabase/supabase-js";

const url = import.meta.env["VITE_SUPABASE_URL"];
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"];

export const supabaseConfigured = Boolean(url && anonKey);

// Sem .env, createClient lançaria "supabaseUrl is required" ao importar o módulo e
// derrubaria todas as páginas (até /favicon.ico) com erro 500. Usamos um endereço
// inválido de propósito: o app abre e o store mostra "Supabase não configurado".
export const supabase = createClient(
  supabaseConfigured ? url : "http://supabase-nao-configurado.invalid",
  supabaseConfigured ? anonKey : "nao-configurado",
);

export function usernameEmail(username: string) {
  return `${username.trim().toLowerCase()}@mesari.local`;
}
