import type { WritableComputedRef } from 'vue'

/**
 * "This device is a display that never sleeps."
 *
 * An always-on tablet showing the same layout for weeks will ghost it into the
 * panel, so when this is on the whole app drifts a pixel at a time around a
 * small loop — slowly enough that nobody ever sees it move.
 *
 * A per-device trait, not household data: the kitchen tablet is always on and
 * a phone is not, so it lives in localStorage next to the cached weather
 * rather than in the database.
 */

const KEY = 'shoplist.alwaysOn'

export function useAlwaysOn(): WritableComputedRef<boolean> {
  const state = useState('app.alwaysOn', () =>
    import.meta.client && localStorage.getItem(KEY) === 'true'
  )

  return computed({
    get: () => state.value,
    set: (value) => {
      state.value = value
      if (import.meta.client) localStorage.setItem(KEY, String(value))
    }
  })
}
