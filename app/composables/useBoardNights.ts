import { useAttendanceStore } from '../stores/attendance'
import { usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import type { BoardNight } from '../utils/board'
import { addDays, isoDate } from '../utils/week'

/**
 * The nights the board reasons about, joined to their recipes.
 *
 * Shared because two views need the same shape for different reasons: the shell
 * reads the meals to say when the plan was last generated, and Today reads all
 * of it. Building it in one place keeps them from drifting apart over what a
 * night is.
 *
 * Eight, starting tonight: enough for the hero to flip to tomorrow late in the
 * evening and still have six days of week strip after it.
 */
export function useBoardNights(now: Ref<Date>, count = 8) {
  const plan = usePlanStore()
  const recipes = useRecipesStore()
  const attendance = useAttendanceStore()

  return computed<BoardNight[]>(() =>
    Array.from({ length: count }, (_, offset) => {
      const date = isoDate(addDays(now.value, offset))
      const entry = plan.entriesOn(date)[0]
      const recipe = entry ? recipes.recipeById(entry.recipe_id) : undefined
      return {
        date,
        presentIds: attendance.presentOn(date).map(person => person.id),
        meal: entry
          ? {
              entryId: entry.id,
              recipeId: entry.recipe_id,
              dish: recipe?.name ?? 'Recipe deleted',
              image: recipe?.image_url ?? null,
              minutes: (recipe?.prep_minutes ?? 0) + (recipe?.cook_minutes ?? 0) || null,
              servings: entry.servings,
              note: entry.note,
              eatTime: entry.eat_time,
              cookPersonId: entry.cook_person_id,
              updatedAt: entry.updated_at
            }
          : null
      }
    })
  )
}
