<script setup lang="ts">
import { useAttendanceStore } from '../../stores/attendance'
import { useListStore } from '../../stores/list'
import { usePeopleStore } from '../../stores/people'
import { usePlanStore } from '../../stores/plan'
import { useRecipesStore } from '../../stores/recipes'
import { useSyncStore } from '../../stores/sync'
import { buildBoard, type BoardEvent } from '../../utils/board'
import { addDays, isoDate } from '../../utils/week'

/**
 * Today: what's for dinner, who's eating it, what else is happening, what needs
 * buying, and what the rest of the week looks like.
 *
 * The default view, and the one the board exists for. Everything on it is
 * derived by `buildBoard` — one pure function, one view model, seven content
 * states that fall out of the facts rather than being seven templates.
 */

const sync = useSyncStore()
const people = usePeopleStore()
const plan = usePlanStore()
const recipes = useRecipesStore()
const attendance = useAttendanceStore()
const list = useListStore()
const route = useRoute()

const now = useBoardClock()
const nights = useBoardNights(now)
const { weather } = useWeather()

/** Today and tomorrow only. The card cannot show more, so nothing else is read. */
const events = computed<BoardEvent[]>(() => {
  const today = isoDate(now.value)
  const tomorrow = isoDate(addDays(now.value, 1))
  return [...sync.rowsOf('calendar_events').values()]
    .filter(row => !row.deleted_at && row.start_date <= tomorrow && row.end_date >= today)
    .map(row => ({
      id: row.id,
      title: row.title,
      person_id: row.person_id,
      all_day: row.all_day,
      starts_at: row.starts_at,
      start_date: row.start_date,
      end_date: row.end_date
    }))
})

/**
 * The three next things to buy, in the order the shop is actually walked —
 * aggregated lines, not raw rows, so "milk" asked for by two recipes is one item
 * with one total rather than two lines saying half the truth each.
 */
const nextItems = computed(() =>
  list.groups
    .flatMap(group => group.entries)
    .slice(0, 3)
    .map(entry => entry.quantityLabel ? `${entry.name} — ${entry.quantityLabel}` : entry.name)
)

const recentAdd = computed(() => {
  const newest = list.liveItems
    .filter(item => !item.checked && item.added_by)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return newest
    ? { personId: newest.added_by, label: newest.name, at: newest.created_at }
    : null
})

const uncheckedCount = computed(() => list.liveItems.filter(item => !item.checked).length)

/**
 * Whether the list has ever been used, deleted and ticked rows included — which
 * is why it reads the raw map rather than `liveItems`. It is the difference
 * between a list cleared before a shop and one nobody has touched yet.
 */
const listEverUsed = computed(() => sync.rowsOf('shopping_list_items').size > 0)

/** Whether a calendar has ever synced, over any date, not just today's window. */
const hasCalendar = computed(() => sync.rowsOf('calendar_events').size > 0)

const board = computed(() =>
  buildBoard({
    now: now.value,
    nights: nights.value,
    people: people.people,
    constraints: people.constraints.map(row => ({
      person_id: row.person_id,
      kind: row.kind,
      tag: row.tag
    })),
    events: events.value,
    hasCalendar: hasCalendar.value,
    shopping: {
      count: uncheckedCount.value,
      next: nextItems.value,
      recentAdd: recentAdd.value,
      everUsed: listEverUsed.value
    },
    recipeCount: recipes.recipes.length,
    offline: sync.offline,
    lastSyncedAt: sync.lastSyncedAt,
    weather: weather.value
  })
)

/** Dish-led by default; ?hero=roster switches treatment for the same facts. */
const rosterLed = computed(() => route.query.hero === 'roster')

const generating = ref(false)

async function generate() {
  if (generating.value) return
  // No spinner and no overlay — the label changes and the board keeps its
  // content, which is the rule everywhere on this screen.
  generating.value = true
  try {
    // From tonight forward, not from Monday: on a Friday, filling the calendar
    // week would spend most of its effort on nights that have already been and
    // gone, and leave the weekend the board is actually showing still empty.
    await plan.fillWeek(isoDate(now.value))
  } finally {
    generating.value = false
  }
}

function openRecipe() {
  // Into the board's own recipe view, not the phone page: this is a kiosk, and
  // a max-w-xl column under a 1920px header would be a different application.
  if (board.value.hero.recipeId) navigateTo(`/board/recipes/${board.value.hero.recipeId}`)
}

function togglePerson(personId: string) {
  void attendance.togglePresence(personId, board.value.hero.date)
}
</script>

<template>
  <div
    :data-board-state="board.state"
    class="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_188px] gap-[18px]"
  >
    <div class="grid min-h-0 grid-cols-[1.32fr_1fr] gap-[22px]">
      <BoardHero
        :hero="board.hero"
        :roster-led="rosterLed"
        :generating="generating"
        @open="openRecipe"
        @generate="generate"
        @toggle="togglePerson"
      />

      <div class="flex min-h-0 flex-col gap-[22px]">
        <BoardSchedule :schedule="board.schedule" />
        <BoardShopping
          :shopping="board.shopping"
          @open="navigateTo('/board/list')"
        />
      </div>
    </div>

    <BoardWeek :week="board.week" />
  </div>
</template>
