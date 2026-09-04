/**
 * One calendar day for every screen, reading and export. Date-only values
 * (cliffs, horizons) are already a calendar day; timestamps show the viewer's
 * day. Shared so a date never prints as two different days on one card.
 */
export function day(value: string | null | undefined) {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return value;
  return t.toLocaleDateString("en-CA");
}
