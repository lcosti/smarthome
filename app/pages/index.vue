<script setup lang="ts">
import { useChoresStore } from '../stores/chores'
import { useListStore } from '../stores/list'
import { usePeopleStore } from '../stores/people'
import { usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { useSyncStore } from '../stores/sync'
import { buildBoard, type BoardChore, type BoardEvent } from '../utils/board'
import { addDays, isoDate } from '../utils/week'

/**
 * Today: what is happening, what's for dinner, and what the rest of the week
 * looks like.
 *
 * The calendar leads. A household's day is not organised around its dinner —
 * dinner is one appointment in it, and the question somebody actually walks up
 * to this screen with is "what is on today". So the wide board gives the day
 * itself the large column and puts the meal beside it, and the phone answers
 * "what's for dinner" first because that is the one thing you would open an app
 * to check, then the day under it.
 *
 * Everything on it is derived by `buildBoard` — one pure function, one view
 * model, seven content states that fall out of the facts rather than being
 * seven templates.
 */

const sync = useSyncStore()
const people = usePeopleStore()
const plan = usePlanStore()
const recipes = useRecipesStore()
const list = useListStore()
const chores = useChoresStore()

const now = useBoardClock()
const nights = useBoardNights(now)
const { weather } = useWeather()
const isWide = useWide()

/**
 * Today, tomorrow, and the six days the week strip shows.
 *
 * Wider than it used to be: the strip names what each night is spoken for by, so
 * a trip on Thursday has to be readable from here and not just from the day it
 * starts.
 */
const events = computed<BoardEvent[]>(() => {
  const today = isoDate(now.value)
  const horizon = isoDate(addDays(now.value, 7))
  return [...sync.rowsOf('calendar_events').values()]
    .filter(row => !row.deleted_at && row.start_date <= horizon && row.end_date >= today)
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
 * Today's and tomorrow's chores, derived from their rules rather than read.
 *
 * Two days for the same reason the events run past today: late in the evening
 * the card is already answering tomorrow's question, and tomorrow's first thing
 * may well be a chore.
 */
const choreOccurrences = computed<BoardChore[]>(() =>
  [isoDate(now.value), isoDate(addDays(now.value, 1))]
    .flatMap(date => chores.occurrencesOn(date))
    .map(occurrence => ({
      choreId: occurrence.choreId,
      completionId: occurrence.completionId,
      date: occurrence.date,
      title: occurrence.title,
      person_id: occurrence.personId,
      time: occurrence.time,
      done: occurrence.done
    }))
)

const uncheckedCount = computed(() => list.liveItems.filter(item => !item.checked).length)

/**
 * Whether the list has ever been used, deleted and ticked rows included — which
 * is why it reads the raw map rather than `liveItems`. It is the difference
 * between a list cleared before a shop and one nobody has touched yet.
 */
const listEverUsed = computed(() => sync.rowsOf('shopping_list_items').size > 0)

/**
 * Whether a calendar has ever synced, over any date, not just today's window.
 *
 * Cancelled events do not count, matching the settings page exactly. Reading the
 * raw map — the way `listEverUsed` above deliberately does — was wrong here: a
 * week where every event got cancelled left the board claiming a connected
 * calendar with nothing on it while settings said there was none.
 */
const hasCalendar = computed(() =>
  [...sync.rowsOf('calendar_events').values()].some(row => !row.deleted_at)
)

const board = computed(() =>
  buildBoard({
    now: now.value,
    nights: nights.value,
    people: people.people,
    events: events.value,
    hasCalendar: hasCalendar.value,
    chores: choreOccurrences.value,
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

function openRecipe() {
  // Cook mode, not the recipe's edit page: the thing you want from tonight's
  // dinner while standing in the kitchen is the method, at a readable size.
  if (board.value.hero.recipeId) navigateTo(`/recipes/${board.value.hero.recipeId}/cook`)
}

/** Tick a chore off where it is read, which is the whole point of it being here. */
function tickChore(choreId: string, date: string) {
  void chores.toggleDone(choreId, date)
}

/** Take tonight off. The items it put on the list go on the next derive. */
function skipNight() {
  void plan.clearNight(board.value.hero.date)
}

/** Swapping is a choice from the library, and the library is a whole view. */
function swapMeal() {
  navigateTo(`/recipes?swap=${board.value.hero.date}`)
}
</script>

<template>
  <!--
    The state attribute waits for the database, and so does everything under it.
    `buildBoard` is pure and runs on whatever the stores hold, and for the frame
    before IndexedDB has handed its rows over that is nothing at all — which
    reads as `setup`, so a wall board with four people and fifty recipes opened
    every morning by saying "Nothing set up yet. Add the people who eat here."
    A skeleton for that frame is the same answer every other page in the app
    gives (`LoadingState`), and an absent attribute is what lets anything
    watching — the acceptance suite included — wait for a state that is true.
  -->
  <div
    :data-board-state="sync.hydrated ? board.state : undefined"
    class="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-4 overflow-y-auto px-3 pb-6 pt-3 lg:max-w-none lg:overflow-hidden lg:px-6"
  >
    <!--
      The phone's own header. The wide layout has AppHeader across the top of the
      shell; a phone has a tab bar at the bottom instead, so this page carries the
      date and the weather itself rather than opening with an untitled card.
    -->
    <header
      v-if="!isWide"
      class="flex flex-none items-center justify-between gap-3 pb-1"
    >
      <div class="flex min-w-0 items-baseline gap-2">
        <h1 class="truncate text-xl font-semibold text-highlighted">
          {{ board.header.dayName }}
        </h1>
        <span class="truncate text-sm text-muted">{{ board.header.dateLine }}</span>
      </div>
      <div class="flex flex-none items-center gap-1">
        <span
          v-if="board.header.weather"
          class="flex items-center gap-1.5 text-sm text-muted"
        >
          <UIcon
            :name="board.header.weather.icon"
            class="size-4"
          />
          {{ board.header.weather.temperature }}°
        </span>
        <UButton
          icon="i-lucide-settings"
          color="neutral"
          variant="ghost"
          to="/settings"
          aria-label="Settings"
        />
      </div>
    </header>

    <!--
      Wide: two full-height columns. The day takes the wide one with the week it
      belongs to underneath, and the meal sits beside it over the list, which
      takes whatever height is left.

      Phone: the meal first, then the day, then the week — and no shopping card
      at all. The list is one tap away on the bar along the bottom, and a second
      copy of it here would only be a longer scroll to the week.
    -->
    <!--
      No `overflow-hidden` here, deliberately. Every card in these columns already
      scrolls inside itself and every column is `min-h-0`, so nothing spills — and
      clipping at this box cut the ring off the first week tile, which starts on
      the very same pixel. The page root does the containing, and it clips a
      padding-width further out where there is room for a ring.
    -->
    <LoadingState
      v-if="!sync.hydrated"
      :rows="5"
      class="flex-1"
    />

    <div
      v-else
      class="contents lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)] lg:items-stretch lg:gap-4"
    >
      <div class="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-4">
        <BoardSchedule
          :schedule="board.schedule"
          class="order-2 lg:order-none lg:min-h-0 lg:flex-1"
          @tick="tickChore"
        />
        <BoardWeek
          :week="board.week"
          class="order-3 lg:order-none"
        />
      </div>

      <div class="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-4">
        <BoardHero
          :hero="board.hero"
          class="order-1 lg:order-none"
          @open="openRecipe"
          @skip="skipNight"
          @swap="swapMeal"
        />
        <BoardShopping
          v-if="isWide"
          :shopping="board.shopping"
        />
      </div>
    </div>
  </div>
</template>
