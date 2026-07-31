// Who is allowed to spend Anthropic credit.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { json } from './http.ts'

/**
 * Null if the caller is a member of some household, or the response to return.
 *
 * verify_jwt only proves the token was signed for this project, and signup is
 * open — so it admits any stranger who has requested themselves a magic link.
 * Spending Anthropic credit additionally requires being somebody's household:
 * querying `people` as the caller, under RLS, returns rows only for a member.
 */
export async function rejectNonMember(req: Request): Promise<Response | null> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false }
    }
  )

  const { data: caller, error: callerError } = await supabase.auth.getUser()
  if (callerError || !caller.user) return json(401, { error: 'Sign in first' })

  const { data: membership, error: membershipError } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', caller.user.id)
    .limit(1)
  if (membershipError) return json(500, { error: 'Could not check household membership' })
  if (!membership.length) return json(403, { error: 'Only household members can import recipes' })

  return null
}
