import { categoryGuide } from "@/lib/category-guide";
import { ROOM_SCOPES_CHANGED, roomFits } from "@/lib/room-fit";
import type { Signal } from "@/lib/types";

/**
 * A one-off list after the rooms were re-scoped: watchpoints whose own words
 * point to a different room than the one they sit in. Nothing is moved; a
 * person opens the watchpoint and decides. The list disappears when empty.
 */
export function RoomScopeNotice({ signals, onOpenSignal }: { signals: Signal[]; onOpenSignal: (id: number) => void }) {
  const fits = roomFits(signals);
  if (!fits.length) return null;
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
        Room scopes changed on {ROOM_SCOPES_CHANGED}: {fits.length} watchpoint{fits.length === 1 ? "" : "s"} may belong
        elsewhere
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        The ten rooms were re-scoped to fit any sector. These watchpoints’ own words point to a different room than
        the one they were given. Nothing has been moved: open one and move it, or leave it where it is.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {fits.map((f) => (
          <li key={f.signal.id}>
            <button
              type="button"
              className="text-left underline-offset-2 hover:underline"
              onClick={() => onOpenSignal(f.signal.id)}
            >
              “{f.signal.name}”
            </button>{" "}
            sits in {f.signal.category} {categoryGuide(f.signal.category).short}; its own words point to {f.suggested}{" "}
            {categoryGuide(f.suggested).short} ({f.hits} of that room’s words, {f.own} of its own).
          </li>
        ))}
      </ul>
    </details>
  );
}
