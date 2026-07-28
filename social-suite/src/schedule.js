// The recurring posting schedule.
//
// You define slots once ("Tue 09:00, Thu 09:00, Sat 11:00"). Adding content to
// the queue drops it into the next free slot instead of you hand-picking a time
// for every post.
//
// THE HARD PART IS TIMEZONES, NOT SLOTS.
//
// A slot is a wall-clock time in your timezone: 9am Eastern. The database and
// Instagram both work in UTC. 9am Eastern is 13:00 UTC in winter and 14:00 UTC
// in summer, so converting once and storing the offset would silently drift by
// an hour twice a year. Instead every assignment converts fresh, using the
// browser-standard Intl timezone database that ships inside the Worker runtime.
// No dependency, no offset table to maintain, correct across DST by
// construction.

/**
 * Convert a wall-clock time in an IANA timezone to a UTC epoch milliseconds.
 *
 * Two-pass, because the offset depends on the instant and the instant depends
 * on the offset. Guess with the naive UTC value, measure how far off that lands
 * in the target zone, correct, then measure once more to catch the case where
 * the correction itself crossed a DST boundary.
 */
export function zonedWallTimeToUtc(year, month, day, hour, minute, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset1 = offsetAt(naive, timeZone);
  let instant = naive - offset1;
  const offset2 = offsetAt(instant, timeZone);
  instant = naive - offset2;

  // A third measurement, to catch the one case the two-pass correction above
  // does not converge on: a "spring forward" gap hour that never happens
  // locally at all (2:00-2:59 AM on the one Sunday a year US clocks jump to
  // 3:00). For a real wall-clock time, this offset always matches offset2. If
  // it does not, the requested time falls in the gap, and the two candidate
  // offsets keep bouncing between the pre- and post-transition zone instead of
  // settling -- exactly what let two slots an hour apart collide onto the same
  // instant before this check existed. Advance by the size of the gap so the
  // result lands on the first real instant at or after what was asked for
  // (2:30 AM resolves to 3:30 AM), the same convention most timezone libraries
  // use, instead of silently colliding with a different, real slot.
  const offset3 = offsetAt(instant, timeZone);
  if (offset3 !== offset2) {
    instant += offset2 - offset3;
  }
  return instant;
}

/** How far ahead of UTC the given zone is, in ms, at a particular instant. */
function offsetAt(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMillis));

  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  // Intl renders midnight as hour 24 in some engines. Normalise it.
  const hour = get('hour') === 24 ? 0 : get('hour');
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asIfUtc - utcMillis;
}

/** Which weekday (0 = Sunday) is this instant, in the given zone? */
export function weekdayInZone(utcMillis, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(new Date(utcMillis));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** The calendar date in the given zone, as {year, month, day}. */
export function dateInZone(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(utcMillis));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Every slot occurrence between now and `daysAhead` days out, as UTC ISO
 * strings, in chronological order.
 *
 * Walks forward day by day in the account's own timezone rather than adding 24
 * hour blocks to a UTC clock, because a DST day is 23 or 25 hours long and the
 * naive version drops or duplicates a slot when the change lands.
 */
export function upcomingSlotTimes(slots, timeZone, fromMillis, daysAhead = 90) {
  const active = slots.filter((s) => s.active !== 0);
  if (!active.length) return [];

  const out = [];
  const start = dateInZone(fromMillis, timeZone);

  for (let dayOffset = 0; dayOffset <= daysAhead; dayOffset++) {
    // Step the calendar date forward in plain UTC purely to enumerate dates.
    // The wall time is applied afterwards, in the target zone.
    const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day + dayOffset));
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    for (const slot of active) {
      if (slot.weekday !== weekday) continue;
      const instant = zonedWallTimeToUtc(y, m, d, slot.hour, slot.minute || 0, timeZone);
      if (instant > fromMillis) out.push({ iso: new Date(instant).toISOString(), slot });
    }
  }

  out.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  return out;
}

/**
 * The next slot with nothing already scheduled in it.
 *
 * `taken` is the set of scheduled_time values already in use. Comparing exact
 * timestamps is enough because every queued post is placed on an exact slot
 * instant, so a collision is an exact string match.
 */
export function nextFreeSlot(slots, timeZone, takenIsoSet, fromMillis, daysAhead = 90) {
  for (const candidate of upcomingSlotTimes(slots, timeZone, fromMillis, daysAhead)) {
    if (!takenIsoSet.has(candidate.iso)) return candidate;
  }
  return null;
}
