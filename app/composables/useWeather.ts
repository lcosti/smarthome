import type { BoardWeather } from '../utils/board'

/**
 * The temperature in the corner of the wall board.
 *
 * Open-Meteo, which needs no key and no account — worth more here than any
 * richer API, because the alternative is a secret on a kitchen tablet.
 *
 * The last good reading is kept in localStorage and returned immediately on the
 * next load. That is not a cache for speed: the board must show something true-
 * ish with the wifi down, and a weather card that empties when the network drops
 * would be the one part of the design that still has a failure state.
 */

const KEY = 'shoplist.weather'

interface CachedWeather extends BoardWeather {
  at: string
}

/**
 * WMO weather codes, grouped to the distinctions that matter on a wall: is it
 * clear, cloudy, wet, or frozen. Anything finer is unreadable across a room.
 */
function iconFor(code: number, isDay: boolean): string {
  if (code === 0 || code === 1) return isDay ? 'i-lucide-sun' : 'i-lucide-moon'
  if (code === 2) return isDay ? 'i-lucide-cloud-sun' : 'i-lucide-cloud-moon'
  if (code === 3) return 'i-lucide-cloud'
  if (code === 45 || code === 48) return 'i-lucide-cloud-fog'
  if (code >= 71 && code <= 77) return 'i-lucide-snowflake'
  if (code >= 85 && code <= 86) return 'i-lucide-snowflake'
  if (code >= 95) return 'i-lucide-cloud-lightning'
  if (code >= 51) return 'i-lucide-cloud-rain'
  return 'i-lucide-cloud'
}

function readCache(): CachedWeather | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedWeather>
    if (typeof parsed.temperature !== 'number' || !parsed.icon) return null
    return { icon: parsed.icon, temperature: parsed.temperature, at: parsed.at ?? '' }
  } catch {
    return null
  }
}

const REFRESH_MS = 600_000

let timer: ReturnType<typeof setInterval> | undefined
let subscribers = 0

export function useWeather() {
  const config = useRuntimeConfig()
  const cached = readCache()
  const weather = useState<BoardWeather | null>('app.weather', () =>
    cached ? { icon: cached.icon, temperature: cached.temperature } : null
  )

  async function refresh() {
    const latitude = config.public.homeLatitude
    const longitude = config.public.homeLongitude
    if (latitude === undefined || longitude === undefined) return

    try {
      const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${latitude}&longitude=${longitude}`
        + '&current=temperature_2m,weather_code,is_day'
      const data = await $fetch<{
        current?: { temperature_2m?: number, weather_code?: number, is_day?: number }
      }>(url)

      const current = data.current
      if (!current || typeof current.temperature_2m !== 'number') return

      const next: BoardWeather = {
        icon: iconFor(current.weather_code ?? 3, current.is_day !== 0),
        temperature: Math.round(current.temperature_2m)
      }
      weather.value = next
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KEY, JSON.stringify({ ...next, at: new Date().toISOString() }))
      }
    } catch {
      // Keep whatever was last known, silently. There is no error state on this
      // board, and yesterday's temperature is closer to the truth than a blank.
    }
  }

  // The refresh loop belongs here rather than in whoever renders a temperature:
  // the header and the Today page both want it, and two callers each running
  // their own interval would hit Open-Meteo twice as often for one reading.
  // First to ask starts it, last to leave stops it.
  if (import.meta.client) {
    subscribers++
    if (!timer) {
      void refresh()
      timer = setInterval(() => void refresh(), REFRESH_MS)
    }
    onScopeDispose(() => {
      subscribers--
      if (subscribers <= 0 && timer) {
        clearInterval(timer)
        timer = undefined
      }
    })
  }

  return { weather, refresh }
}
