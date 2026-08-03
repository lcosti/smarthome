# Step 0 — signing in and setting up a household

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build this FIRST, before anything else. Until it exists there is no household,
so every other screen has nothing to attach its records to.

Two one-way flows, both without any app navigation — no tab bar, no header. A
person is either signing in or setting up, and offering them three other places
to go is three ways to get lost.

---

### 6.1 `/login`

Centred, max-width 384px. Title "Shopping List", subtitle "Sign in once. This
device stays signed in." One email field and one full-width button, "Email me a
link". On success, replace the form with an alert: "Check your email — We sent a
sign-in link to `<address>`. Open it on this device."

Magic link only. No passwords.

### 6.2 `/welcome`

Title "Set up your household", subtitle "Create one, or join the one that already
exists." Two tabs: **Create** / **Join**.

- **Create**: "Household name" (placeholder `The Costis`) + "Your name".
- **Join**: "Invite code", with help text "Six characters, from the settings
  screen on the other phone.", monospace and uppercased + "Your name".

Submit navigates to `/` immediately and starts the first sync **without
awaiting it** — the first sync of a new household takes a moment, and navigating
when it resolves drags anyone who tapped through to Recipes back to the list under
their thumb.
