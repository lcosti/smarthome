# Step 1b — the fallback, if the platform cannot store data on the device

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Send this **only** if the tool has told you it cannot keep a copy of the data on
the device. It replaces §5 and changes nothing else. Everything in steps 2 to 8
still applies exactly as written.

---

## 5b. Amendment: when the platform cannot store data on the device

**Build this instead of §5 if — and only if — your platform has told you it
cannot keep a copy of the data on the device.** Nothing else in this document
changes. Do not use this section as an easier option; §5 is the app as intended,
and this is what is left of it when the floor is lower.

### Be precise about what is lost

Exactly one thing: **durability with no signal**. Cold-opening the app in a dead
spot and still having your list.

That is a real loss and the app should say so rather than pretend. But it is a
much smaller loss than "no offline support" sounds, because it is not what most
of the feel was made of.

### Warm and cold are different problems

- **Warm** — the connection drops while the app is already open. Everything
  already on screen stays there, because it is already in the app's hands.
  **This is achievable and you should make sure it works.**
- **Cold** — the app is opened with no signal at all. There is nothing to show.
  This is the one that cannot be done.

A phone in a supermarket is usually the warm case: the app was opened in the car
park on wifi or a bar of signal, and the dead spot is in the middle of the shop.
So build for warm and be honest about cold.

### The five things that actually make it feel instant

None of these need on-device storage. Together they are most of what §5 was
buying.

1. **Every change applies to what is on screen immediately, and goes to the
   server afterwards.** Never wait for the server before updating the interface.
   A tick is instant, always.
2. **The add box clears the moment Enter is pressed.** Never disable it while a
   write is in flight, never put a spinner in it, never wait to confirm. The next
   item has to be typeable straight away — this is the single thing that decides
   whether the app beats typing into a group chat.
3. **Load once, then never show a loading state again.** The four tabs are views
   of one set of data. Moving between Today, List, Plan and Recipes must not
   re-fetch or flash a skeleton.
4. **Never put a spinner over the list after first paint.** Refreshing in the
   background is fine; making somebody watch it is not.
5. **Stay signed in.** No sign-in prompt on a device that has been set up, ever.

### When a write actually fails

This is the new failure mode, and the whole honesty of the app rests on handling
it properly.

- **Say so, and give the typing back.** If an item could not be added, put the
  text back in the box with a short message. Never swallow it.
- **A tick that failed reverts visibly**, with a message saying it did not save.
  A tick that silently un-ticks itself two seconds later is worse than one that
  never worked.
- **Never show a toast when a write succeeds.** Only failures are worth
  interrupting for.
- **An empty list and a failed load must never look the same.** This is the trap
  this amendment introduces: with no cached copy, a cold start with no signal has
  nothing to show, and the easiest thing for it to show is the "Nothing on the
  list" empty state — which is a lie, and the specific lie most likely to make
  somebody buy nothing or buy everything twice. If the first load fails, say the
  app cannot reach the server and offer to try again. Do not fall through to an
  empty state.

### Keep every data rule from §5

Soft deletes, an `updated_at` stamped when the edit is made, deterministic ids,
last-write-wins. **None of these were only for offline**, and dropping them along
with the queue is the mistake to avoid:

- **Deterministic ids** are what stop §7.5 putting the week on the list twice
  when it is run twice, and what stop a double-tapped button creating two records.
- **Soft deletes** are how a deletion made on one phone reaches the other one.
- **Last-write-wins by `updated_at`** is how two people in the same kitchen
  editing at once converge without anybody being asked to resolve anything.

They also mean that if the platform ships on-device storage later, getting to §5
is a change to how data is sent, not a rewrite of the app.

### What changes on the screens

Everything in §6 stands, with two clarifications:

- The offline badges (§6.3, §6.12) now mean **"cannot reach the server right
  now"** rather than "showing you a saved copy". The wording already works;
  only the meaning narrows.
- Today's "Last known · 15:58" badge and the removal of the now-marker are still
  right, and still testable, in the warm case — the connection dropping while
  the board is open is exactly when they matter.

### The test for this section, replacing test 1

> Open the app on a phone with signal and let the list load. **Turn the signal
> off with the app still open.** Tick five items and add two more — every one
> registers on screen instantly. Turn the signal back on. The server ends up with
> exactly what the screen showed, and nothing was lost.
>
> Then, separately: **cold-open the app with no signal.** It must say it cannot
> reach the server. It must not show an empty list.
