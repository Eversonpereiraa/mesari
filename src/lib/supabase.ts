import { createClient } from "@supabase/supabase-js";

// Valores públicos do projeto (mesmos do .env.example), usados quando o host
// de deploy (ex.: Vercel) não define as variáveis VITE_SUPABASE_*.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://skjsvyvstzabwwxjgywi.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNranN2eXZzdHphYnd3eGpneXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjU5NzksImV4cCI6MjEwNzA0MTk3OX0.4_xPQ_QbA4cL-c0JsW8v9rOg3tnDxPYRWDq_YjSH3Ts";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * E-mail usado no login. Dono entra com o e-mail de verdade; funcionário entra com o usuário,
 * que vira "usuario@r<código do restaurante>.mesari.local" (cada restaurante tem o seu "joao").
 */
export function usernameEmail(username: string, restaurantCode = "") {
  const value = username.trim().toLowerCase();
  if (value.includes("@")) return value;
  return `${value}@r${restaurantCode.trim()}.mesari.local`;
}
