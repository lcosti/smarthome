import { useListStore } from '../stores/list'
import { usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { useSyncStore } from '../stores/sync'
import { buildRecipeLibrary, type LibraryDetail } from '../utils/board'

/**
 * One recipe, as something to choose between meals with.
 *
 * The wide library's right-hand pane and the phone's drawer are the same
 * reading — what it is, how heavy it is, what it needs that you haven't got,
 * when you last cooked it — so they are the same model, built by the same
 * function. Two widths of the same answer, not two answers.
 *
 * Deliberately the whole builder rather than a `buildRecipeDetail` beside it:
 * the figures a detail is made of — last cooked, what's missing, what the
 * cupboard already covers — fall out of the pass that builds the cards, and
 * splitting them would put a second copy of that arithmetic in the file the
 * first one lives in. The library is a few dozen rows of plain data.
 *
 * `buildRecipeLibrary` falls back to the first card when its selection has been
 * filtered away, which is right for a pane that must never be empty and wrong
 * for a sheet that is shut. Hence the null guard: no id means no detail.
 */
export function useRecipeDetail(recipeId: Ref<string | null>): ComputedRef<LibraryDetail | null> {
  const recipes = useRecipesStore()
  const plan = usePlanStore()
  const list = useListStore()
  const sync = useSyncStore()

  const now = useBoardClock()
  const pantryCovers = usePantryCovers()

  const lines = computed(() =>
    [...sync.rowsOf('recipe_ingredients').values()].filter(line => !line.deleted_at)
  )

  return computed(() => {
    if (!recipeId.value) return null

    return buildRecipeLibrary({
      recipes: recipes.recipes,
      lines: lines.value,
      planEntries: plan.liveEntries,
      listItems: list.liveItems,
      now: now.value,
      query: '',
      facet: 'all',
      sort: 'recent',
      selectedId: recipeId.value,
      pantryCovers: pantryCovers.value
    }).detail
  })
}

/**
 * What this recipe needs that isn't already on the list.
 *
 * Deliberately the plain add path rather than the plan's derivation: these items
 * have no plan entry behind them — somebody decided to buy for a recipe without
 * committing to a night — and giving them a provenance they don't have would put
 * them in line to be swept up when that night changed.
 */
export function useRecipeSend() {
  const list = useListStore()
  const toast = useToast()

  const sending = ref(false)

  async function send(missing: LibraryDetail['missing'] | undefined) {
    if (!missing?.length || sending.value) return
    sending.value = true
    try {
      for (const line of missing) {
        await list.addItem(line.name, { quantity: line.quantity, aisleId: line.aisleId })
      }
      toast.add({
        title: `Added ${missing.length === 1 ? '1 item' : `${missing.length} items`}`,
        color: 'success'
      })
    } finally {
      sending.value = false
    }
  }

  return { sending, send }
}
