import { defineStore } from 'pinia'
import type { ItemRow, PlanEntryRow, RecipeIngredientRow, RecipeRow } from '../utils/db'
import { derive, type DeriveInput } from '../utils/derive'
import {
  buildContext,
  eaters,
  generateWeek,
  topCandidates,
  type GenerateInput,
  type RankedCandidate
} from '../utils/generator'
import { derivePantryReservations } from '../utils/pantry'
import { deriveLifeStage } from '../utils/people'
import { LEFTOVER_MAX_AGE_DAYS, planMove } from '../utils/plan-move'
import { skipLabel } from '../utils/skip'
import { plainCopy } from '../utils/sync'
import { addDays, isoDate, todayIso, weekDates } from '../utils/week'
import { useAttendanceStore } from './attendance'
import { asBaseUnit, useIngredientsStore } from './ingredients'
import { useListStore } from './list'
import { usePantryStore } from './pantry'
import { usePeopleStore } from './people'
import { useRecipesStore } from './recipes'
import { nowIso, useSyncStore } from './sync'

export interface PlannedEntry {
  entry: PlanEntryRow
  /** Null when the recipe has since been deleted — the night still shows something. */
  recipe: RecipeRow | null
  /**
   * Whether the night is planned as not being cooked — a takeaway, a meal out.
   *
   * A decision, and the opposite of an empty night: nothing is bought for it,
   * nothing is offered for it, and it counts as one of the week's nights that
   * have been dealt with. Read off the row rather than stored twice — an entry
   * with no recipe is a night with no cooking.
   */
  skipped: boolean
  derived: boolean
  /**
   * Whether this night is eating an earlier night's cooking rather than its own.
   *
   * False once the night it pointed at has gone, even though the column still
   * names it: a night with nothing to be left over from cooks for itself, and
   * this is the same call derive makes when it decides who is doing the buying.
   */
  leftover: boolean
  /**
   * The night it is left over from, when that night is still on the plan.
   *
   * Null on a normal night, and also on a leftovers night whose source has been
   * deleted or has not synced to this device yet — which is why the row keeps
   * its own copy of the recipe as well.
   */
  leftoverSource: { entry: PlanEntryRow, recipe: RecipeRow | null } | null
}

export interface PlannedNight {
  date: string
  entries: PlannedEntry[]
}

const DINNER = 'dinner'

// Re-exported so callers keep asking the plan about the plan's own rules, while
// the rule itself lives next to the code that has to enforce it on a drop.
export { LEFTOVER_MAX_AGE_DAYS } from '../utils/plan-move'

/**
 * What a night calls itself, in one place because four surfaces ask.
 *
 * A leftovers night names the dish it is left over from, preferring the source
 * night's recipe over its own copy — so editing Sunday's dinner renames Monday
 * with nothing written to Monday's row.
 *
 * A skipped night names the reason instead. There is no dish to fall back to,
 * and "Recipe deleted" on a night that never had one would be a lie.
 */
export function dishLabel(planned: PlannedEntry): string {
  if (planned.skipped) return skipLabel(planned.entry.skip_reason)
  const name = planned.leftoverSource?.recipe?.name ?? planned.recipe?.name ?? 'Recipe deleted'
  return planned.leftover ? `Leftovers · ${name}` : name
}

