import { usePlanStore } from '../stores/plan'
import { isMeal, type Meal } from '../utils/meal'

/**
 * Dragging a dish onto a slot — or off the plan altogether.
 *
 * Hand-rolled on pointer events, and deliberately not on HTML5 drag-and-drop:
 * `dragstart` never fires on a touchscreen, and the kitchen tablet is the device
 * most likely to be used for rearranging a week. One pointer API covers mouse,
 * pen and finger, so there is one code path and no second implementation that
 * only one of the three exercises. Nuxt UI has no component for this — see the
 * card-and-row exception in CLAUDE.md, of which this is the moving version.
 *
 * State lives at module scope rather than in a store: exactly one drag can be in
 * flight at a time on one device, it is worth nothing the moment the finger
 * lifts, and it must never reach Dexie or the sync queue.
 *
 * How a drag starts depends on what started it, because the two inputs disagree
 * about what a press means:
 *
 *  - A mouse or a pen picks up as soon as it has moved a few pixels. Nothing
 *    else on the card wants that gesture, and requiring a hold to drag with a
 *    mouse feels broken.
 *  - A finger has to hold still for a moment first. The plan is a scrolling
 *    column on a phone, and a card that grabbed every downward swipe would make
 *    the page impossible to read. The hold is what distinguishes "move this"
 *    from "scroll past this", and it cancels the moment the finger travels far
 *    enough to have meant scrolling.
 */

/** What is being dragged: a slot already on the plan, or a meal being offered. */
export type DragPayload
  = | { kind: 'night', entryId: string, date: string, meal: Meal, label: string, image: string | null }
    | { kind: 'suggestion', recipeId: string, label: string, image: string | null }

/**
 * A slot, as one string: `2026-08-11|lunch`.
 *
 * Targets are keyed by slot rather than by date because a day is three cells
 * now. Three cells registering under one bare date would overwrite each other in
 * the map, and only whichever mounted last would be findable — a week where
 * dropping on Tuesday lunch quietly did nothing.
 */
export type SlotKey = string

export function slotKey(date: string, meal: Meal): SlotKey {
  return `${date}|${meal}`
}

/**
 * The shortlist, as somewhere a dish can be dropped: not a slot, and the one
 * target that takes something off the plan rather than putting it somewhere.
 *
 * Dragging a dinner out of the week and onto the panel that offered it is the
 * gesture people reach for — it is where the dish came from, and it is where it
 * reappears, because the shortlist is exactly the recipes the week has not
 * claimed. So the drop is a delete and the panel is the bin, without either word
 * appearing anywhere.
 *
 * It carries no `|`, so `parseSlot` refuses it and nothing downstream can
 * mistake it for a date.
 */
export const SHORTLIST_SLOT: SlotKey = 'shortlist'

function parseSlot(key: SlotKey): { date: string, meal: Meal } | null {
  const [date, meal] = key.split('|')
  return date && meal && isMeal(meal) ? { date, meal } : null
}

interface DropTarget {
  key: SlotKey
  el: HTMLElement
}

/** How long a finger holds still before the card is picked up. */
const HOLD_MS = 260

/** How far a finger may drift during that hold before it counts as a scroll. */
const HOLD_SLOP = 10

/** How far a mouse moves before a press becomes a drag rather than a click. */
const MOUSE_SLOP = 4

/** How close to an edge the pointer gets before the list scrolls itself. */
const EDGE = 64
const EDGE_SPEED = 14

const payload = shallowRef<DragPayload | null>(null)
const overSlot = ref<SlotKey | null>(null)
const pointer = ref({ x: 0, y: 0 })
const targets = new Map<SlotKey, DropTarget>()

