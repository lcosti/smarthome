// Touches the database so the Supabase free tier does not pause the project after
// seven idle days. Invoked by .github/workflows/keepalive.yml every two days.
//
// The ping is deliberately external rather than an internal pg_cron job: a cron
// job living inside the database it is meant to keep awake stops running the
// moment that database pauses.

import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async () => {
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await client.from('households').select('id').limit(1)

  if (error) {
    console.error('keepalive failed', error.message)
    return new Response(`keepalive failed: ${error.message}`, { status: 500 })
  }

  return new Response('ok', { headers: { 'Content-Type': 'text/plain' } })
})
