import type { NyraCommandIntent } from "./nyra-command-interpreter.ts";
import type { NyraEffectiveTaskState } from "./nyra-task-state.ts";

export type NyraCommandPlan = {
  mode: "acknowledge" | "answer" | "clarify" | "act";
  understood: string;
  action_now?: string;
  missing?: string;
};

function cleanStep(step?: string): string | undefined {
  return step?.replace(/^\s*->\s*/, "").trim() || undefined;
}

export function planNyraCommand(
  command: NyraCommandIntent,
  task: NyraEffectiveTaskState,
): NyraCommandPlan {
  if (command.act === "greet") {
    return {
      mode: "acknowledge",
      understood: "saluto ricevuto",
    };
  }

  if (command.act === "status") {
    return {
      mode: "answer",
      understood: "stai chiedendo il mio stato operativo",
    };
  }

  if (command.act === "study_meta") {
    return {
      mode: "answer",
      understood: "stai chiedendo il mio stato di studio",
    };
  }

  if (command.act === "relational") {
    return {
      mode: "clarify",
      understood: "stai chiedendo presenza e comprensione umana",
    };
  }

  if (command.act === "technical") {
    return {
      mode: "answer",
      understood: command.objective ?? "stai aprendo un pivot tecnico",
      action_now: "sospendo il task precedente e leggo il problema tecnico separatamente",
    };
  }

  if (command.act === "followup") {
    const next = cleanStep(task.next_step);
    return {
      mode: next ? "act" : "clarify",
      understood: next ? "stai chiedendo il passo successivo" : "stai chiedendo di continuare",
      action_now: next,
      missing: next ? undefined : "mi manca un passo attivo gia definito",
    };
  }

  if (command.act === "operational") {
    return {
      mode: "act",
      understood: command.objective ?? "stai dando un compito operativo",
      action_now: cleanStep(task.next_step) ?? command.objective,
    };
  }

  if (command.act === "open") {
    return {
      mode: task.active_task ? "act" : "clarify",
      understood: "stai chiedendo una lettura aperta della situazione",
      action_now: task.active_task ? cleanStep(task.next_step) ?? "stringi la priorita che pesa di piu adesso" : undefined,
      missing: task.active_task ? undefined : "mi serve il punto che pesa di piu per stringere bene",
    };
  }

  return {
    mode: "clarify",
    understood: "la richiesta non e ancora abbastanza stretta",
    missing: "mi serve un obiettivo piu chiaro",
  };
}
