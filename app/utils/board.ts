/**
 * The wall dashboard's view model.
 *
 * One function, one object out. The board has six recognisable content states —
 * nominal, no plan, empty list, offline, nobody home, late evening — and the
 * temptation is six templates. It is deliberately not built that way: they are
 * not six screens, they are one screen under six sets of facts, and the moment
 * they are separate templates a fix to the roster row has to be made six times.
 * So everything below derives, and the components render whatever they are given.
 *
 * Pure, and importing nothing from the stores, for the same reason derive.ts and
 * generator.ts are: the whole state machine is then testable at a desk with no
 * browser, no database and no clock.
 *
 * Local time throughout, as everywhere else in this app. Times are 'HH:MM'
 * strings compared as minutes past midnight, dates are 'YYYY-MM-DD'.
 */

import { deriveLifeStage, type LifeStage } from './people'
import { personHue } from './person-colors'
import { pictureOf } from './photo'
import { displayIngredientName, shoppingName } from './shopping-name'
import { addDays, isoDate, isoWeekNumber, mondayOf, weekDates } from './week'

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface BoardPerson {
  id: string
  name: string
  date_of_birth: string | null
  /** Their photograph, or null for the initial in their own colour. */
  avatar: string | null
  created_at: string
}

export interface BoardConstraint {
  person_id: string
  kind: string
  tag: string
}

export interface BoardEvent {
  id: string
  title: string
  person_id: string | null
  all_day: boolean
  /** ISO instant. Ignored for all-day events, which have no meaningful time. */
  starts_at: string
  start_date: string
  end_date: string
}

/** A planned dinner, already joined to its recipe by the caller. */
export interface BoardMeal {
  entryId: string
  recipeId: string | null
  dish: string
  /** The recipe's photograph, or null. Absolute address on the source's CDN. */
  image: string | null
  /** Prep plus cook, or null when the recipe does not say. */
  minutes: number | null
  /** How many the night is planned for, which is the plan's number and not the recipe's. */
  servings: number
  note: string | null
  /** 'HH:MM', or null to mean the household's usual hour. */
  eatTime: string | null
  cookPersonId: string | null
  updatedAt: string
  /** Whether this night is reheating an earlier night's cooking. */
  leftover?: boolean
}

/** One night: what is planned, and who is eating it. */
export interface BoardNight {
  date: string
  meal: BoardMeal | null
  /** Everybody present for dinner. Babies included; they are filtered where it matters. */
  presentIds: string[]
}

export interface BoardShoppingInput {
  count: number
  /**
   * Whether this household has ever had anything on the list, ticked items and
   * deleted ones included.
   *
   * An empty list means two different things, and the board should not celebrate
   * the wrong one: a list cleared before a shop is an achievement, a list that
   * has never been used is just empty.
   */
  everUsed: boolean
}

export interface BoardWeather {
  icon: string
  temperature: number
}

/**
 * One thing tonight's meal still needs, straight off the shopping list.
 *
 * The design calls this section "Still to buy" and it means the gap, not the
 * inventory: an earlier version listed what the household already had, which
 * read as counter-intuitive on a board whose job is to prompt action.
 *
 * The gap is read off the list rather than off the pantry, even now that there is
 * one — the unchecked items this night's plan entry put there. The list has
 * already had the cupboard subtracted from it by the time it is derived, so this
 * inherits that for free, and a plan that has never been derived contributes
 * nothing here, which is correct: the next press is "Send to list", not the shop.
 */
export interface BoardToBuyLine {
  /** The plan entry that put this on the list. */
  entryId: string
  name: string
  /** '1 kg', or null when nobody said how much. */
  qty: string | null
}

