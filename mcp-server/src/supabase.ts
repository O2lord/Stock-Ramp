import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "SUPABASE_URL / SUPABASE_ANON_KEY not set. Use the ANON key with an RLS " +
      "policy scoped to SELECT on receipts — NOT the service role key. This " +
      "server is public-facing with no auth in front of it; the service role " +
      "key would let a compromise of this deployment read/write your entire " +
      "Supabase project, not just receipts. Use a NEW Supabase project for " +
      "StockRamp, separate from Trust Vault's — see the architecture note on " +
      "keeping the two products' data isolated even though the code is forked."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
