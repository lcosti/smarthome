// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxtjs/supabase',
    '@pinia/nuxt',
    '@vite-pwa/nuxt'
  ],

  // Non-negotiable: the primary use case is a phone in a supermarket with poor
  // signal, where a server round trip before first paint is unaffordable.
  // See CLAUDE.md.
  ssr: false,

  devtools: {
    enabled: true
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Shopping List',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'apple-mobile-web-app-title', content: 'Shopping' }
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico' },
        // iOS ignores the web app manifest icons.
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' }
      ]
    }
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      // Where the house is, for the wall board's weather. London by default;
      // override with NUXT_PUBLIC_HOME_LATITUDE / NUXT_PUBLIC_HOME_LONGITUDE.
      // Not a secret — Open-Meteo needs no key, which is why it was chosen.
      homeLatitude: 51.5072,
      homeLongitude: -0.1276
    }
  },

  // 4000 for dev, 4001 for the acceptance harness, so a dev server left running
  // cannot quietly steal the port the tests serve the production bundle on. Both
  // ports are in the auth redirect allow-list in supabase/config.toml.
  devServer: {
    port: 4000
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  // Every icon the wall board can draw, listed because the board must render
  // with no network at all.
  //
  // An icon that is not in the client bundle is fetched at runtime, and an icon
  // fetched at runtime on a kiosk with no signal is a silent gap — the element
  // is still there, correctly sized and coloured, simply with no mask to paint.
  // The weather ones cannot be found by scanning at all, since the name is
  // chosen from a weather code at runtime.
  icon: {
    clientBundle: {
      icons: [
        'lucide:sun',
        'lucide:moon',
        'lucide:cloud',
        'lucide:cloud-sun',
        'lucide:cloud-moon',
        'lucide:cloud-fog',
        'lucide:cloud-rain',
        'lucide:cloud-lightning',
        'lucide:snowflake',
        'lucide:circle-check-big',
        'lucide:circle-dashed',
        'lucide:check',
        'lucide:arrow-right',
        'lucide:arrow-left',
        'lucide:book-open'
      ]
    }
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Shopping List',
      short_name: 'Shopping',
      description: 'The household shopping list',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      theme_color: '#0f172a',
      background_color: '#ffffff',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ],
      // Long-press the home screen icon. The list stays start_url — it is what
      // the app is for — but the other two are one press away.
      shortcuts: [
        { name: 'Plan the week', short_name: 'Plan', url: '/plan' },
        { name: 'Recipes', short_name: 'Recipes', url: '/recipes' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      // Cold offline navigations resolve to the precached shell.
      //
      // Must be '/' and not '/index.html': the module rewrites that precache
      // entry to the base URL, so the manifest holds '/' and nothing else. The
      // navigation route is bound to this URL by a plain lookup against those
      // keys, and a miss throws inside a promise — silently, after precaching
      // has already succeeded. The app still opens offline on every prerendered
      // route, which is why this hid for a whole phase; a dynamic route like
      // /recipes/<id> has no entry of its own and had no fallback either.
      navigateFallback: '/',
      // Supabase requests must never be served from the service worker cache —
      // offline behaviour is owned by the Dexie/mutation-queue layer.
      navigateFallbackDenylist: [/^\/api/],
      cleanupOutdatedCaches: true,
      // Recipe photographs, which live on whichever site the recipe came from.
      //
      // The one thing in the app allowed to come from the network cache, and it
      // earns the exception: the address is stored, the bytes are not, so
      // without this the kitchen tablet loses every picture the moment the wifi
      // does. CacheFirst because a recipe photograph does not change — if the
      // site replaces it the address changes with it.
      //
      // Scoped to cross-origin images so it can never shadow a Supabase call,
      // whose offline behaviour belongs to the Dexie and mutation-queue layer.
      runtimeCaching: [
        {
          urlPattern: ({ request, sameOrigin }) => !sameOrigin && request.destination === 'image',
          handler: 'CacheFirst',
          options: {
            cacheName: 'recipe-images',
            // A household's library, not a catalogue. Well past what four people
            // cook from, and small enough that the cache is never the reason a
            // phone runs out of room.
            expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 60 },
            // Opaque responses have no readable status; without this a CDN that
            // does not send CORS headers would never be cached at all.
            cacheableResponse: { statuses: [0, 200] }
          }
        }
      ]
    },
    // A dev service worker serves stale bundles; test with `pnpm generate`.
    devOptions: {
      enabled: false
    }
  },

  supabase: {
    // Session in localStorage rather than SSR cookies: keeps the shared kitchen
    // tablet signed in indefinitely.
    useSsrCookies: false,
    // No login-redirect middleware; the auth guard is hand-rolled.
    redirect: false,
    types: '~~/shared/types/database.types.ts'
  }
})
