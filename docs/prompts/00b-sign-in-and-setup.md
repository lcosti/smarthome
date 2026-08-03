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

**Use whatever sign-in your platform already provides.** This app has four users
and no security requirements beyond keeping strangers out of the shopping list;
building an auth flow by hand would be effort spent on the least interesting part
of it.

Only three things about it actually matter, and they are all about *not* getting
in the way:

1. **The session persists indefinitely on a device.** The kitchen tablet is
   signed in once and never again. A sign-in that expires weekly is a sign-in
   that gets abandoned.
2. **No sign-in prompt on a device that has already been set up.** The gate is
   "has this device ever been set up", not "is the credential valid right now" —
   see §5. Reads come from what the device already has.
3. **The account is not the person.** See below; this is the one that platform
   auth will fight, because it wants a row per user and this household contains
   two people who cannot type.

The screen itself is centred, max-width 384px. Title "Shopping List", subtitle
"Sign in once. This device stays signed in."

The reference implementation uses an emailed sign-in link — one email field, one
full-width button reading "Email me a link", and on success the form is replaced
by "Check your email — We sent a sign-in link to `<address>`. Open it on this
device." Match that if it is free; otherwise use what you have and say which.

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
