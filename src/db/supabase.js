/**
 * Supabase singleton client — shared across the entire app.
 * Import `supabase` (or `getSupabaseClient()`) from here instead of
 * calling createClient multiple times.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = 'https://lfluatmojhkzdywizmsm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmbHVhdG1vamhremR5d2l6bXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzM1NDksImV4cCI6MjA4NzAwOTU0OX0.ivjN5x7ZNU8RXsTBLuA_oxBKHCPcRxStagyRAwrgy9w';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getSupabaseClient() {
    return supabase;
}
