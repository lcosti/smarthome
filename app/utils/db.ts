import Dexie, { type Table } from 'dexie'
import type { Database } from '../../shared/types/database.types'

export type ItemRow = Database['public']['Tables']['shopping_list_items']['Row']
export type AisleRow = Database['public']['Tables']['aisles']['Row']
export type SyncedRow = ItemRow | AisleRow
export type SyncTable = 'shopping_list_items' | 'aisles'

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
  mutations!: Table<Mutation, number>

  constructor(name = 'shoplist') {
    super(name)
    this.version(1).stores({
      items: 'id',
      aisles: 'id',
      mutations: '++seq, rowId'
    })
  }
}

export const db = new AppDatabase()
