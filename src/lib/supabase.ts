import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const fallbackSupabaseUrl = 'https://placeholder.supabase.co'
const fallbackSupabaseKey = 'placeholder-key'

export const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase = createClient(
  supabaseUrl || fallbackSupabaseUrl,
  supabasePublishableKey || fallbackSupabaseKey,
)
