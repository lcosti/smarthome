<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * The page that shows when nothing else could.
 *
 * Inside UApp, because without it the error page loses the theme and renders as
 * unstyled Nuxt boilerplate — which on a home-screen app reads as the app being
 * broken rather than as one address being wrong.
 *
 * `clearError` rather than a plain link: it tears down the error state as it
 * navigates, so the shell is not left holding it.
 */
const { error } = defineProps<{ error: NuxtError }>()

const isMissing = computed(() => error.statusCode === 404)
</script>

<template>
  <UApp>
    <div class="flex h-dvh items-center justify-center p-6">
      <UEmpty
        :icon="isMissing ? 'i-lucide-map-pin-off' : 'i-lucide-triangle-alert'"
        :title="isMissing ? 'That page isn’t here.' : 'Something went wrong.'"
        :description="isMissing
          ? 'The list, the plan and the recipes are all still where you left them.'
          : 'The list is stored on this device, so nothing has been lost.'"
        :actions="[{
          label: 'Go to the list',
          size: 'lg',
          onClick: () => clearError({ redirect: '/' })
        }]"
      />
    </div>
  </UApp>
</template>
