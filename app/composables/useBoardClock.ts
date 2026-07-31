/**
 * The board's shared clock.
 *
 * One ticking `now` for the whole board, rather than one per view. The shell and
 * the view under it both need the time — the header to say what day it is, the
 * Today view to decide whether the evening is late enough to be about tomorrow —
 * and two intervals a second apart would let them disagree about which minute it
 * is, which on a wall is visible.
 *
 * Thirty seconds: fine enough that the now-marker never looks wrong, coarse
 * enough to cost nothing on a display left on for weeks. Everything derived
 * recomputes on this tick, so the board changes state without anybody touching
 * it.
 */

const TICK_MS = 30_000

let timer: ReturnType<typeof setInterval> | undefined
let subscribers = 0

export function useBoardClock() {
  const now = useState('board.now', () => new Date())

  if (import.meta.client) {
    subscribers++
    // The first view to ask starts it; the last one to leave stops it, so a
    // board navigated away from does not keep waking the tab forever.
    if (!timer) {
      timer = setInterval(() => {
        now.value = new Date()
      }, TICK_MS)
    }
    onScopeDispose(() => {
      subscribers--
      if (subscribers <= 0 && timer) {
        clearInterval(timer)
        timer = undefined
      }
    })
  }

  return now
}
