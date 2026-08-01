import { importFailureMessage } from '../utils/recipe-import'

/** Long enough for a slow model on poor signal, short enough to feel like an answer. */
const TIMEOUT_MS = 60_000

/** True when the device knows it has no signal — the check every model call makes. */
export function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Calling an Edge Function the way every feature here needs to: with a timeout
 * that really cancels the request, and its JSON error body unwrapped into a
 * human message. One place, because the recipe importers and the nutrition
 * estimator all fail in exactly the same ways.
 */
export function useEdgeFunction() {
  const supabase = useSupabaseClient()

  async function invoke(name: string, body: Record<string, unknown>, fallbackMessage: string) {
    // An aborted request, not a raced promise: giving up must also cancel the
    // call, or the work keeps running for an answer nobody is waiting on.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let data, invokeError
    try {
      ({ data, error: invokeError } = await supabase.functions.invoke(name, {
        body,
        signal: controller.signal
      }))
    } finally {
      clearTimeout(timer)
    }
    if (controller.signal.aborted) throw new Error(fallbackMessage)

    if (invokeError) {
      // The message a person reads is deliberately short; the whole error is
      // what tells you which of the many ways this can fail actually happened.
      console.error('edge function invoke failed', name, invokeError)
      throw new Error(await importFailureMessage(invokeError, fallbackMessage))
    }

    return data
  }

  return { invoke }
}
