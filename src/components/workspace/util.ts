import { useQueryClient } from "@tanstack/react-query";
import { day } from "@/lib/day";
import type { Assumption, MemberRole } from "@/lib/types";

export { day };

export function statusTone(s: Assumption["status"]) {
  return s;
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function canEdit(role: MemberRole) {
  return role === "owner" || role === "editor";
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Refresh the open workspace and the portfolio after a mutation. */
export function useRefresh(strategyId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["strategy", strategyId] });
    void qc.invalidateQueries({ queryKey: ["strategies"] });
  };
}