export function usePlanDrag() {
  const plan = usePlanStore()

  /**
   * Register a slot as somewhere a drag can land.
   *
   * Elements rather than rectangles, because both shapes of this page scroll
   * while a drag is in flight and a rectangle measured at pick-up would be
   * pointing at the wrong night by the time the finger got there.
   */
  function registerTarget(key: SlotKey, el: HTMLElement | null) {
    if (el) targets.set(key, { key, el })
    else targets.delete(key)
  }

  /**
   * Whether what is in hand can land here.
   *
   * Every slot takes everything. A recipe being offered goes wherever it is
   * dropped, and so does a dish already on the plan — Tuesday's dinner onto
   * Thursday's lunch is a thing households do, and `planMove` rewrites the row's
   * `meal` with its date so it arrives calling itself what the column says.
   * (It did not, once, which is why this used to refuse.)
   *
   * The shortlist is the one target that discriminates: dropping a dish there
   * takes it off the plan, and there is nothing for a suggestion to be taken off
   * of. Refused in the hit test rather than at the drop, so the panel never
   * lights up and the answer reads as "not there" rather than as a drop that did
   * nothing.
   */
  function landable(key: SlotKey): boolean {
    const dragged = payload.value
    if (!dragged) return false
    if (key === SHORTLIST_SLOT) return dragged.kind === 'night'
    return true
  }

  function hitTest(x: number, y: number): SlotKey | null {
    for (const target of targets.values()) {
      const box = target.el.getBoundingClientRect()
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue
      return landable(target.key) ? target.key : null
    }
    return null
  }

  /** The scrolling box the pointer is inside, so a drag can reach off-screen nights. */
  function scrollerAt(x: number, y: number): HTMLElement | null {
    let node = document.elementFromPoint(x, y) as HTMLElement | null
    while (node) {
      const style = getComputedStyle(node)
      const scrolls = /auto|scroll/.test(style.overflowY)
      if (scrolls && node.scrollHeight > node.clientHeight + 1) return node
      node = node.parentElement
    }
    return null
  }

  function autoScroll(x: number, y: number) {
    const scroller = scrollerAt(x, y)
    if (!scroller) return
    const box = scroller.getBoundingClientRect()
    if (y - box.top < EDGE) scroller.scrollTop -= EDGE_SPEED
    else if (box.bottom - y < EDGE) scroller.scrollTop += EDGE_SPEED
  }

  async function drop(key: SlotKey) {
    const dragged = payload.value
    if (!dragged) return

    /**
     * Onto the shortlist: off the plan.
     *
     * Silent, like every other drop, and like everything else the plan page
     * does to a night — see the note on `pick` in plan.vue. A drag is the most
     * deliberate gesture the app has: you picked the dish up, carried it to the
     * panel and let go, watching the card leave the night and land back in the
     * shortlist. A toast repeating that is the app narrating a press somebody
     * just made and watched land, and a week of rearranging is a column of
     * them. Toasts are kept for what happens out of sight — filling a week,
     * clearing one, putting it on the list.
     *
     * This used to carry a "Put it back" undo, which is what it really cost:
     * `restoreEntry` un-deletes the row, so it put back the night that was
     * there — its day, its slot, its servings, anything eating its leftovers —
     * where dragging the dish out of the shortlist again plans a fresh one. The
     * dish is back where it came from either way, which is the ordinary way
     * back and the one that needs no button.
     */
    if (key === SHORTLIST_SLOT) {
      if (dragged.kind !== 'night') return
      await plan.removeEntry(dragged.entryId)
      return
    }

    const slot = parseSlot(key)
    if (!slot) return
    const { date, meal } = slot

    if (dragged.kind === 'suggestion') {
      // Also silent: the empty slot becomes the dish, which is the same thing
      // the toast was going to say, a beat later and over the top of it.
      await plan.setNight(date, dragged.recipeId, meal)
      return
    }

    if (dragged.date === date && dragged.meal === meal) return
    // Swapping is the store's business; what matters here is that a drop on a
    // slot never deletes anything, so there is nothing to warn about and nothing
    // to undo. Only the shortlist above does that.
    await plan.moveEntry(dragged.entryId, date, meal)
  }

  /**
   * Begin tracking a press. Returns nothing: whether it becomes a drag is
   * decided by what the pointer does next, not by this call.
   */
  function press(event: PointerEvent, next: DragPayload) {
    // Only the primary button, and never a press that started on a control that
    // has opted out: the remove cross and "Use Fri" sit inside things that drag,
    // and a press on one of them means the thing it says, not "move this".
    // Marked in the templates rather than matched on `button` here, because the
    // dish itself is a button — the whole card is its tap target.
    if (event.button !== 0) return
    if ((event.target as HTMLElement | null)?.closest('[data-no-drag]')) return

    const el = event.currentTarget as HTMLElement
    const touch = event.pointerType === 'touch'
    const startX = event.clientX
    const startY = event.clientY
    let holdTimer: ReturnType<typeof setTimeout> | null = null
    let dragging = false

    /**
     * Stop the page scrolling under a finger that is holding a card.
     *
     * `preventDefault` on a pointer event does not do this — the pan is a
     * separate gesture the browser owns, and `touchmove` is where it can still
     * be refused. It has to be non-passive to be refusable, and it is only ever
     * attached after a deliberate pick-up, so ordinary scrolling never meets it.
     */
    function blockScroll(scrollEvent: TouchEvent) {
      if (scrollEvent.cancelable) scrollEvent.preventDefault()
    }

    function begin() {
      dragging = true
      payload.value = next
      pointer.value = { x: startX, y: startY }
      overSlot.value = hitTest(startX, startY)
      // Captured so the drag survives the pointer leaving the card, which it
      // does immediately — the whole point is to be somewhere else.
      el.setPointerCapture(event.pointerId)
      if (touch) document.addEventListener('touchmove', blockScroll, { passive: false })
    }

    function move(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY

      if (!dragging) {
        const travelled = Math.hypot(dx, dy)
        if (touch) {
          // The finger moved before the hold completed: this was a scroll.
          if (travelled > HOLD_SLOP) cancel()
          return
        }
        if (travelled < MOUSE_SLOP) return
        begin()
      }

      // Stops the drag turning into a text selection on a desktop.
      moveEvent.preventDefault()
      pointer.value = { x: moveEvent.clientX, y: moveEvent.clientY }
      overSlot.value = hitTest(moveEvent.clientX, moveEvent.clientY)
      autoScroll(moveEvent.clientX, moveEvent.clientY)
    }

    async function up(upEvent: PointerEvent) {
      const landedOn = dragging ? hitTest(upEvent.clientX, upEvent.clientY) : null
      // The press that dragged a card must not also open it. The click arrives
      // after pointerup, so it is swallowed once, in the capture phase, before
      // it reaches the card underneath.
      //
      // And disarmed on the next task whether or not it fired, because there are
      // drops after which no click ever arrives: dropping a dish on the
      // shortlist deletes the card the pointer was captured by, and a browser
      // does not dispatch a click at an element that has left the document. Left
      // armed, the listener would sit there and eat the next press anywhere on
      // the page — the "Put it back" in the toast this very drop just raised.
      // A click follows mouseup within the same task, so a zero timeout is after
      // the one it is meant to catch and before anything a person could do next.
      if (dragging) {
        document.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0)
      }
      cleanup()
      if (landedOn) await drop(landedOn)
      payload.value = null
      overSlot.value = null
    }

    function swallow(clickEvent: MouseEvent) {
      clickEvent.stopPropagation()
      clickEvent.preventDefault()
    }

    function cancel() {
      cleanup()
      payload.value = null
      overSlot.value = null
    }

    function cleanup() {
      if (holdTimer) clearTimeout(holdTimer)
      holdTimer = null
      dragging = false
      if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      document.removeEventListener('touchmove', blockScroll)
    }

    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)

    // A finger has to hold still; a mouse only has to move. Nothing happens
    // here for a mouse — `move` decides, on the first few pixels of travel.
    if (touch) holdTimer = setTimeout(begin, HOLD_MS)
  }

  return {
    /** What is in hand, or null. Every visual cue reads this. */
    payload: readonly(payload),
    /** The slot under the pointer, so it can light up — null when it would refuse the drop. */
    overSlot: readonly(overSlot),
    /** Where the pointer is, for the thing following it. */
    pointer: readonly(pointer),
    dragging: computed(() => payload.value !== null),
    registerTarget,
    slotKey,
    /** The shortlist's key, for the panel that registers itself as the way off the plan. */
    shortlistSlot: SHORTLIST_SLOT,
    press
  }
}