export const usePlanStore = defineStore('plan', () => {
  const sync = useSyncStore()
  const recipesStore = useRecipesStore()
  const list = useListStore()
  const ingredients = useIngredientsStore()
  const pantry = usePantryStore()
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

  /**
   * The night a leftovers entry points at, when this device can see it.
   *
   * Tolerant of a dangling reference on purpose: there is no foreign key behind
   * this column, because a self-reference the sync layer could reject would cost
   * a device its row. A source that is deleted, or simply has not arrived yet,
   * reads as null and the entry falls back to its own copy of the recipe.
   */
  function leftoverSourceOf(entry: PlanEntryRow): PlannedEntry['leftoverSource'] {
    if (!entry.leftover_of_entry_id) return null
    const source = allEntries.value.get(entry.leftover_of_entry_id)
    if (!source || source.deleted_at) return null
    return { entry: source, recipe: recipeOf(source) }
  }

  /** A row's recipe, which a skipped night has not got. */
  function recipeOf(entry: PlanEntryRow): RecipeRow | null {
    return entry.recipe_id ? recipesStore.recipeById(entry.recipe_id) ?? null : null
  }

  /** The one join from a stored row to the shape every view renders. */
  function plannedEntry(entry: PlanEntryRow): PlannedEntry {
    const leftoverSource = leftoverSourceOf(entry)
    return {
      entry,
      recipe: recipeOf(entry),
      skipped: !entry.recipe_id,
      derived: derivedEntryIds.value.has(entry.id),
      leftover: !!leftoverSource,
      leftoverSource
    }
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
      entries: entriesOn(date).map(plannedEntry)
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

  /** Returns the row it wrote, so a caller chaining a leftovers night can point at it. */
  async function addEntry(date: string, recipeId: string, servings?: number, leftoverOf?: string) {
    if (!sync.householdId) return null
    const recipe = recipesStore.recipeById(recipeId)
    if (!recipe) return null
    const timestamp = nowIso()
    const row: PlanEntryRow = {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      date,
      meal: DINNER,
      recipe_id: recipeId,
      servings: servings ?? recipe.base_servings,
      note: null,
      // Both null until somebody says otherwise. The board reads a null eat_time
      // as the household's default hour rather than as a missing plan.
      cook_person_id: null,
      eat_time: null,
      leftover_of_entry_id: leftoverOf ?? null,
      skip_reason: null,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    }
    await sync.commit('meal_plan_entries', row)
    return row
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
    const replaced = entriesOn(date)
    for (const existing of replaced) {
      await sync.commit('meal_plan_entries', { ...plainCopy(existing), deleted_at: nowIso() })
    }
    const row = await addEntry(date, recipeId, servings)

    // Swapping a night replaces its row rather than editing it, so any night
    // eating its leftovers has to be walked over to the new one. Left alone,
    // Tuesday would still say "Leftovers · " the dish that is no longer cooked
    // on Monday, and nothing would buy for it.
    if (row) {
      const replacedIds = new Set(replaced.map(entry => entry.id))
      for (const child of liveEntries.value) {
        if (!child.leftover_of_entry_id || !replacedIds.has(child.leftover_of_entry_id)) continue
        await sync.commit('meal_plan_entries', {
          ...plainCopy(child),
          recipe_id: row.recipe_id,
          leftover_of_entry_id: row.id,
          updated_at: nowIso()
        })
      }
    }

    return row
  }

  /**
   * Plan a night as one nobody is cooking on — a takeaway, a meal out.
   *
   * Replaces whatever was there, exactly as setNight and setLeftovers do: not
   * cooking is a thing the night *is*, not a note alongside a dinner.
   *
   * The row keeps a servings count because the column is not null and because it
   * is still true — that many people are eating, whoever cooks it. Nothing reads
   * it: a night with no recipe has no ingredients to scale.
   */
  async function skipNight(date: string, reason: string) {
    if (!sync.householdId) return null

    for (const existing of entriesOn(date)) {
      await sync.commit('meal_plan_entries', { ...plainCopy(existing), deleted_at: nowIso() })
    }

    const timestamp = nowIso()
    const row: PlanEntryRow = {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      date,
      meal: DINNER,
      // The marker. Everything downstream — the list, the pantry, the generator,
      // the board — asks whether there is a recipe, not whether there is a flag.
      recipe_id: null,
      servings: eatersOn(date) || 1,
      note: null,
      cook_person_id: null,
      eat_time: null,
      leftover_of_entry_id: null,
      skip_reason: reason,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    }
    await sync.commit('meal_plan_entries', row)
    return row
  }

  /** How many people are eating a given night, babies excepted. */
  function eatersOn(date: string): number {
    return attendance.presentOn(date)
      .filter(person => deriveLifeStage(person.date_of_birth, date) !== 'baby')
      .length
  }

  /** The nights this one could reasonably be leftovers of, most recent first. */
  function leftoverSourcesFor(date: string): PlannedEntry[] {
    const sources: PlannedEntry[] = []
    const [year, month, day] = date.split('-').map(Number)
    const night = new Date(year!, month! - 1, day!)
    for (let back = 1; back <= LEFTOVER_MAX_AGE_DAYS; back++) {
      for (const entry of entriesOn(isoDate(addDays(night, -back)))) {
        // Leftovers of leftovers is the same food twice removed, and the chain
        // it would create has no answer for what happens when the middle night
        // is deleted. Point at the night it was cooked on.
        if (entry.leftover_of_entry_id) continue
        // Nothing was cooked on a takeaway night, so there is nothing left of it.
        if (!entry.recipe_id) continue
        sources.push(plannedEntry(entry))
      }
    }
    return sources
  }

  /**
   * Eat an earlier night's cooking again.
   *
   * Replaces whatever was on this night, exactly as setNight does — leftovers is
   * a thing the night *is*, not something added alongside dinner.
   *
   * The recipe is copied onto the new row rather than left implicit. It is what
   * the night still shows if the source is deleted later, and it costs nothing:
   * every view prefers the source's recipe while the source is there.
   */
  async function setLeftovers(date: string, sourceEntryId: string) {
    const source = allEntries.value.get(sourceEntryId)
    if (!source || source.deleted_at || source.leftover_of_entry_id || !source.recipe_id) return null
    if (!leftoverSourcesFor(date).some(planned => planned.entry.id === sourceEntryId)) return null

    for (const existing of entriesOn(date)) {
      await sync.commit('meal_plan_entries', { ...plainCopy(existing), deleted_at: nowIso() })
    }
    return addEntry(date, source.recipe_id, eatersOn(date) || source.servings, sourceEntryId)
  }

  /**
   * Move a night onto another night, swapping with whatever is already there.
   *
   * The whole rearrangement is worked out first and committed second, so a drop
   * that touches three rows — the two nights and a leftovers night whose claim
   * it broke — reaches the queue as one coherent set rather than as a week that
   * is briefly wrong.
   */
  async function moveEntry(entryId: string, toDate: string) {
    const rows = planMove([...allEntries.value.values()], entryId, toDate, nowIso())
    for (const row of rows) await sync.commit('meal_plan_entries', row)
    return rows.length > 0
  }

  async function updateEntry(
    id: string,
    patch: Partial<
      Pick<PlanEntryRow, 'recipe_id' | 'servings' | 'note' | 'date' | 'cook_person_id' | 'eat_time'>
    >
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
  /**
   * Everything the generator needs to think about a week.
   *
   * Shared by filling a week and by suggesting one night, so the panel that
   * offers a meal and the button that plans seven can never disagree about
   * what is allowed: same library, same allergies, same history, same week.
   */
  function generatorInput(dates: string[]): GenerateInput {
    const alreadyPlanned: { date: string, recipe_id: string }[] = []
    for (const date of dates) {
      for (const entry of entriesOn(date)) {
        // A skipped night takes its date off the table without taking any recipe
        // with it — there is nothing on it to avoid repeating or to share
        // ingredients with.
        if (!entry.recipe_id) continue
        alreadyPlanned.push({ date, recipe_id: entry.recipe_id })
      }
    }

    return {
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
        .filter(entry => entry.date < dates[0]! && !!entry.recipe_id)
        .map(entry => ({ date: entry.date, recipe_id: entry.recipe_id! })),
      alreadyPlanned
    }
  }

  /**
   * The best meals for each of a week's empty nights, without planning any of them.
   *
   * The same scoring "Fill the empty nights" uses, stopped one step short of the
   * weighted draw — so a suggestion is never something the generator would have
   * refused, and accepting one is a person making the choice the generator would
   * otherwise have made for them.
   *
   * One context for the whole week, both because it is the expensive part and
   * because it is the honest scope: what is already planned is off the table,
   * and its ingredients are worth sharing. Nights nobody is eating on are absent
   * rather than empty — they are not short of ideas, they are a night off.
   *
   * The same recipe may be offered on two different nights. Whichever is
   * accepted first takes it off the other, on the next recompute.
   */
  function weekSuggestions(weekStart: string, limit = 3): Map<string, RankedCandidate[]> {
    const input = generatorInput(weekDatesFrom(weekStart))
    const context = buildContext(input)
    const today = todayIso()
    const byDate = new Map<string, RankedCandidate[]>()
    for (const night of input.nights) {
      // A night that has been and gone is not short of ideas. Offering Monday a
      // dinner on Friday is the panel asking for a decision nobody can make.
      if (night.date < today) continue
      if (entriesOn(night.date).length || !eaters(night.people).length) continue
      byDate.set(night.date, topCandidates(context, night, limit))
    }
    return byDate
  }

  /** How many times a recipe has been cooked before today. The "nobody complains" number. */
  function timesCooked(recipeId: string, before: string): number {
    return liveEntries.value.filter(
      entry => entry.recipe_id === recipeId && entry.date < before && !entry.leftover_of_entry_id
    ).length
  }

  async function fillWeek(weekStart: string) {
    if (!sync.householdId) return { filled: 0, skipped: 0 }

    const dates = weekDatesFrom(weekStart)
    const today = todayIso()
    const planned = new Set(dates.filter(date => entriesOn(date).length))

    // The whole week goes in and only the nights still ahead come out to be
    // planned: what was eaten on Monday still counts against repeats and towards
    // ingredient overlap, but Monday itself is not a gap Friday can fill.
    const input = generatorInput(dates)
    const picks = generateWeek({
      ...input,
      nights: input.nights.filter(night => night.date >= today)
    })

    // In date order, because a leftovers night names the night it came from by
    // date and the entry that date will become does not exist until it is
    // written. Sorting here rather than trusting the generator keeps the two
    // from having to agree about anything but the dates themselves.
    const created = new Map<string, string>()
    for (const pick of [...picks].sort((a, b) => a.date.localeCompare(b.date))) {
      const leftoverOf = pick.leftoverOfDate ? created.get(pick.leftoverOfDate) : undefined
      // A leftovers pick whose source never got written has nothing to be left
      // over from, and a night claiming to be leftovers of nothing is worse than
      // an empty one.
      if (pick.leftoverOfDate && !leftoverOf) continue
      const row = await addEntry(pick.date, pick.recipeId, pick.servings, leftoverOf)
      if (row) created.set(pick.date, row.id)
    }

    // A night is only "skipped" if somebody was eating and nothing could be
    // found — an empty night nobody is home for is the right plan, not a gap.
    const skipped = dates.filter(date =>
      date >= today
      && !planned.has(date)
      && !picks.some(pick => pick.date === date)
      && attendance.presentOn(date).some(person => deriveLifeStage(person.date_of_birth, date) !== 'baby')
    ).length

    return { filled: picks.length, skipped }
  }

  /** Whether there is an empty night still ahead this week that somebody is eating on. */
  function hasGapsFor(weekStart: string): boolean {
    const today = todayIso()
    return weekDatesFrom(weekStart).some(date =>
      date >= today
      && !entriesOn(date).length
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
   *
   * The pantry rides along here rather than in a pass of its own, because it is
   * answering the same question the list is: given these nights, what does the
   * household actually have to buy. Settling first matters — a night that has
   * been and gone must come off the shelf before the week ahead is told what is
   * left, or it would be offered food that has already been eaten.
   */
  /**
   * The one place a recipe line becomes a canonical ingredient, shared by the
   * list and the pantry reservations so the two can never disagree about what a
   * line means.
   */
  function resolveIngredientId(line: RecipeIngredientRow) {
    return ingredients.ingredientById(line.ingredient_id)?.id
      ?? ingredients.resolveTidied(line.name)?.id
      ?? null
  }

  /** What deriving a week would work on, assembled once for both the preview and the write. */
  function deriveInput(weekStart: string, householdId: string): DeriveInput {
    const [year, month, day] = weekStart.split('-').map(Number)
    const monday = new Date(year!, month! - 1, day!)

    const planItems: ItemRow[] = []
    for (const item of sync.rowsOf('shopping_list_items').values()) {
      if (item.source === 'plan') planItems.push(item)
    }

    return {
      householdId,
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
      resolveIngredientId,
      ingredientAisle: id => (id ? ingredients.ingredientById(id)?.aisle_id ?? null : null),
      now: nowIso()
    }
  }

  /**
   * What pressing "add to the list" would do, without doing any of it.
   *
   * So the button can say how many items it is about to add rather than
   * promising something vague and reporting afterwards. Runs the same pure
   * derivation and throws the rows away — deliberately without settling the
   * pantry first, because a preview must not write.
   */
  function derivePreview(weekStart: string) {
    if (!sync.householdId) return { added: 0, updated: 0, removed: 0 }
    const { creates, updates, removes } = derive(deriveInput(weekStart, sync.householdId))
    return { added: creates.length, updated: updates.length, removed: removes.length }
  }

  async function deriveWeek(weekStart: string) {
    if (!sync.householdId) return { added: 0, updated: 0, removed: 0 }

    await pantry.settleDue()

    const input = deriveInput(weekStart, sync.householdId)
    const { start, end } = input
    const { creates, updates, removes } = derive(input)

    for (const row of [...creates, ...updates, ...removes]) {
      await sync.commit('shopping_list_items', row)
    }

    // Which of the week's ingredients the cupboard is now on the hook for. Keyed
    // per (night, ingredient), so pressing this button again rewrites the same
    // rows instead of spending the same stock twice.
    const { upserts, releases } = derivePantryReservations({
      householdId: sync.householdId,
      start,
      end,
      entries: [...allEntries.value.values()],
      recipes: sync.rowsOf('recipes'),
      ingredients: [...sync.rowsOf('recipe_ingredients').values()],
      reservations: pantry.reservations,
      resolveIngredientId,
      baseUnitOf: id => asBaseUnit(ingredients.ingredientById(id)?.base_unit ?? 'count'),
      purchaseUnitsOf: id => ingredients.purchaseUnitsFor(id),
      now: nowIso()
    })

    for (const row of [...upserts, ...releases]) {
      await sync.commit('pantry_reservations', row)
    }

    return { added: creates.length, updated: updates.length, removed: removes.length }
  }

  return {
    liveEntries,
    week,
    entriesOn,
    plannedEntry,
    leftoverSourcesFor,
    isDerived,
    hasWorkFor,
    addEntry,
    setNight,
    setLeftovers,
    skipNight,
    moveEntry,
    updateEntry,
    removeEntry,
    clearNight,
    fillWeek,
    hasGapsFor,
    weekSuggestions,
    timesCooked,
    derivePreview,
    deriveWeek
  }
})
