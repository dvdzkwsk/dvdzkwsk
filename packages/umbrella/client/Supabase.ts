import {SupabaseClient, createClient} from "@supabase/supabase-js"

export let supabase: SupabaseClient

export function configureSupabase() {
	if (!process.env.SUPABASE_PROJECT_URL) {
		throw new Error(`Missing process.env.SUPABASE_PROJECT_URL`)
	}
	if (!process.env.SUPABASE_PUBLIC_API_KEY) {
		throw new Error(`Missing process.env.SUPABASE_PUBLIC_API_KEY`)
	}
	supabase = createClient(
		process.env.SUPABASE_PROJECT_URL!,
		process.env.SUPABASE_PUBLIC_API_KEY!,
	)
}
