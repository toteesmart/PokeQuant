import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jglvrozjhfooohkbmmwe.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpnbHZyb3pqaGZvb29oa2JtbXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzOTU0NzcsImV4cCI6MjEwMzk3MTQ3N30.PNj0d9KAVFjVNtX0oeW56NoiwyxPtRs2LWB5vvr47yQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
