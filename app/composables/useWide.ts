import type { Ref } from 'vue'

/**
 * One question, asked once: is this a wide screen or a narrow one?
 *
 * The app has exactly two shapes — a phone column with a tab bar along the
 * bottom, and a desktop layout with the navigation in a header — and this is
 * the switch between them. 1024px is Tailwind's `lg`, so the pages that adapt
 * with `lg:` classes and the components swapped with `v-if` agree about where
 * the line is.
 *
 * With `ssr: false` the media query can be read synchronously before first
 * paint, so there is no flash of the wrong layout on load. The listener is
 * installed once and never removed: the app shell subscribes for the life of
 * the tab, so teardown bookkeeping would only ever run at page unload.
 */

const QUERY = '(min-width: 1024px)'

let listening = false

export function useWide(): Ref<boolean> {
  const isWide = useState('app.wide', () =>
    import.meta.client ? window.matchMedia(QUERY).matches : false
  )

  if (import.meta.client && !listening) {
    listening = true
    // The handler closes over the state ref rather than calling useState,
    // because a media-query event fires outside any Nuxt context.
    window.matchMedia(QUERY).addEventListener('change', (event) => {
      isWide.value = event.matches
    })
  }

  return isWide
}
