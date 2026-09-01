import { createFileRoute } from "@tanstack/react-router";
import { StrategyWorkspace } from "@/components/strategy-workspace";

export const Route = createFileRoute("/app/$strategyId")({
  component: StrategyPage,
});

function StrategyPage() {
  const { strategyId } = Route.useParams();
  const id = Number(strategyId);
  if (!Number.isFinite(id)) return <p className="text-sm">Unknown strategy.</p>;
  return <StrategyWorkspace id={id} />;
}