export interface BoardInput {
  now: Date
  /**
   * Tonight first, then the following seven. Eight because the hero flips to
   * tomorrow late in the evening and still wants six days of week strip after it.
   */
  nights: BoardNight[]
  people: BoardPerson[]
  constraints: BoardConstraint[]
  /** Today's and tomorrow's events. Anything else is ignored. */
  events: BoardEvent[]
  /**
   * Whether a calendar has ever been synced, over any date.
   *
   * `events` being empty cannot answer this: a quiet Tuesday and a household
   * that has never connected Google look identical from today alone, and the
   * card should not blame staleness for something it was never told.
   */
  hasCalendar: boolean
  /** Unchecked plan-derived list items, for every night. Filtered to the hero's. */
  toBuy: BoardToBuyLine[]
  shopping: BoardShoppingInput
  /**
   * How many recipes the library holds. A count rather than the recipes
   * themselves: the board never lists them, it only needs to know whether the
   * generator has anything to work with.
   */
  recipeCount: number
  offline: boolean
  /** ISO instant of the last completed pull, or null if this device has never synced. */
  lastSyncedAt: string | null
  weather: BoardWeather | null
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type BoardState
  = 'nominal' | 'noplan' | 'emptylist' | 'offline' | 'nobodyhome' | 'lateevening' | 'setup'

/** One thing a household needs before the board can do its job. */
export interface SetupStep {
  label: string
  done: boolean
  /**
   * Where this step gets done, or null when it gets done right here.
   *
   * Only the generator is null: the other two are typing jobs that belong on a
   * phone, and the board's part is to say which one is next and open it.
   */
  to: string | null
}

export interface RosterPerson {
  id: string
  name: string
  initial: string
  /** Their photograph, or null for the initial in their own colour. */
  avatar: string | null
  hue: number
  absent: boolean
  /**
   * What is different about this person's plate.
   *
   * An adult portion is the default and goes unsaid — four chips each reading
   * "Adult portion" is four times nothing. A toddler's, a weaning baby's, and
   * anything anybody cannot have are the whole point of the roster and stay.
   */
  note: string
  /** Amber: they are out during the meal, or otherwise need acting on. */
  warn: string | null
}

export interface ScheduleRow {
  id: string
  /** 'HH:MM', or 'All day'. */
  time: string
  title: string
  /** 'Maya · recurring' — whose it is and anything worth flagging. May be empty. */
  meta: string
  hue: number | null
  past: boolean
  next: boolean
  meal: boolean
}

export interface WeekSlot {
  date: string
  /** 'Fri' */
  day: string
  /** '01' — the day of the month, beside the abbreviation. */
  dateLabel: string
  dish: string
  /** '25 min' or '6 servings'. Empty when there is nothing planned. */
  meta: string
  empty: boolean
  highlighted: boolean
}

/**
 * The strip along the top of every board view.
 *
 * Separate from the rest of the model because it outlives it: the header is the
 * one thing the shell keeps on screen while the view below it changes, so it has
 * to be derivable without working out a hero, a schedule and a week first.
 */
export interface BoardHeader {
  dayName: string
  dateLine: string
  /** 'Week 31' — ISO, so it agrees with everyone else's calendar. */
  weekLabel: string
  weather: BoardWeather | null
  /**
   * Whether the plan exists, and how long ago it was made.
   *
   * Relative rather than absolute: on a wall the useful question is "is this
   * still the plan", and "2 hours ago" answers it without arithmetic.
   */
  plan: { label: string, generated: boolean }
  stale: boolean
  /** 'Offline · last synced 15:58'. Null unless stale. */
  staleLabel: string | null
}

export interface BoardHeaderInput {
  now: Date
  /** Only the meals matter here, for the "plan updated" line. */
  nights: BoardNight[]
  offline: boolean
  lastSyncedAt: string | null
  weather: BoardWeather | null
}

// --- the library ------------------------------------------------------------

/** A recipe as the library reads it. The rows, minus what only an editor needs. */
export interface LibraryRecipe {
  id: string
  name: string
  /** The site's address; `photo` is the household's own picture and wins. */
  image_url: string | null
  photo?: string | null
  base_servings: number
  prep_minutes: number | null
  cook_minutes: number | null
  /**
   * When somebody shortlisted it, or null. Optional for the same reason the
   * generator's copy of this is: a caller that has not been told about the
   * shortlist yet describes a library with nothing on it.
   */
  shortlisted_at?: string | null
}

/** One ingredient line, for searching, listing, and diffing against the list. */
export interface LibraryLine {
  id: string
  recipe_id: string
  name: string
  quantity: string | null
  aisle_id: string | null
  /** The canonical ingredient, when the line has one. What the pantry is keyed on. */
  ingredient_id?: string | null
}

/** A night this recipe was, or will be, cooked. Past and future both matter. */
export interface LibraryPlanEntry {
  date: string
  recipe_id: string | null
}

/**
 * What is on the shopping list right now.
 *
 * Ticked items included: something already in the trolley is emphatically not
 * missing, and a button offering to buy the feta again on the walk home is the
 * kind of thing that gets an app deleted.
 */
export interface LibraryListItem {
  name: string
}

export type LibraryFacet = 'all' | 'shortlist' | 'quick' | 'batch' | 'planned' | 'pantry' | 'never'
export type LibrarySort = 'recent' | 'quickest' | 'cooked'

export interface LibraryInput {
  recipes: LibraryRecipe[]
  lines: LibraryLine[]
  planEntries: LibraryPlanEntry[]
  listItems: LibraryListItem[]
  now: Date
  /** Free text over recipe names and their ingredients. Trimmed here, not by the caller. */
  query: string
  facet: LibraryFacet
  sort: LibrarySort
  /** What the pane is showing, or null to mean "whatever is first". */
  selectedId: string | null
  /**
   * Whether the cupboard already covers a line, in full.
   *
   * Injected rather than worked out here, for the same reason derive injects its
   * ingredient resolution: the arithmetic needs base units, purchase units and
   * what the nights ahead have already claimed, none of which this file should
   * have to know about. Omitted means no pantry — every line counts as missing,
   * which is exactly how this behaved before there was one.
   */
  pantryCovers?: (line: LibraryLine) => boolean
}

export interface LibraryCard {
  id: string
  name: string
  image: string | null
  servings: number
  /** Prep plus cook, or null when the recipe does not say. */
  minutes: number | null
  cookedCount: number
  /** 'FRI' when it is on this week's plan, else null. */
  plannedDay: string | null
  /** '30 min · serves 4 · cooked 6×'. */
  meta: string
  /** The facets this recipe is in, minus 'all' — the chips drawn on the card. */
  chips: string[]
  /** Every ingredient is already in the house: cookable tonight, buying nothing. */
  fromPantry: boolean
  selected: boolean
}

export interface LibraryDetail {
  id: string
  name: string
  image: string | null
  /** 'LIBRARY · LAST COOKED 5 DAYS AGO' — the pane's eyebrow, already shouted. */
  eyebrow: string
  /** On the shortlist, so the pane's first button knows which way round it is. */
  shortlisted: boolean
  /** '35 min · serves 4 · cooked 11 times'. */
  meta: string
  ingredients: {
    id: string
    name: string
    quantity: string | null
    onList: boolean
    /** Already in the house, so neither on the list nor needing to be. */
    inPantry: boolean
  }[]
  /** The lines not already on the list, which is exactly what the button sends. */
  missing: { id: string, name: string, quantity: string | null, aisleId: string | null }[]
  /** 'Send 2 items to the shopping list', or null when there is nothing to send. */
  sendLabel: string | null
  /** When it was last cooked, most recent first. '26 Jul' beside '5 days ago'. */
  history: { date: string, dateLabel: string, label: string }[]
}

export interface LibraryModel {
  cards: LibraryCard[]
  facets: { key: LibraryFacet, label: string, count: number }[]
  detail: LibraryDetail | null
  /** True when the household has recipes but this search matches none of them. */
  noMatches: boolean
}

export interface BoardModel {
  /**
   * The dominant content state, for tests and for the acceptance script to assert
   * on. The components do not switch on it — they read the fields below, which is
   * what lets offline and an empty list coexist with any of the others.
   */
  state: BoardState
  header: BoardHeader
  hero: {
    /** 'Tonight', or 'Tomorrow · Friday'. */
    eyebrow: string
    date: string
    hasMeal: boolean
    recipeId: string | null
    dish: string
    /**
     * Tonight's photograph, or null. The board is read from across a kitchen,
     * where a picture identifies a meal faster than its name does.
     */
    image: string | null
    /** '35 min · 4 servings · one tray'. */
    dishMeta: string
    /** '18:30' for the card's badge. Null when there is no meal. */
    timing: string | null
    /** 'start by 17:55', or null when the recipe never said how long it takes. */
    startBy: string | null
    /** What tonight still needs. Empty when nothing does. */
    toBuy: { name: string, qty: string | null }[]
    cook: {
      id: string
      name: string
      initial: string
      avatar: string | null
      hue: number
      label: string
    } | null
    /** 'Four for dinner'. */
    eatingCount: string
    roster: RosterPerson[]
    foot: string
    /** Set only when there is no meal. */
    noMeal: {
      title: string
      body: string
      /** `to` is a route to open, or null to mean "run the generator here". */
      action: { label: string, to: string | null } | null
      /** Only in `setup`: what the household still needs, in the order to do it. */
      steps: SetupStep[]
      /** A mono aside for the far end of the footer — '~1 min', 'fridge night'. */
      hint: string
    } | null
  }
  schedule: {
    /** True when no calendar has ever synced — the ghost-rail body, not a quiet day. */
    empty: boolean
    /** '3 events' / 'No calendar' / 'Last known · 15:58'. */
    badge: string
    rows: ScheduleRow[]
    /** 'HH:MM' of the now marker, or null when offline or off the ends. */
    nowAt: string | null
    /** Index in `rows` the marker sits before. Only meaningful with `nowAt`. */
    nowIndex: number
    /** '2 earlier · +4 later, bins out 20:00'. */
    overflow: string
    dim: boolean
  }
  shopping: {
    empty: boolean
    /** True only when an empty list is an achievement, and may be shown in green. */
    resolved: boolean
    emptyTitle: string
    emptyBody: string
    /** Outstanding items. The rows themselves are live state, read by the card. */
    count: number
    /** '6 items', '1 item' — the header badge. */
    countLabel: string
  }
  week: WeekSlot[]
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** When dinner is, unless a plan entry says otherwise. */
export const DEFAULT_EAT_TIME = '18:00'

/**
 * What a leftovers night costs, in minutes.
 *
 * The recipe's own prep and cook are the wrong number entirely — the cooking
 * already happened — and they would have the board telling somebody to start a
 * ninety-minute roast that is sitting in the fridge. Reheating is reheating.
 */
export const LEFTOVER_REHEAT_MINUTES = 15

/**
 * How long after the meal the board stops being about tonight.
 *
 * Long enough to still show the plan while it is actually being eaten, short
 * enough that a board glanced at on the way to bed is already answering
 * tomorrow's question.
 */
const LATE_AFTER_MINUTES = 90

/** The clock past which an evening is late even on a night with nothing planned. */
const LATE_CLOCK = 20 * 60 + 30

/** Somebody leaving within this long after the meal starts is a clash worth amber. */
const CLASH_WINDOW_MINUTES = 60

/** What fits the schedule card without scrolling, which it must never do. */
const MAX_SCHEDULE_ROWS = 5

/** How many already-happened rows keep their place before `now`. */
const PAST_ROWS_KEPT = 2

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function clockOf(minutes: number): string {
  // Wraps rather than going negative: a 40-minute recipe eaten at 00:20 starts
  // the previous evening, and '23:40' is the useful thing to print.
  const wrapped = ((minutes % 1440) + 1440) % 1440
  const hours = String(Math.floor(wrapped / 60)).padStart(2, '0')
  return `${hours}:${String(wrapped % 60).padStart(2, '0')}`
}

function timeOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function dayName(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'long' })
}

function shortDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'short' })
}

/** '30 July' — the header's second line. */
function dateLine(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long'
  })
}

const NUMBER_WORDS = [
  'Nobody', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'
]

function numberWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count)
}

/** '4 servings', '1 serving'. The board says these out where people read them. */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function initialOfName(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?'
}

/** '4 min ago' / '2 hours ago' / 'yesterday'. Coarse on purpose — it is a wall. */
function relativeTime(from: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(from).getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/**
 * The portion this person eats, which is the roster row's whole job: one cooking
 * session, different plates. Derived from age, never stored.
 */
function portionFor(stage: LifeStage): string {
  switch (stage) {
    case 'baby': return 'Milk — no plate'
    case 'weaning': return 'Purée'
    case 'toddler': return 'Toddler portion'
    case 'child': return 'Child portion'
    default: return 'Adult portion'
  }
}

/**
 * Whether an event belongs to a given day.
 *
 * All-day events carry a half-open range, matching Google's own convention, so a
 * two-night trip covers start_date and the day after but not the day it ends.
 * Timed events are simply on their day: an appointment at 23:30 that runs past
 * midnight is still Thursday's appointment to everybody in the house.
 */
export function occursOn(
  event: Pick<BoardEvent, 'all_day' | 'start_date' | 'end_date'>,
  date: string
): boolean {
  return event.all_day
    ? event.start_date <= date && date < event.end_date
    : event.start_date === date
}

/** Everybody who actually eats food. A baby present for dinner is not a diner. */
function diners(night: BoardNight, people: BoardPerson[]): BoardPerson[] {
  const present = new Set(night.presentIds)
  return people.filter(
    person => present.has(person.id) && deriveLifeStage(person.date_of_birth, night.date) !== 'baby'
  )
}

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

/**
 * The header, on its own.
 *
 * Called directly by the board's shell, which keeps this strip on screen while
 * the view under it changes, and called again by {@link buildBoard} so that
 * there is exactly one implementation of what the top of the board says.
 */
export function buildHeader(input: BoardHeaderInput): BoardHeader {
  const today = isoDate(input.now)
  const lastSyncedClock = input.lastSyncedAt ? timeOf(new Date(input.lastSyncedAt)) : null

  const plannedUpdates = input.nights
    .map(night => night.meal?.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  const latest = plannedUpdates.at(-1)

  return {
    dayName: dayName(today),
    dateLine: dateLine(today),
    weekLabel: `Week ${isoWeekNumber(input.now)}`,
    weather: input.weather,
    plan: {
      label: latest
        ? `Plan generated · ${relativeTime(latest, input.now)}`
        : 'Plan not generated',
      generated: Boolean(latest)
    },
    // Staleness means drift from something that was once known to be true. A
    // device that has never completed a sync is not stale, it is new — and a
    // board warning about staleness before it has ever held data is crying wolf
    // on its very first paint.
    stale: input.offline && lastSyncedClock !== null,
    staleLabel: input.offline && lastSyncedClock !== null
      ? `Offline · last synced ${lastSyncedClock}`
      : null
  }
}

export function buildBoard(input: BoardInput): BoardModel {
  const { now, people, nights } = input
  const today = isoDate(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  const nightOn = (date: string) => nights.find(night => night.date === date)
  const tonight = nightOn(today)
  const tomorrowDate = isoDate(addDays(now, 1))
  const tomorrow = nightOn(tomorrowDate)

  const hueOf = (personId: string | null | undefined) =>
    personId ? personHue(personId, people) : null

  // --- which day is the hero about ------------------------------------------
  //
  // The board answers "what's for dinner" until dinner has been and gone; after
  // that the honest answer is tomorrow's. Anchored to the meal's own time rather
  // than to a fixed hour, so a household that eats at 20:00 is not told about
  // tomorrow while still at the table.
  const tonightEat = tonight?.meal ? minutesOf(tonight.meal.eatTime ?? DEFAULT_EAT_TIME) : null
  const lateEvening = tonightEat !== null
    ? nowMinutes >= tonightEat + LATE_AFTER_MINUTES
    : nowMinutes >= LATE_CLOCK

  const heroNight = lateEvening ? tomorrow : tonight
  const heroDate = heroNight?.date ?? (lateEvening ? tomorrowDate : today)
  const meal = heroNight?.meal ?? null
  const hasMeal = meal !== null

  const heroDiners = heroNight ? diners(heroNight, people) : []

  /**
   * A household that has not been set up yet, which is not the same as one with
   * nothing on tonight.
   *
   * Without this the two collapse: an empty roster satisfies "nobody is eating",
   * so a brand-new board announced that nobody was home for dinner and offered
   * no action, on the grounds that there was nothing to do. Everything was to do.
   * It also made `noplan` unreachable on a new household, so the one filled
   * button in the design could never be pressed — and pressing it with an empty
   * library does nothing anyway, because the generator skips every night it
   * cannot feed.
   *
   * Gated on there being no meal: if somebody has planned tonight by hand, that
   * is what the board is for, whatever else is missing.
   */
  const needsPeople = people.length === 0
  const needsRecipes = input.recipeCount === 0
  const setup = !hasMeal && (needsPeople || needsRecipes)

  const nobodyHome = !hasMeal && !setup && heroDiners.length === 0
  const noPlan = !hasMeal && !setup && heroDiners.length > 0

  const eatTime = meal?.eatTime ?? DEFAULT_EAT_TIME
  const eatMinutes = minutesOf(eatTime)

  // --- roster ----------------------------------------------------------------
  const constraintsFor = (personId: string) =>
    input.constraints.filter(row => row.person_id === personId).map(row => row.tag)

  // Who is out during the meal, and when. Only events on the hero's own day count
  // — an appointment tomorrow is not a reason to plate up early tonight.
  const clashAt = (personId: string): string | null => {
    for (const event of input.events) {
      if (event.person_id !== personId || event.all_day) continue
      if (!occursOn(event, heroDate)) continue
      const at = minutesOf(timeOf(new Date(event.starts_at)))
      if (at >= eatMinutes - CLASH_WINDOW_MINUTES && at <= eatMinutes + CLASH_WINDOW_MINUTES) {
        return clockOf(at)
      }
    }
    return null
  }

  const presentIds = new Set(heroNight?.presentIds ?? [])
  const roster: RosterPerson[] = people.map((person) => {
    const absent = !presentIds.has(person.id)
    const stage = deriveLifeStage(person.date_of_birth, heroDate)
    const tags = constraintsFor(person.id)
    const clash = absent ? null : clashAt(person.id)
    return {
      id: person.id,
      name: person.name,
      initial: initialOfName(person.name),
      avatar: person.avatar,
      hue: hueOf(person.id) ?? 0,
      absent,
      note: [
        stage === 'adult' ? null : portionFor(stage),
        ...tags.map(tag => `no ${tag}`)
      ].filter(Boolean).join(' · '),
      warn: clash ? `Out ${clash} — plate up first` : null
    }
  })

  // --- schedule --------------------------------------------------------------
  //
  // Today's calendar with the meal slotted into it, because dinner is the one
  // thing on this board that is both a plan and an appointment.
  const scheduleDate = lateEvening ? today : heroDate
  const dayEvents = input.events
    .filter(event => occursOn(event, scheduleDate))
    .map(event => ({
      id: event.id,
      at: event.all_day ? -1 : minutesOf(timeOf(new Date(event.starts_at))),
      time: event.all_day ? 'All day' : timeOf(new Date(event.starts_at)),
      title: event.title,
      hue: hueOf(event.person_id),
      meal: false,
      personId: event.person_id
    }))

  const todayMeal = tonight?.meal
  if (todayMeal) {
    const at = minutesOf(todayMeal.eatTime ?? DEFAULT_EAT_TIME)
    dayEvents.push({
      id: `meal-${todayMeal.entryId}`,
      at,
      time: clockOf(at),
      // Named as an appointment, because in this row that is what it is — the
      // one line that ties the calendar to the card above it.
      title: `Dinner — ${todayMeal.dish}${lateEvening ? ' · cooked' : ''}`,
      hue: null,
      meal: true,
      personId: null
    })
  }

  // Late in the evening everything today is behind us, so the first thing worth
  // showing is tomorrow morning's — otherwise the card is a list of things that
  // already happened.
  if (lateEvening) {
    const nextUp = input.events
      .filter(event => occursOn(event, tomorrowDate))
      .map(event => ({
        id: event.id,
        at: event.all_day ? -1 : minutesOf(timeOf(new Date(event.starts_at))),
        time: event.all_day ? 'All day' : timeOf(new Date(event.starts_at)),
        title: event.title,
        hue: hueOf(event.person_id),
        meal: false,
        personId: event.person_id
      }))
      .sort((a, b) => a.at - b.at)[0]
    if (nextUp) dayEvents.push({ ...nextUp, at: 1440 + Math.max(nextUp.at, 0) })
  }

  dayEvents.sort((a, b) => a.at - b.at)

  const clashIds = new Set(
    roster.filter(person => person.warn).map(person => person.id)
  )
  const firstUpcoming = dayEvents.findIndex(event => event.at > nowMinutes)
  // Whether anything is still to come *today*, which is what the card's heading
  // is about. Tomorrow's first event may well be on screen below it; that does
  // not make the evening unspent.
  const moreToday = dayEvents.some(event => event.at > nowMinutes && event.at < 1440)

  const nameOf = (personId: string | null) =>
    personId ? people.find(person => person.id === personId)?.name ?? null : null

  const allRows: ScheduleRow[] = dayEvents.map((event, index) => {
    const past = event.at <= nowMinutes
    const isNext = index === firstUpcoming
    const tomorrowRow = event.at >= 1440
    return {
      id: event.id,
      time: event.time,
      title: event.title,
      // Whose it is first, then why it matters — the second line of a row, so it
      // can afford both and neither has to fight for the title.
      meta: [
        nameOf(event.personId),
        tomorrowRow
          ? 'tomorrow'
          : event.personId && clashIds.has(event.personId)
            ? 'clashes with dinner'
            : isNext && !event.meal ? 'next' : null
      ].filter(Boolean).join(' · '),
      hue: event.hue,
      past: past && !tomorrowRow,
      next: isNext,
      meal: event.meal
    }
  })

  // Keep a couple of things that have already happened — a board with no recent
  // past reads as though the day started at this moment — then fill forward.
  //
  // Late in the day there is nothing left to fill forward with, so the window
  // reaches further back instead of leaving the card half empty. The budget is
  // what fits; it should always be spent.
  const upcomingStart = firstUpcoming === -1 ? allRows.length : firstUpcoming
  const pastWanted = Math.max(PAST_ROWS_KEPT, MAX_SCHEDULE_ROWS - (allRows.length - upcomingStart))
  const from = Math.max(0, upcomingStart - pastWanted)
  const rows = allRows.slice(from, from + MAX_SCHEDULE_ROWS)
  const earlier = from
  const later = allRows.length - (from + rows.length)

  // The marker asserts "it is now this time", which a board that cannot reach the
  // server has no business claiming. It goes rather than going stale.
  const markerIndex = rows.findIndex(row => !row.past)
  const nowAt = input.offline ? null : timeOf(now)
  const nowIndex = markerIndex === -1 ? rows.length : markerIndex

  const lastSyncedClock = input.lastSyncedAt ? timeOf(new Date(input.lastSyncedAt)) : null

  // What the card could not fit. Only ever counts things actually hidden: saying
  // "nothing else today" under a visible 20:00 row would be the board
  // contradicting itself in its own footer.
  const overflowParts: string[] = []
  if (earlier > 0) overflowParts.push(`${earlier} earlier`)
  if (later > 0) overflowParts.push(`+${later} later`)
  const overflow = !input.hasCalendar
    // Nothing has ever been synced, so there is nothing to caveat and nothing to
    // count. Saying either would be inventing a history the board never had.
    ? ''
    : input.offline
      ? lastSyncedClock
        ? `Events after ${lastSyncedClock} may have changed`
        : 'Events may have changed'
      : overflowParts.length
        ? overflowParts.join(' · ')
        : moreToday ? '' : 'Nothing else today'

  // --- hero copy -------------------------------------------------------------
  const cookPerson = meal?.cookPersonId
    ? people.find(person => person.id === meal.cookPersonId)
    : undefined

  const dishMeta = [
    meal?.minutes ? `${meal.minutes} min` : null,
    meal ? plural(meal.servings, 'serving') : null,
    meal?.note ?? null
  ].filter(Boolean).join(' · ')

  // The badge says when to eat; the footer says when to get up. Two facts in two
  // places, rather than one pill carrying both and being read as neither.
  const timing = hasMeal ? eatTime : null
  const startBy = meal?.minutes ? `start by ${clockOf(eatMinutes - meal.minutes)}` : null

  const toBuy = meal
    ? input.toBuy.filter(line => line.entryId === meal.entryId)
        .map(({ name, qty }) => ({ name, qty }))
    : []

  // The mono aside at the far end of the footer. Only ever a remark — the
  // actions beside it are the buttons, and this is what is worth saying once
  // they have been read. Empty when `startBy` has something more useful to say.
  const heroFoot = input.offline
    ? 'stored locally'
    : lateEvening && todayMeal
      ? `tonight's ${todayMeal.dish.toLowerCase()} is done`
      : ''

  // The board sends you to whichever step is actually next, rather than to a
  // generator that would silently do nothing without a roster or a library.
  const setupSteps: SetupStep[] = [
    { label: 'Add the people who eat here', done: !needsPeople, to: '/people' },
    { label: 'Put a few recipes in the library', done: !needsRecipes, to: '/recipes' },
    { label: 'Generate the week', done: false, to: null }
  ]

  const noMeal = hasMeal
    ? null
    : setup
      ? {
          title: 'Nothing set up yet',
          body: needsPeople
            ? 'Add the people who eat here, then a few recipes. This board fills itself in from your phone — there is nothing to set up on it.'
            : 'The roster is ready. Add a few recipes and the week can be generated from them.',
          action: needsPeople
            ? { label: 'Add people', to: '/people' }
            : { label: 'Add recipes', to: '/recipes' },
          steps: setupSteps,
          hint: '~1 min'
        }
      : nobodyHome
        ? {
            title: 'Nobody home for dinner',
            // Attendance says this, not the calendar — and on a household with
            // no calendar connected the old wording was asserting a source the
            // board had never read.
            body: 'No meal planned, and nobody is down as eating. Fridge night if plans change.',
            action: null,
            steps: [],
            hint: 'fridge night'
          }
        : {
            title: lateEvening ? 'No plan for tomorrow' : 'No plan for tonight',
            body: 'The weekly generator has not run. Attendance and the recipe library are ready.',
            action: { label: 'Generate this week’s plan', to: null },
            steps: [],
            hint: 'one press'
          }

  // --- week strip ------------------------------------------------------------
  //
  // Always the six days after today, never after the hero's day. Late in the
  // evening the hero is about tomorrow, and tomorrow is the first slot here — so
  // it gets highlighted rather than removed, and the strip and the hero point at
  // the same night instead of disagreeing about where the week starts.
  const week: WeekSlot[] = nights
    .filter(night => night.date > today)
    .slice(0, 6)
    .map(night => ({
      date: night.date,
      day: shortDay(night.date),
      dateLabel: night.date.slice(-2),
      dish: night.meal?.dish ?? 'No meal',
      // Minutes when the recipe says, servings otherwise. One number, because a
      // sixth of the strip is about as wide as a thumb.
      meta: night.meal
        ? night.meal.minutes
          ? `${night.meal.minutes} min`
          : plural(night.meal.servings, 'serving')
        : '',
      empty: !night.meal,
      highlighted: lateEvening && night.date === heroDate
    }))

  // --- shopping --------------------------------------------------------------
  const listEmpty = input.shopping.count === 0

  /**
   * An empty list is only worth celebrating if it was emptied.
   *
   * Green is this design's resolution colour — the reward for clearing the list
   * before a shop. Spending it on a household that has never added anything
   * congratulates them for something they have not done, and makes the colour
   * mean less the day they earn it.
   */
  const resolved = listEmpty && input.shopping.everUsed
  const emptyTitle = resolved ? 'Nothing to buy' : 'Nothing on the list yet'
  const emptyBody = resolved
    ? 'Everything for this week’s plan is in. Tap to add something.'
    : 'Add something from your phone and it shows up here.'

  // --- the label ------------------------------------------------------------
  //
  // Reported for tests and the acceptance script. Hero content wins over
  // presentation, because "nobody is home" is a bigger fact about the evening
  // than "the wifi is down" — and offline is visible in its own right anyway.
  const state: BoardState = setup
    ? 'setup'
    : nobodyHome
      ? 'nobodyhome'
      : noPlan
        ? 'noplan'
        : lateEvening
          ? 'lateevening'
          : input.offline
            ? 'offline'
            : listEmpty ? 'emptylist' : 'nominal'

  return {
    state,
    header: buildHeader(input),
    hero: {
      eyebrow: lateEvening ? `Tomorrow · ${dayName(heroDate)}` : 'Tonight',
      date: heroDate,
      hasMeal,
      recipeId: meal?.recipeId ?? null,
      dish: meal?.dish ?? '',
      image: meal?.image ?? null,
      dishMeta,
      timing,
      startBy,
      toBuy,
      cook: cookPerson
        ? {
            id: cookPerson.id,
            name: cookPerson.name,
            initial: initialOfName(cookPerson.name),
            avatar: cookPerson.avatar,
            hue: hueOf(cookPerson.id) ?? 0,
            label: lateEvening ? `${cookPerson.name} cooks tomorrow` : `${cookPerson.name} cooks`
          }
        : null,
      eatingCount: `${numberWord(heroDiners.length)} for dinner${lateEvening ? ' tomorrow' : ''}`,
      roster,
      foot: heroFoot,
      noMeal
    },
    schedule: {
      empty: !input.hasCalendar,
      // A card with no calendar behind it says so, rather than blaming the
      // network for an absence that predates it. Offline, it stops claiming to
      // be the calendar and starts saying when it last was one.
      badge: !input.hasCalendar
        ? 'No calendar'
        : input.offline
          ? lastSyncedClock ? `Last known · ${lastSyncedClock}` : 'Last known'
          : `${dayEvents.filter(event => !event.meal && event.at < 1440).length} events`,
      rows,
      nowAt,
      nowIndex,
      overflow,
      dim: input.offline
    },
    shopping: {
      empty: listEmpty,
      resolved,
      emptyTitle,
      emptyBody,
      count: input.shopping.count,
      countLabel: plural(input.shopping.count, 'item')
    },
    week
  }
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

/** Under this, a recipe is a weeknight one. */
const QUICK_MINUTES = 30

/** At or above this, it is worth cooking for a table rather than a plate. */
const BATCH_SERVINGS = 4

/** How many past nights the detail pane lists. Enough to see a habit, not a log. */
const MAX_HISTORY = 4

// Order is the order the chips are drawn in. Shortlisted sits straight after
// All, because it is the only one of these somebody chose on purpose.
const FACET_LABELS: Record<LibraryFacet, string> = {
  all: 'All',
  shortlist: 'Shortlisted',
  quick: 'Quick',
  batch: 'Big batch',
  planned: 'On the plan',
  pantry: 'From the pantry',
  never: 'Never cooked'
}

/** Loose enough that 'Feta ' and 'feta' are the same shopping trip. */
function libraryKey(name: string): string {
  return name.trim().toLowerCase()
}

function totalMinutes(recipe: LibraryRecipe): number | null {
  return (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0) || null
}

/** Whole days between two 'YYYY-MM-DD' dates, ignoring clocks and DST alike. */
function daysBetween(from: string, to: string): number {
  const parse = (date: string) => {
    const [year, month, day] = date.split('-').map(Number)
    return Date.UTC(year!, month! - 1, day!)
  }
  return Math.round((parse(to) - parse(from)) / 86_400_000)
}

/** 'today' / 'yesterday' / '5 days ago' / '3 weeks ago'. Coarse, like the header. */
function agoLabel(date: string, today: string): string {
  const days = daysBetween(date, today)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  return weeks < 9 ? `${weeks} weeks ago` : 'months ago'
}

/** '26 Jul' — the history rows. */
function shortDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short'
  })
}

/**
 * The recipe library, as the board reads it.
 *
 * Everything the mockup asks for is derived rather than stored. There is still no
 * tags column and this is deliberately not the change that adds one: how long a
 * recipe takes, how many it serves, how often it has been cooked, what is already
 * on the list and what is already in the cupboard are all facts the app has, and
 * they answer the same questions — quick tonight? feeds everyone? had it
 * recently? what would I have to buy, if anything?
 *
 * Cooked counts come from the plan rather than from a counter, so they are true
 * of what actually happened without anything having to be recorded. A future
 * night is not a time it was cooked; a past one is.
 */
export function buildRecipeLibrary(input: LibraryInput): LibraryModel {
  const today = isoDate(input.now)
  const query = libraryKey(input.query)

  // --- lines, grouped once ---------------------------------------------------
  const linesBy = new Map<string, LibraryLine[]>()
  for (const line of input.lines) {
    const group = linesBy.get(line.recipe_id)
    if (group) group.push(line)
    else linesBy.set(line.recipe_id, [line])
  }

  // --- when each recipe has been cooked, and when it is next on ---------------
  const cookedOn = new Map<string, string[]>()
  const plannedThisWeek = new Map<string, string>()
  const thisWeek = new Set(weekDates(mondayOf(input.now)))

  for (const entry of input.planEntries) {
    if (!entry.recipe_id) continue
    if (entry.date < today) {
      const dates = cookedOn.get(entry.recipe_id)
      if (dates) dates.push(entry.date)
      else cookedOn.set(entry.recipe_id, [entry.date])
    }
    // The badge is this week's, not the next time it appears: the grid sits
    // under a header about this week, and 'FRI' meaning a Friday five weeks out
    // would be read wrong every time.
    if (thisWeek.has(entry.date) && !plannedThisWeek.has(entry.recipe_id)) {
      plannedThisWeek.set(entry.recipe_id, shortDay(entry.date).toUpperCase())
    }
  }

  const onList = new Set(input.listItems.map(item => libraryKey(item.name)))
  const covers = input.pantryCovers ?? (() => false)

  // --- one pass, everything a card needs -------------------------------------
  const rows = input.recipes.map((recipe) => {
    const lines = linesBy.get(recipe.id) ?? []
    const history = (cookedOn.get(recipe.id) ?? []).sort().reverse()
    const minutes = totalMinutes(recipe)
    // A recipe with no ingredients recorded is not one you can make out of thin
    // air, so it is never "from the pantry".
    const fromPantry = lines.length > 0 && lines.every(line => covers(line))

    const facets = new Set<LibraryFacet>(['all'])
    if (recipe.shortlisted_at) facets.add('shortlist')
    if (minutes !== null && minutes <= QUICK_MINUTES) facets.add('quick')
    if (recipe.base_servings >= BATCH_SERVINGS) facets.add('batch')
    if (plannedThisWeek.has(recipe.id)) facets.add('planned')
    if (fromPantry) facets.add('pantry')
    if (!history.length) facets.add('never')

    return {
      recipe,
      lines,
      history,
      minutes,
      facets,
      fromPantry,
      cookedCount: history.length,
      lastCooked: history[0] ?? null,
      // Searching the ingredients as well as the name is the difference between
      // a filter and a way of answering "what can I do with the feta".
      haystack: [recipe.name, ...lines.map(line => line.name)].join(' ').toLowerCase()
    }
  })

  const matching = query ? rows.filter(row => row.haystack.includes(query)) : rows

  // Counts describe the search you are in, not the library — a chip promising
  // four when the grid under it can only show one is a chip that lies.
  const facets = (Object.keys(FACET_LABELS) as LibraryFacet[]).map(key => ({
    key,
    label: FACET_LABELS[key],
    count: matching.filter(row => row.facets.has(key)).length
  }))

  const filtered = matching.filter(row => row.facets.has(input.facet))

  const sorted = [...filtered].sort((a, b) => {
    if (input.sort === 'quickest') {
      // A recipe that never said how long it takes cannot be the quickest one.
      const left = a.minutes ?? Infinity
      const right = b.minutes ?? Infinity
      if (left !== right) return left - right
    }
    if (input.sort === 'cooked' && a.cookedCount !== b.cookedCount) {
      return b.cookedCount - a.cookedCount
    }
    if (input.sort === 'recent' && a.lastCooked !== b.lastCooked) {
      // Never cooked sorts last rather than first: "recent" is a question about
      // things that have happened.
      if (!a.lastCooked) return 1
      if (!b.lastCooked) return -1
      return b.lastCooked.localeCompare(a.lastCooked)
    }
    return a.recipe.name.localeCompare(b.recipe.name)
  })

  // A selection that has been searched away, or deleted on a phone. Falling to
  // the first card keeps the pane full, which is what the layout is for.
  const selected = sorted.find(row => row.recipe.id === input.selectedId) ?? sorted[0] ?? null

  const cards: LibraryCard[] = sorted.map(row => ({
    id: row.recipe.id,
    name: row.recipe.name,
    image: pictureOf(row.recipe),
    servings: row.recipe.base_servings,
    minutes: row.minutes,
    cookedCount: row.cookedCount,
    plannedDay: plannedThisWeek.get(row.recipe.id) ?? null,
    meta: [
      row.minutes ? `${row.minutes} min` : null,
      `serves ${row.recipe.base_servings}`,
      row.cookedCount ? `cooked ${row.cookedCount}×` : null
    ].filter(Boolean).join(' · '),
    chips: (['quick', 'batch'] as const)
      .filter(key => row.facets.has(key))
      .map(key => FACET_LABELS[key]),
    fromPantry: row.fromPantry,
    selected: row.recipe.id === selected?.recipe.id
  }))

  let detail: LibraryDetail | null = null

  if (selected) {
    // Tidied for reading, not for storing. This pane is where five meals are
    // compared, so a line reads as the thing you would buy — "Garlic cloves",
    // not "garlic cloves finely chopped". The recipe row is untouched and cook
    // mode still shows every word, because at the hob the instruction is the
    // point. Same rule, and the same function, as the shopping list.
    const ingredients = selected.lines.map(line => ({
      id: line.id,
      name: displayIngredientName(line.name),
      quantity: line.quantity,
      onList: onList.has(libraryKey(line.name)),
      inPantry: covers(line)
    }))
    // Something in the cupboard is no more missing than something in the trolley,
    // and a button offering to buy it again is the reason this feature exists.
    // `shoppingName`, not the pane's harder tidy: these names are what the button
    // actually writes onto the shopping list, so they follow the same rule as a
    // plan-derived item (see derive.ts) and land next to it rather than beside a
    // second spelling of the same thing.
    const missing = selected.lines
      .filter(line => !onList.has(libraryKey(line.name)) && !covers(line))
      .map(line => ({
        id: line.id,
        name: shoppingName(line.name),
        quantity: line.quantity,
        aisleId: line.aisle_id
      }))

    detail = {
      id: selected.recipe.id,
      name: selected.recipe.name,
      image: pictureOf(selected.recipe),
      eyebrow: selected.lastCooked
        ? `Library · last cooked ${agoLabel(selected.lastCooked, today)}`
        : 'Library · never cooked',
      shortlisted: Boolean(selected.recipe.shortlisted_at),
      meta: [
        selected.minutes ? `${selected.minutes} min` : null,
        `serves ${selected.recipe.base_servings}`,
        selected.cookedCount ? `cooked ${plural(selected.cookedCount, 'time')}` : null
      ].filter(Boolean).join(' · '),
      ingredients,
      missing,
      sendLabel: missing.length
        ? `Send ${plural(missing.length, 'item')} to the shopping list`
        : null,
      history: selected.history.slice(0, MAX_HISTORY).map(date => ({
        date,
        dateLabel: shortDate(date),
        label: agoLabel(date, today)
      }))
    }
  }

  return {
    cards,
    facets,
    detail,
    noMatches: input.recipes.length > 0 && cards.length === 0
  }
}
