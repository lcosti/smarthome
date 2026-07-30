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

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
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
      navigateFallback: '/index.html',
      // Supabase requests must never be served from the service worker cache —
      // offline behaviour is owned by the Dexie/mutation-queue layer.
      navigateFallbackDenylist: [/^\/api/],
      cleanupOutdatedCaches: true
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
