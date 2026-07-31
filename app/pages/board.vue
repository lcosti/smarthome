<script setup lang="ts">
import { useSyncStore } from '../stores/sync'
import { buildHeader } from '../utils/board'

/**
 * The household wall board: the shell every view sits in.
 *
 * A display, not a page. One fixed 1920×1200 frame, no browser chrome, no
 * scrolling, no spinners and no error screens. Everything it shows comes out of
 * local state already hydrated from IndexedDB, so it paints instantly on a cold
 * boot with no network and simply says so in the header.
 *
 * This component owns only what outlives a view: the frame, the clock, the
 * header and the four links in it. What is under the header is a child route,
 * so switching views never re-derives or re-paints the strip along the top —
 * on a wall, a header that flickered on every press would be the most obvious
 * thing in the room.
 */

const sync = useSyncStore()

const now = useBoardClock()
const nights = useBoardNights(now)
const { weather, refresh: refreshWeather } = useWeather()

// The board reads better dark on a wall in a kitchen at any hour, and it is the
// only surface in the app with an opinion about that.
const colorMode = useColorMode()
const previousColorMode = colorMode.preference
onMounted(() => {
  colorMode.preference = 'dark'
})
onUnmounted(() => {
  colorMode.preference = previousColorMode
})

const header = computed(() =>
  buildHeader({
    now: now.value,
    nights: nights.value,
    offline: sync.offline,
    lastSyncedAt: sync.lastSyncedAt,
    weather: weather.value
  })
)

let weatherTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void refreshWeather()
  weatherTimer = setInterval(() => void refreshWeather(), 600_000)
})

onUnmounted(() => {
  if (weatherTimer) clearInterval(weatherTimer)
})

// --- the frame -------------------------------------------------------------

const FRAME_WIDTH = 1920
const FRAME_HEIGHT = 1200

const scale = ref(1)
const frameWidth = ref(FRAME_WIDTH)
const frameHeight = ref(FRAME_HEIGHT)

/**
 * Fill the screen, whatever shape the screen is.
 *
 * The design is drawn at 1920×1200 and every size in it is a literal pixel
 * value, so the frame is scaled rather than made responsive — 82px means 82px,
 * and a breakpoint system would be six ways to get the type wrong.
 *
 * But scaling a fixed rectangle to fit a differently-shaped window leaves bars
 * down the sides, and a wall display with black borders looks broken rather than
 * deliberate. So the scale comes from the tighter axis, and then the frame is
 * given the leftover room on the other one: after scaling it is exactly the size
 * of the window.
 *
 * Nothing is cropped and nothing is stretched. The surplus lands on the parts of
 * the layout that were already flexible, and every fixed value is untouched.
 */
function fit() {
  const next = Math.min(window.innerWidth / FRAME_WIDTH, window.innerHeight / FRAME_HEIGHT)
  scale.value = next
  frameWidth.value = window.innerWidth / next
  frameHeight.value = window.innerHeight / next
}

/**
 * True fullscreen, for a browser that still has an address bar.
 *
 * The kiosk itself should be launched with Chrome's --kiosk flag and never need
 * this; it is here so the board can be looked at properly on a laptop. F is the
 * only key this page listens for.
 */
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    // Refused, usually because the gesture was not trusted. Nothing to say.
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'f' || event.key === 'F') void toggleFullscreen()
}

/**
 * Burn-in mitigation.
 *
 * An always-on display showing the same layout for weeks will ghost it into the
 * panel. The whole frame drifts a pixel at a time around a small loop, slowly
 * enough that nobody in the room will ever see it move, and far enough that no
 * edge sits still long enough to burn.
 */
const DRIFT = [
  [0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]
] as const
const driftIndex = ref(0)
let driftTimer: ReturnType<typeof setInterval> | undefined

/**
 * Fitting and drifting are deliberately two elements, not one transform.
 *
 * They want opposite timings: the fit must be instant, because a board that
 * animated its own scale would zoom into place every time it loaded or the
 * window changed, while the drift must take seconds precisely so that nobody
 * sees it.
 */
const frameStyle = computed(() => ({
  width: `${frameWidth.value}px`,
  height: `${frameHeight.value}px`,
  transform: `scale(${scale.value})`
}))

const driftStyle = computed(() => {
  const [x, y] = DRIFT[driftIndex.value % DRIFT.length]!
  return { transform: `translate(${x}px, ${y}px)` }
})

onMounted(() => {
  fit()
  window.addEventListener('resize', fit)
  // Entering or leaving fullscreen resizes the window without a resize event in
  // some browsers, so the frame is refitted on the transition too.
  document.addEventListener('fullscreenchange', fit)
  window.addEventListener('keydown', onKey)
  driftTimer = setInterval(() => {
    driftIndex.value++
  }, 240_000)
})

onUnmounted(() => {
  window.removeEventListener('resize', fit)
  document.removeEventListener('fullscreenchange', fit)
  window.removeEventListener('keydown', onKey)
  if (driftTimer) clearInterval(driftTimer)
})
</script>

<template>
  <div class="flex h-dvh w-dvw items-center justify-center overflow-hidden bg-default">
    <!--
      shrink-0 is load-bearing: this is a flex item wider than its container
      before the transform is applied, and without it flexbox shrinks the element
      to fit first, so the scale lands on an already-squashed box and the bars
      come back.
    -->
    <div
      class="origin-center shrink-0"
      :style="frameStyle"
    >
      <!--
        The header row is 104px rather than the 132px it was drawn at. Its
        content is bottom-aligned and 82px tall, so the difference sat above the
        day name as dead space — and height is the scarce axis on this board.
      -->
      <div
        data-board-frame
        class="grid h-full w-full grid-rows-[104px_minmax(0,1fr)] gap-x-[22px] gap-y-[18px]
               overflow-hidden px-10 py-9 text-default transition-transform duration-[3000ms] ease-linear"
        :style="driftStyle"
      >
        <BoardHeader :header="header">
          <template #nav>
            <BoardNav />
          </template>
        </BoardHeader>

        <div class="min-h-0">
          <NuxtPage />
        </div>
      </div>
    </div>
  </div>
</template>
