import Dexie, { type Table } from 'dexie'
import type { Database } from '../../shared/types/database.types'

type Tables = Database['public']['Tables']

export type ItemRow = Tables['shopping_list_items']['Row']
export type AisleRow = Tables['aisles']['Row']
export type RecipeRow = Tables['recipes']['Row']
export type RecipeIngredientRow = Tables['recipe_ingredients']['Row']
export type PlanEntryRow = Tables['meal_plan_entries']['Row']

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
 * resolve a derived item's recipe on first paint.
 */
export const SYNC_TABLES = {
  aisles: { cache: 'aisles' },
  recipes: { cache: 'recipes' },
  recipe_ingredients: { cache: 'recipe_ingredients' },
  meal_plan_entries: { cache: 'meal_plan_entries' },
  shopping_list_items: { cache: 'items' }
} as const

export type SyncTable = keyof typeof SYNC_TABLES

export const SYNC_TABLE_NAMES = Object.keys(SYNC_TABLES) as SyncTable[]

/** The row type each synced table holds, so `cacheFor` and `commit` stay typed. */
export interface RowOf {
  aisles: AisleRow
  recipes: RecipeRow
  recipe_ingredients: RecipeIngredientRow
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
  meal_plan_entries!: Table<PlanEntryRow, string>
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
  }

  /** The local cache for a synced table. */
  cacheFor<T extends SyncTable>(table: T): Table<RowOf[T], string> {
    return this.table(SYNC_TABLES[table].cache)
  }
}

export const db = new AppDatabase()
