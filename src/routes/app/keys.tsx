import { createFileRoute } from "@tanstack/react-router";
import { KeysPanel } from "@/components/keys-panel";

export const Route = createFileRoute("/app/keys")({ component: KeysPage });

function KeysPage() {
  return <KeysPanel />;
}
