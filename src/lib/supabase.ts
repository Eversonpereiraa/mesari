import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env["VITE_SUPABASE_URL"],
  import.meta.env["VITE_SUPABASE_ANON_KEY"],
);
export const supabaseConfigured = Boolean(
  import.meta.env["VITE_SUPABASE_URL"] && import.meta.env["VITE_SUPABASE_ANON_KEY"],
);

export function usernameEmail(username: string) {
  return `${username.trim().toLowerCase()}@mesari.local`;
}
