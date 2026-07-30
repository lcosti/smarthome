/**
 * Calendar dates for the weekly plan, as 'YYYY-MM-DD' strings.
 *
 * Everything here works in local time. `Date.toISOString()` is deliberately
 * never used to produce a date key: it converts to UTC first, so planning
 * dinner at 11pm in British Summer Time would file it under tomorrow.
 *
 * Weeks start on Monday, which is how a shop is planned.
 */

/** The local calendar date of an instant, not its UTC date. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function todayIso(): string {
  return isoDate(new Date())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Midnight on the Monday of the week containing `date`. */
export function mondayOf(date: Date): Date {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  // getDay() is 0 for Sunday, which belongs to the week that started six days ago.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday
}

/** The seven date keys of the week starting at `monday`. */
export function weekDates(monday: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => isoDate(addDays(monday, i)))
}

/** "Mon 4 Aug" — the day of the week matters more than the number, so it leads. */
export function dayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "4 – 10 Aug", or "28 Jul – 3 Aug" when the week straddles two months. */
export function weekLabel(monday: Date): string {
  const sunday = addDays(monday, 6)
  const dayOnly = new Intl.DateTimeFormat(undefined, { day: 'numeric' })
  const dayAndMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  const start = monday.getMonth() === sunday.getMonth()
    ? dayOnly.format(monday)
    : dayAndMonth.format(monday)
  return `${start} – ${dayAndMonth.format(sunday)}`
}
