/*
  Register the service worker from the document, not from the app.

  This is the whole offline promise and it used to be the last thing to happen:
  @vite-pwa/nuxt registers from a Nuxt plugin, so nothing was requested until the
  entire SPA bundle had arrived, parsed and booted — around two megabytes of
  JavaScript. Every visit that ended before that left the device with no worker
  and no precached shell, and a device with no worker does not fail visibly. It
  opens fine for weeks, because it is online, and then the one time it is asked
  to open with no signal it never reaches a line of this app: the browser serves
  its own offline page and the app is simply not there.

  A phone that gets a few seconds of signal in a shop is the device this is
  written for, so registration cannot sit at the back of the queue. Inline in the
  head it starts on the first packet of HTML and depends on nothing else
  succeeding — not the bundle, not Supabase, not the app booting at all.

  The reload is what `registerType: 'autoUpdate'` was doing for us: a new worker
  takes over the moment it activates (clientsClaim + skipWaiting, set explicitly
  in the pwa block), which leaves the page running code from the build before it.
  `had` is read first, before registering: on a first-ever load there is no
  controller and the claim that follows is not an update, so that one must not
  reload. The flag makes it once-only in a tab.
*/
const REGISTER_SERVICE_WORKER = `if('serviceWorker' in navigator){`
  + `var had=!!navigator.serviceWorker.controller;`
  + `navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});`
  + `navigator.serviceWorker.addEventListener('controllerchange',function(){`
  + `if(had&&!window.__swReloaded){window.__swReloaded=1;location.reload()}})}`

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
        // Both: iOS reads only the Apple-prefixed one, Chrome deprecated it.
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'apple-mobile-web-app-title', content: 'Shopping' }
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico' },
        // iOS ignores the web app manifest icons.
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' }
      ],
      // Production only. `pwa.devOptions.enabled` is off, so there is no worker
      // to register while developing, and asking for one would put a MIME-type
      // failure in the console on every page of every dev session — the dev
      // server answers an unknown path with HTML rather than a 404.
      script: process.env.NODE_ENV === 'production'
        ? [{ innerHTML: REGISTER_SERVICE_WORKER }]
        : []
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

  // Every icon the app can draw, in the bundle, because the app must render
  // with no network at all.
  //
  // An icon that is not in the client bundle is fetched at runtime, and there is
  // nothing to fetch it from: `ssr: false` means no server route to serve it, so
  // the request goes to the Iconify CDN. Online that works and hides this
  // entirely; offline the element is still there, correctly sized and coloured,
  // simply with no mask to paint. The tab bar was four blank squares and a row
  // of words with no signal.
  //
  // `scan` is what fixes that in bulk: it reads every icon name written in this
  // project's own source. It defaults to off, and naming `icons` does not turn
  // it on — which is why thirty of them, the whole tab bar included, were only
  // ever coming down the wire.
  //
  // The list below is the rest: names scanning cannot see because nothing in
  // this project writes them. The weather ones are chosen from a weather code at
  // runtime, and the others are reached for by Nuxt UI's own components — the
  // spinner on a loading button, the tick inside a checkbox, the chevrons on a
  // number input, the cross that closes a modal — from inside node_modules,
  // which is not scanned. The ones that scanning does now find are left here
  // rather than pruned: they are named at runtime from a token or a ternary, and
  // the scan finding today's spelling of them is luck rather than cover.
  icon: {
    clientBundle: {
      scan: true,
      icons: [
        // Injected by Nuxt UI components rather than written in our templates.
        'lucide:loader-circle',
        'lucide:chevron-down',
        'lucide:chevron-up',
        'lucide:chevron-left',
        'lucide:chevron-right',
        'lucide:x',
        'lucide:minus',
        'lucide:plus',
        'lucide:search',
        'lucide:info',
        'lucide:circle-alert',
        'lucide:triangle-alert',
        'lucide:lightbulb',
        'lucide:copy',
        'lucide:copy-check',
        'lucide:package-check',
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
        'lucide:book-open',
        // Chosen by a ternary on the library pane's shortlist button.
        'lucide:bookmark-plus',
        // Chosen by a ternary on the week aside's "nothing to suggest" empty state.
        'lucide:search-x',
        // Named in a toast when a chosen photo will not decode.
        'lucide:image-off',
        // Named in the toast that follows dragging a dish onto the shortlist,
        // where the scanner does not look — the one drop that takes a night off
        // the plan, and offers to put it back.
        'lucide:undo-2',
        // Built in a computed on the plan's night cards, where the scanner does
        // not look: what a dish costs in time and in things to buy.
        'lucide:clock',
        'lucide:utensils',
        'lucide:refrigerator',
        // Chosen from a stored token by skipIcon(), on a night nobody is cooking.
        'lucide:bike',
        'lucide:utensils-crossed',
        'lucide:users',
        'lucide:circle-slash',
        // Chosen at runtime by aisleIcon(), from the aisle's name.
        'lucide:carrot',
        'lucide:croissant',
        'lucide:milk',
        'lucide:beef',
        'lucide:package',
        'lucide:spray-can',
        'lucide:cup-soda',
        'lucide:shopping-basket'
      ]
    }
  },

  pwa: {
    registerType: 'autoUpdate',
    // The module's own registration is off: the head script in `app.head`
    // above does it, early enough to matter. Two registrations of the same
    // script are idempotent, but they disagree about who owns the reload when a
    // new build takes over — workbox-window reads a worker it did not register
    // as external and reloads for it too — so there is one of them.
    client: {
      registerPlugin: false
    },
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
      // Long-press the home screen icon. Today is start_url — it answers
      // "what's going on" without being asked — and the rest are one press away.
      shortcuts: [
        { name: 'Shopping list', short_name: 'Shopping', url: '/shopping' },
        { name: 'Plan the week', short_name: 'Plan', url: '/plan' },
        { name: 'Recipes', short_name: 'Recipes', url: '/recipes' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      // Set for us by `registerType: 'autoUpdate'`, but only while the module
      // owns registration — which it no longer does. Without them a new build
      // installs and then waits for every tab to close, which on a home-screen
      // app is never, and the reload in the head script has nothing to fire on.
      clientsClaim: true,
      skipWaiting: true,
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
