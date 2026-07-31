<script setup lang="ts">
const route = useRoute()

useSync()

const isWide = useWide()
const alwaysOn = useAlwaysOn()

/**
 * Signing in and setting up a household are one-way flows; navigation there
 * would just be three ways to get lost. Cook mode is chromeless for a different
 * reason: standing at the hob you are doing one thing, and the header — clock,
 * weather, the four other places you could be — is four things you are not
 * doing. That view says so in its own page meta rather than the shell matching
 * on a path, because `/recipes` keeps its chrome and `/recipes/<id>/cook` does
 * not, and that is a distinction a regex gets wrong the first time either route
 * moves.
 */
const CHROMELESS = ['/login', '/welcome']
const showChrome = computed(() =>
  !CHROMELESS.includes(route.path) && route.meta.chromeless !== true
)

/**
 * True fullscreen, for a browser that still has an address bar.
 *
 * A tablet in the kitchen should be launched with Chrome's --kiosk flag and
 * never need this; it is here so the app can be put on a wall or looked at
 * properly on a laptop. F is the only key the app listens for, and it stays out
 * of the way while anything is being typed — unlike the old board, this app is
 * full of text inputs.
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
  if (event.key !== 'f' && event.key !== 'F') return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  const target = event.target as HTMLElement | null
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target?.isContentEditable
  ) return

  void toggleFullscreen()
}

/**
 * Burn-in mitigation, for a display left on.
 *
 * A tablet showing the same layout for weeks will ghost it into the panel. When
 * the always-on setting is on, everything drifts a pixel at a time around a
 * small loop, slowly enough that nobody in the room will ever see it move and
 * far enough that no edge sits still long enough to burn.
 */
const DRIFT = [
  [0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]
] as const
const driftIndex = ref(0)
let driftTimer: ReturnType<typeof setInterval> | undefined

const driftStyle = computed(() => {
  if (!alwaysOn.value) return undefined
  const [x, y] = DRIFT[driftIndex.value % DRIFT.length]!
  return { transform: `translate(${x}px, ${y}px)` }
})

onMounted(() => {
  window.addEventListener('keydown', onKey)
  driftTimer = setInterval(() => {
    driftIndex.value++
  }, 240_000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  if (driftTimer) clearInterval(driftTimer)
})
</script>

<template>
  <UApp>
    <!--
      The app shell is exactly one viewport tall and never scrolls. Each page puts
      its header and its scrolling <main> inside this column, so the tab bar stays
      on screen no matter how long the list gets — a fixed bar would be pushed out
      of the visual viewport the moment anything scrolled sideways.

      The drift takes seconds precisely so that nobody sees it. It rides on this
      wrapper rather than on a class on the page, so a route change never
      restarts it.
    -->
    <div
      class="flex h-dvh flex-col overflow-hidden transition-transform duration-[3000ms] ease-linear"
      :style="driftStyle"
    >
      <AppHeader v-if="showChrome && isWide" />
      <div class="flex min-h-0 flex-1 flex-col">
        <NuxtPage />
      </div>
      <AppTabBar v-if="showChrome && !isWide" />
    </div>
  </UApp>
</template>
