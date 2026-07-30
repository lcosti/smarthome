import { todayIso } from '../utils/week'

const today = ref(todayIso())
let watching = false

/**
 * Today's date, as a ref that moves on when the day does.
 *
 * The kitchen tablet stays open for weeks, so a `todayIso()` captured at
 * component setup still says Tuesday on Wednesday morning — the plan highlights
 * the wrong night and a birthday crossing a life-stage boundary goes unnoticed.
 * One shared ref, nudged once a minute and whenever the tab comes back into
 * view, keeps every "today" in the app honest.
 */
export function useToday(): Readonly<Ref<string>> {
  if (!watching && typeof window !== 'undefined') {
    watching = true
    const refresh = () => {
      const now = todayIso()
      if (now !== today.value) today.value = now
    }
    setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
  }
  return readonly(today)
}
