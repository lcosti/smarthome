# Step 7 — recipe import and the other server-side work

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build the server-side functions. Finish by demonstrating acceptance test 7.

**Screenshots to attach:** `docs/screenshots/phone-recipes.png`

---

## 8. Server-side work

The client is a static bundle, so there are no server routes. Anything that needs
a server is a small isolated function.

### 8.1 Recipe import from a URL

The client cannot read another origin's HTML, so a server function fetches the
page and reads its **schema.org `Recipe` JSON-LD**, which nearly every recipe site
already publishes. **That path costs nothing: no model call, no wait.** Only a
page without it falls back to a language model.

Either way, **split the quantity off each ingredient line** so an import lands in
the same canonical ingredients a typed recipe would, and strip preparation clauses
the same way the shopping-name rules do.

Pasting the same address twice must land on the recipe it already made, not a
second copy.

### 8.2 Recipe import from photographs

A multimodal model reads one or more photographs of a cookbook page and returns
the same structured recipe shape.

### 8.3 Nutrition estimate

A model estimates the eight per-serving figures from the ingredient list. **It
fills only the blanks.**

### 8.4 Calendar sync

A scheduled job every five minutes reads the family's calendars with a **service
account** (not per-user OAuth) and upserts them into `calendar_events`. Clients
only ever *read* that table. The cache is not an optimisation — it is the only
reason the schedule card survives the wifi dropping.

Skip rows whose source last-modified stamp is unchanged; every rewrite would be
broadcast to every device over realtime, which is a lot of traffic to say nothing.

**Every run records what it did** in `calendar_sync_status`. That table exists
because absence of events used to be the only symptom, and it was the symptom of
five different things — four of which produced no log line anywhere. A missing
secret, an unconfigured calendar list, a calendar never shared with the service
account: all of them now say so on the screen instead of looking like a household
that never bothered.

Until it is configured, the job fires and does nothing, which is the right
behaviour for a household that has not connected a calendar.

### 8.5 Keepalive

If your backend pauses free projects after a period of inactivity, ping it **every
2–3 days from outside the system** — a scheduled job inside a paused database
cannot unpause it. **Do not rely on the weekly generation job for this**: a 7-day
cycle racing a 7-day timer will lose.

### 8.6 Weather

Fetched from a keyless service (Open-Meteo), for a configured latitude and
longitude, and **cached in local storage** so an offline device keeps the last
reading.

---
