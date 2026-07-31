<script setup lang="ts">
import { useSyncStore } from '../stores/sync'

/**
 * The bar at the top of every page that is not the dashboard.
 *
 * One component rather than a header written out on each page, because these
 * had drifted: the list had the sync state and a way to reach Settings, and
 * nothing else did, so how much you could trust what you were looking at
 * depended on which page you happened to be on.
 *
 * The title row is a fixed height on every page whether or not it has a back
 * button, so moving between pages does not shift the content under it by a few
 * pixels each time.
 *
 * Anything a page needs under the title — an add box, a search, the week
 * switcher — goes in the default slot and folds into the same sticky bar, so
 * there is one edge between the chrome and the page rather than two.
 */

const {
  title,
  back,
  backLabel = 'Back',
  contentClass = 'max-w-xl lg:max-w-3xl'
} = defineProps<{
  title?: string
  back?: string
  backLabel?: string
  /** Match the page's own container, so the bar lines up with what it sits over. */
  contentClass?: string
}>()

const sync = useSyncStore()
const route = useRoute()

/**
 * The wide layout carries both of these in the app header already, and Settings
 * does not need a button to itself.
 */
const showSettings = computed(() => route.path !== '/settings')
</script>

<template>
  <header class="sticky top-0 z-10 border-b border-default bg-default/85 backdrop-blur lg:static">
    <div
      class="mx-auto px-3 py-2 lg:px-6"
      :class="contentClass"
    >
      <div class="flex min-h-11 items-center gap-2">
        <UButton
          v-if="back"
          :to="back"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :aria-label="backLabel"
          class="-ml-2"
        />

        <slot name="title">
          <h1 class="min-w-0 flex-1 truncate text-lg font-semibold">
            {{ title }}
          </h1>
        </slot>

        <slot name="actions" />

        <!--
          Said in words rather than with an icon alone: "Offline · 3 to sync"
          tells you how much of this to trust, which a coloured dot does not.
        -->
        <UBadge
          v-if="sync.offline"
          color="neutral"
          variant="subtle"
          icon="i-lucide-cloud-off"
          class="lg:hidden"
        >
          {{ sync.pendingCount > 0 ? `${sync.pendingCount} to sync` : 'Offline' }}
        </UBadge>
        <UBadge
          v-else-if="sync.pendingCount > 0"
          color="neutral"
          variant="subtle"
          icon="i-lucide-refresh-cw"
          class="lg:hidden"
        >
          Saving
        </UBadge>

        <UButton
          v-if="showSettings"
          to="/settings"
          icon="i-lucide-settings"
          color="neutral"
          variant="ghost"
          class="-mr-2 lg:hidden"
          aria-label="Settings"
        />
      </div>

      <div
        v-if="$slots.default"
        class="pt-2"
      >
        <slot />
      </div>
    </div>
  </header>
</template>
