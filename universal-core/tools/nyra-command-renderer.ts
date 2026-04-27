import type { NyraCommandPlan } from "./nyra-command-planner.ts";

export function renderNyraCommandPlan(plan: NyraCommandPlan): string {
  if (plan.mode === "acknowledge") {
    return "Ricevuto. Operativa.";
  }

  if (plan.mode === "answer") {
    const action = plan.action_now ? ` Azione: ${plan.action_now}.` : "";
    return `Problema letto: ${plan.understood}.${action}`.trim();
  }

  if (plan.mode === "act") {
    return `Problema letto: ${plan.understood}. Prossima mossa: ${plan.action_now ?? "stringi il prossimo passo"}.`;
  }

  return `Problema letto: ${plan.understood}. Mi manca: ${plan.missing ?? "un punto piu chiaro"}.`;
}
