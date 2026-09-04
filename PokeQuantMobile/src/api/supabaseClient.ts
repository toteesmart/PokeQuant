import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jglvrozjhfooohkbmmwe.supabase.co';
const SUPABASE_ANON_KEY =
  'sb_publishable_CnRF10ryjO53goSnOXrZ5w_kGMZSP_k';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
