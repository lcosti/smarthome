import Dexie, { type Table } from 'dexie'
import type { Database } from '../../shared/types/database.types'

type Tables = Database['public']['Tables']

export type ItemRow = Tables['shopping_list_items']['Row']
export type PersonRow = Tables['people']['Row']
export type DietaryConstraintRow = Tables['dietary_constraints']['Row']
export type AttendanceRow = Tables['attendance']['Row']
export type AisleRow = Tables['aisles']['Row']
export type RecipeRow = Tables['recipes']['Row']
export type RecipeIngredientRow = Tables['recipe_ingredients']['Row']
export type RecipeStepRow = Tables['recipe_steps']['Row']
export type PlanEntryRow = Tables['meal_plan_entries']['Row']
export type IngredientRow = Tables['ingredients']['Row']
export type IngredientAliasRow = Tables['ingredient_aliases']['Row']
export type PurchaseUnitRow = Tables['ingredient_purchase_units']['Row']

/**
 * Every table the offline layer syncs.
 *
 * Keys are the Postgres table names, which is what the upsert, the realtime
 * subscription and the pull all use verbatim — so adding a table here is most of
 * the work of syncing it. `cache` is the Dexie store name; `items` predates this
 * registry and keeps its original name so that no device has to migrate data.
 *
 * Order matters in one narrow way: `pull` applies rows in this order, so parents
 * land before the shopping list items that reference them and a fresh device can
 * resolve a derived item's recipe on first paint. Ingredients come early for the
 * same reason — a list item names its canonical ingredient, and the grouped line
 * cannot be worked out until that row is there. People come first of all: a
 * constraint and an attendance row are both meaningless until there is a person
 * to hang them off.
 */
export const SYNC_TABLES = {
  people: { cache: 'people' },
  dietary_constraints: { cache: 'dietary_constraints' },
  attendance: { cache: 'attendance' },
  aisles: { cache: 'aisles' },
  ingredients: { cache: 'ingredients' },
  ingredient_aliases: { cache: 'ingredient_aliases' },
  ingredient_purchase_units: { cache: 'ingredient_purchase_units' },
  recipes: { cache: 'recipes' },
  recipe_ingredients: { cache: 'recipe_ingredients' },
  recipe_steps: { cache: 'recipe_steps' },
  meal_plan_entries: { cache: 'meal_plan_entries' },
  shopping_list_items: { cache: 'items' }
} as const

export type SyncTable = keyof typeof SYNC_TABLES

export const SYNC_TABLE_NAMES = Object.keys(SYNC_TABLES) as SyncTable[]

/** The row type each synced table holds, so `cacheFor` and `commit` stay typed. */
export interface RowOf {
  people: PersonRow
  dietary_constraints: DietaryConstraintRow
  attendance: AttendanceRow
  aisles: AisleRow
  ingredients: IngredientRow
  ingredient_aliases: IngredientAliasRow
  ingredient_purchase_units: PurchaseUnitRow
  recipes: RecipeRow
  recipe_ingredients: RecipeIngredientRow
  recipe_steps: RecipeStepRow
  meal_plan_entries: PlanEntryRow
  shopping_list_items: ItemRow
}

export type SyncedRow = RowOf[SyncTable]

/**
 * One queued write. `payload` is a full row snapshot rather than a patch, which is
 * what makes draining idempotent and order-independent: replaying it twice, or
 * out of order against another device's writes, still lands on a whole valid row.
 */
export interface Mutation {
  seq?: number
  table: SyncTable
  rowId: string
  payload: SyncedRow
  ts: number
  attempts: number
}

export class AppDatabase extends Dexie {
  items!: Table<ItemRow, string>
  aisles!: Table<AisleRow, string>
  recipes!: Table<RecipeRow, string>
  recipe_ingredients!: Table<RecipeIngredientRow, string>
  recipe_steps!: Table<RecipeStepRow, string>
  meal_plan_entries!: Table<PlanEntryRow, string>
  ingredients!: Table<IngredientRow, string>
  ingredient_aliases!: Table<IngredientAliasRow, string>
  ingredient_purchase_units!: Table<PurchaseUnitRow, string>
  people!: Table<PersonRow, string>
  dietary_constraints!: Table<DietaryConstraintRow, string>
  attendance!: Table<AttendanceRow, string>
  mutations!: Table<Mutation, number>

  constructor(name = 'shoplist') {
    super(name)
    this.version(1).stores({
      items: 'id',
      aisles: 'id',
      mutations: '++seq, rowId'
    })
    // Dexie carries unchanged stores forward, so v2 declares only the new ones.
    // They start empty and nothing is being reshaped, so there is no upgrade
    // handler to write: a device on v1 opens v2 with its list intact.
    this.version(2).stores({
      recipes: 'id',
      recipe_ingredients: 'id',
      meal_plan_entries: 'id'
    })
    // v3 adds the canonical ingredient tables, on the same terms as v2. The
    // ingredient_id columns on items and recipe lines need no migration either:
    // they arrive null on existing rows and are filled in as things are touched.
    this.version(3).stores({
      ingredients: 'id',
      ingredient_aliases: 'id',
      ingredient_purchase_units: 'id'
    })
    // v4 adds the roster, on the same terms again. `people` has been read from the
    // server since Phase 1 but never cached, so this store starts empty on every
    // device and fills on the next pull.
    this.version(4).stores({
      people: 'id',
      dietary_constraints: 'id',
      attendance: 'id'
    })
    // v5 adds recipe steps, on the same terms again: a new empty store, nothing
    // reshaped. Recipes whose method the migration split server-side arrive as
    // ordinary rows on the next pull, so no device has any local work to do.
    this.version(5).stores({
      recipe_steps: 'id'
    })
  }

  /** The local cache for a synced table. */
  cacheFor<T extends SyncTable>(table: T): Table<RowOf[T], string> {
    return this.table(SYNC_TABLES[table].cache)
  }
}

export const db = new AppDatabase()
