// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    ignores: [
      // Regenerated from the database by `pnpm db:types`.
      'shared/types/database.types.ts',
      // Supabase CLI scratch space.
      'supabase/.temp/**',
      // Deno, not Node — linted by `deno lint` if at all.
      'supabase/functions/**'
    ]
  }
)
