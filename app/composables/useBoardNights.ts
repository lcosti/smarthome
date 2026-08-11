import { useAttendanceStore } from '../stores/attendance'
import { dishLabel, usePlanStore } from '../stores/plan'
import type { BoardNight } from '../utils/board'
import { LEFTOVER_REHEAT_MINUTES } from '../utils/board'
import { pictureOf } from '../utils/photo'
import { defaultCook } from '../utils/plan-cook'
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
  const attendance = useAttendanceStore()

  return computed<BoardNight[]>(() =>
    Array.from({ length: count }, (_, offset) => {
      const date = isoDate(addDays(now.value, offset))
      const first = plan.entriesOn(date)[0]
      if (!first) {
        return { date, presentIds: attendance.presentOn(date).map(person => person.id), meal: null }
      }

      const planned = plan.plannedEntry(first)
      // A leftovers night shows the source's recipe, so its picture and its
      // dish name follow whatever that night is now — and its timing does not,
      // because reheating is not cooking.
      const recipe = planned.leftoverSource?.recipe ?? planned.recipe
      const { entry } = planned
      const present = attendance.presentOn(date)

      // The same rule the plan reads: an explicit cook, or the sole adult at
      // the table (plan-cook.ts). Not on a skipped or leftovers night — nobody
      // is at the stove, and the board would say "Amy cooks" over "reheat".
      const cookPersonId = entry.cook_person_id
        ?? (planned.skipped || planned.leftover ? null : defaultCook(present, date)?.id ?? null)

      return {
        date,
        presentIds: present.map(person => person.id),
        meal: {
          entryId: entry.id,
          recipeId: entry.recipe_id,
          dish: dishLabel(planned),
          image: pictureOf(recipe),
          minutes: planned.leftover
            ? LEFTOVER_REHEAT_MINUTES
            : (recipe?.prep_minutes ?? 0) + (recipe?.cook_minutes ?? 0) || null,
          servings: entry.servings,
          note: entry.note,
          eatTime: entry.eat_time,
          cookPersonId,
          updatedAt: entry.updated_at,
          leftover: planned.leftover
        }
      }
    })
  )
}
