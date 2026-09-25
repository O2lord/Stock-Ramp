// client/lib/supabase/client.ts

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client with the service role key for admin operations
// (payment credential storage routes). Never import this from client
// components — it must only run in API routes / server code.
//
// Built lazily via Proxy instead of at module load: importing this file
// from a client component (transitively, e.g. via PaymentLinkDisplay) no
// longer crashes the page, because the real client is only constructed
// the first time a property on it is actually accessed — which only
// happens in server code paths. No call sites need to change.
let _realAdmin: SupabaseClient | null = null;

function getRealAdmin(): SupabaseClient {
  if (!_realAdmin) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
    }
    _realAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _realAdmin;
}

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getRealAdmin(), prop, receiver);
  },
});