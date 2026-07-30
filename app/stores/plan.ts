import { defineStore } from 'pinia'
import type { ItemRow, PlanEntryRow, RecipeRow } from '../utils/db'
import { derive } from '../utils/derive'
import { generateWeek } from '../utils/generator'
import { deriveLifeStage } from '../utils/people'
import { plainCopy } from '../utils/sync'
import { addDays, isoDate, weekDates } from '../utils/week'
import { useAttendanceStore } from './attendance'
import { useIngredientsStore } from './ingredients'
import { useListStore } from './list'
import { usePeopleStore } from './people'
import { useRecipesStore } from './recipes'
import { nowIso, useSyncStore } from './sync'

export interface PlannedEntry {
  entry: PlanEntryRow
  /** Null when the recipe has since been deleted — the night still shows something. */
  recipe: RecipeRow | null
  derived: boolean
}

export interface PlannedNight {
  date: string
  entries: PlannedEntry[]
}

const DINNER = 'dinner'

export const usePlanStore = defineStore('plan', () => {
  const sync = useSyncStore()
  const recipesStore = useRecipesStore()
  const list = useListStore()
  const ingredients = useIngredientsStore()
  const people = usePeopleStore()
  const attendance = useAttendanceStore()

  const allEntries = computed(() => sync.rowsOf('meal_plan_entries'))

  const liveEntries = computed(() =>
    [...allEntries.value.values()]
      .filter(e => !e.deleted_at)
      .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
  )

  /** Plan entries that have put at least one live item on the shopping list. */
  const derivedEntryIds = computed(() => {
    const ids = new Set<string>()
    for (const item of sync.rowsOf('shopping_list_items').values()) {
      if (item.plan_entry_id && !item.deleted_at) ids.add(item.plan_entry_id)
    }
    return ids
  })

  function entriesOn(date: string): PlanEntryRow[] {
    return liveEntries.value.filter(e => e.date === date && e.meal === DINNER)
  }

  /** The seven date keys of the week starting on the given Monday. */
  function weekDatesFrom(weekStart: string): string[] {
    const [year, month, day] = weekStart.split('-').map(Number)
    return weekDates(new Date(year!, month! - 1, day!))
  }

  /** The seven nights of a week, empty ones included — the shape the page renders. */
  function week(weekStart: string): PlannedNight[] {
    return weekDatesFrom(weekStart).map(date => ({
      date,
      entries: entriesOn(date).map(entry => ({
        entry,
        recipe: recipesStore.recipeById(entry.recipe_id) ?? null,
        derived: derivedEntryIds.value.has(entry.id)
      }))
    }))
  }

  function isDerived(entryId: string) {
    return derivedEntryIds.value.has(entryId)
  }

  /**
   * Whether deriving this week could change anything.
   *
   * Not simply "are any nights planned": taking the last night off a week leaves
   * its ingredients on the list, and that is the moment you most need to derive.
   * Gating on planned nights alone would strand them there.
   */
  function hasWorkFor(weekStart: string): boolean {
    const dates = new Set(weekDatesFrom(weekStart))
    for (const entry of liveEntries.value) {
      if (dates.has(entry.date)) return true
    }
    for (const item of sync.rowsOf('shopping_list_items').values()) {
      if (item.deleted_at || item.source !== 'plan' || !item.plan_entry_id) continue
      const entry = allEntries.value.get(item.plan_entry_id)
      if (entry && dates.has(entry.date)) return true
    }
    return false
  }

  async function addEntry(date: string, recipeId: string, servings?: number) {
    if (!sync.householdId) return
    const recipe = recipesStore.recipeById(recipeId)
    if (!recipe) return
    const timestamp = nowIso()
    return sync.commit('meal_plan_entries', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      date,
      meal: DINNER,
      recipe_id: recipeId,
      servings: servings ?? recipe.base_servings,
      note: null,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  /**
   * One recipe per night, enforced here rather than by a unique constraint.
   *
   * The database deliberately tolerates two entries on a night, because two
   * phones planning offline mint different ids and a constraint would turn the
   * loser's write into a permanent rejection. Replacing on this side gives the
   * one-per-night behaviour people expect without that risk.
   */
  async function setNight(date: string, recipeId: string, servings?: number) {
    for (const existing of entriesOn(date)) {
      await sync.commit('meal_plan_entries', { ...plainCopy(existing), deleted_at: nowIso() })
    }
    return addEntry(date, recipeId, servings)
  }

  async function updateEntry(
    id: string,
    patch: Partial<Pick<PlanEntryRow, 'recipe_id' | 'servings' | 'note' | 'date'>>
  ) {
    const current = allEntries.value.get(id)
    if (!current) return
    await sync.commit('meal_plan_entries', { ...plainCopy(current), ...patch })
  }

  /**
   * Take a night off the plan. The items it generated are not touched here —
   * they go on the next deriveWeek, which is the only thing that reconciles the
   * list, so there is exactly one place that decides what an edit costs.
   */
  async function removeEntry(id: string) {
    const current = allEntries.value.get(id)
    if (!current) return
    await sync.commit('meal_plan_entries', { ...plainCopy(current), deleted_at: nowIso() })
  }

  async function clearNight(date: string) {
    for (const existing of entriesOn(date)) await removeEntry(existing.id)
  }

  /**
   * Fill the week's empty nights from the recipe library.
   *
   * Only the empty ones. Somebody who has already said "Thursday is the roast"
   * meant it, and a suggestion that overwrote them would be the last time they
   * pressed this button. Their choice still counts against repeats and towards
   * ingredient overlap, so the rest of the week is built around it.
   *
   * Nothing here is committed until the whole week has been decided, because the
   * picks depend on each other and a half-applied week is not a plan.
   */
  async function fillWeek(weekStart: string) {
    if (!sync.householdId) return { filled: 0, skipped: 0 }

    const dates = weekDatesFrom(weekStart)
    const planned = new Set<string>()
    const alreadyPlanned: { date: string, recipe_id: string }[] = []
    for (const date of dates) {
      for (const entry of entriesOn(date)) {
        planned.add(date)
        alreadyPlanned.push({ date, recipe_id: entry.recipe_id })
      }
    }

    const picks = generateWeek({
      nights: dates.map(date => ({
        date,
        people: attendance.presentOn(date).map(person => ({
          id: person.id,
          stage: deriveLifeStage(person.date_of_birth, date)
        }))
      })),
      recipes: [...sync.rowsOf('recipes').values()],
      lines: [...sync.rowsOf('recipe_ingredients').values()].map(line => ({
        recipe_id: line.recipe_id,
        name: line.name,
        // Resolved at read time, exactly as deriveWeek does it, so a library
        // canonicalised later starts overlapping without being migrated.
        ingredient_id: ingredients.ingredientById(line.ingredient_id)?.id
          ?? ingredients.resolve(line.name)?.id
          ?? null,
        deleted_at: line.deleted_at
      })),
      constraints: people.constraints,
      // Everything ever cooked before this week. Recency only looks back three
      // weeks, but which entries those are is the generator's business.
      history: liveEntries.value
        .filter(entry => entry.date < dates[0]!)
        .map(entry => ({ date: entry.date, recipe_id: entry.recipe_id })),
      alreadyPlanned
    })

    for (const pick of picks) {
      await addEntry(pick.date, pick.recipeId, pick.servings)
    }

    // A night is only "skipped" if somebody was eating and nothing could be
    // found — an empty night nobody is home for is the right plan, not a gap.
    const skipped = dates.filter(date =>
      !planned.has(date)
      && !picks.some(pick => pick.date === date)
      && attendance.presentOn(date).some(person => deriveLifeStage(person.date_of_birth, date) !== 'baby')
    ).length

    return { filled: picks.length, skipped }
  }

  /** Whether there is an empty night this week that somebody is eating on. */
  function hasGapsFor(weekStart: string): boolean {
    return weekDatesFrom(weekStart).some(date =>
      !entriesOn(date).length
      && attendance.presentOn(date).some(person => deriveLifeStage(person.date_of_birth, date) !== 'baby')
    )
  }

  /**
   * Put the week's ingredients on the shopping list, and take off the ones the
   * plan no longer calls for.
   *
   * Explicit rather than automatic: planning is bursty, and re-deriving on every
   * keystroke would churn the sync queue. Worse, deriving in response to inbound
   * realtime rows would have every device re-derive on every echo of every other
   * device's edit.
   */
  async function deriveWeek(weekStart: string) {
    if (!sync.householdId) return { added: 0, updated: 0, removed: 0 }

    const [year, month, day] = weekStart.split('-').map(Number)
    const monday = new Date(year!, month! - 1, day!)

    const planItems: ItemRow[] = []
    for (const item of sync.rowsOf('shopping_list_items').values()) {
      if (item.source === 'plan') planItems.push(item)
    }

    const { creates, updates, removes } = derive({
      householdId: sync.householdId,
      start: isoDate(monday),
      end: isoDate(addDays(monday, 6)),
      entries: [...allEntries.value.values()],
      recipes: sync.rowsOf('recipes'),
      ingredients: [...sync.rowsOf('recipe_ingredients').values()],
      planItems,
      rememberAisle: name => list.rememberedAisle(name),
      // Resolution runs on every derive rather than being written back to the
      // line, so a household that canonicalises its library later gets the
      // benefit on the next press of the button without anything being migrated.
      resolveIngredientId: line =>
        ingredients.ingredientById(line.ingredient_id)?.id
        ?? ingredients.resolve(line.name)?.id
        ?? null,
      ingredientAisle: id => (id ? ingredients.ingredientById(id)?.aisle_id ?? null : null),
      now: nowIso()
    })

    for (const row of [...creates, ...updates, ...removes]) {
      await sync.commit('shopping_list_items', row)
    }

    return { added: creates.length, updated: updates.length, removed: removes.length }
  }

  return {
    liveEntries,
    week,
    entriesOn,
    isDerived,
    hasWorkFor,
    addEntry,
    setNight,
    updateEntry,
    removeEntry,
    clearNight,
    fillWeek,
    hasGapsFor,
    deriveWeek
  }
})
