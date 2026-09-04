/**
 * Pull one JSON object out of a model reply that may be fenced, prefixed with
 * prose, or trailed by a closing remark. Throws a user-readable error.
 */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : trimmed) ?? "";
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("The model did not return JSON.");
  const end = raw.lastIndexOf("}");
  const slice = end > start ? raw.slice(start, end + 1) : raw.slice(start);
  let value: unknown;
  try {
    value = JSON.parse(slice);
  } catch {
    throw new Error("The model returned incomplete JSON. Run it again, or use a shorter excerpt.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The model returned JSON, but not an object.");
  }
  return value as Record<string, unknown>;
}
