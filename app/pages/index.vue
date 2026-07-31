<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { useListStore } from '../stores/list'
import { usePeopleStore } from '../stores/people'
import { usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { useSyncStore } from '../stores/sync'
import { buildBoard, type BoardEvent, type BoardToBuyLine } from '../utils/board'
import { addDays, isoDate, mondayOf } from '../utils/week'

/**
 * Today: what's for dinner, who's eating it, what else is happening, what needs
 * buying, and what the rest of the week looks like.
 *
 * The view the kitchen tablet sits on all day, and the same view on a phone in
 * a column. Everything on it is derived by `buildBoard` — one pure function,
 * one view model, seven content states that fall out of the facts rather than
 * being seven templates.
 */

const sync = useSyncStore()
const people = usePeopleStore()
const plan = usePlanStore()
const recipes = useRecipesStore()
const attendance = useAttendanceStore()
const list = useListStore()

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

const uncheckedCount = computed(() => list.liveItems.filter(item => !item.checked).length)

/**
 * What each planned night still needs, straight off the list.
 *
 * Raw rows rather than the aggregated entries the list view uses: these have to
 * stay attributable to the plan entry that created them, and aggregation is
 * precisely the step that throws that away by merging the milk two recipes asked
 * for into one line.
 */
const toBuy = computed<BoardToBuyLine[]>(() =>
  list.liveItems
    .filter(item => !item.checked && item.plan_entry_id)
    .map(item => ({ entryId: item.plan_entry_id!, name: item.name, qty: item.quantity }))
)

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
    toBuy: toBuy.value,
    shopping: {
      count: uncheckedCount.value,
      everUsed: listEverUsed.value
    },
    recipeCount: recipes.recipes.length,
    offline: sync.offline,
    lastSyncedAt: sync.lastSyncedAt,
    weather: weather.value
  })
)

const generating = ref(false)

async function generate() {
  if (generating.value) return
  // No spinner and no overlay — the button's own label changes and the page
  // keeps its content, which is the rule everywhere on this screen.
  generating.value = true
  try {
    // From tonight forward, not from Monday: on a Friday, filling the calendar
    // week would spend most of its effort on nights that have already been and
    // gone, and leave the weekend the page is actually showing still empty.
    await plan.fillWeek(isoDate(now.value))
  } finally {
    generating.value = false
  }
}

function openRecipe() {
  // Cook mode, not the recipe's edit page: the thing you want from tonight's
  // dinner while standing in the kitchen is the method, at a readable size.
  if (board.value.hero.recipeId) navigateTo(`/recipes/${board.value.hero.recipeId}/cook`)
}

function togglePerson(personId: string) {
  void attendance.togglePresence(personId, board.value.hero.date)
}

/** Take tonight off. The items it put on the list go on the next derive. */
function skipNight() {
  void plan.clearNight(board.value.hero.date)
}

/**
 * Push the plan's ingredients onto the list.
 *
 * The whole week rather than just tonight, because `deriveWeek` is the one thing
 * that reconciles the list in both directions — running it for a single night
 * would add what that night wants without taking off what a cancelled Tuesday
 * left behind.
 */
const sending = ref(false)

async function sendToList() {
  if (sending.value) return
  sending.value = true
  try {
    const [year, month, day] = board.value.hero.date.split('-').map(Number)
    await plan.deriveWeek(isoDate(mondayOf(new Date(year!, month! - 1, day!))))
  } finally {
    sending.value = false
  }
}

/** Swapping is a choice from the library, and the library is a whole view. */
function swapMeal() {
  navigateTo(`/recipes?swap=${board.value.hero.date}`)
}
</script>

<template>
  <div
    :data-board-state="board.state"
    class="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-4 overflow-y-auto px-3 pb-6 pt-3 lg:max-w-none lg:overflow-hidden lg:px-6"
  >
    <!--
      One column on a phone, two on a wide screen. The hero is the reason this
      page exists, so it gets the larger share and the two smaller cards stack
      beside it rather than under it.
    -->
    <div class="grid items-stretch gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:overflow-hidden">
      <BoardHero
        :hero="board.hero"
        :generating="generating"
        :sending="sending"
        @open="openRecipe"
        @generate="generate"
        @toggle="togglePerson"
        @skip="skipNight"
        @swap="swapMeal"
        @send="sendToList"
      />

      <div class="flex min-h-0 flex-col gap-4">
        <BoardSchedule :schedule="board.schedule" />
        <BoardShopping :shopping="board.shopping" />
      </div>
    </div>

    <BoardWeek
      :week="board.week"
      :generating="generating"
      @generate="generate"
    />
  </div>
</template>
