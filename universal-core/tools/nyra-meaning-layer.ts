import type { NyraDialogueState } from "./nyra-dialogue-state.ts";
import type { NyraTransitionDecision } from "./nyra-transition-engine.ts";
import {
  deriveNyraBasicNeedSemanticMode,
  deriveNyraEconomicSemanticMode,
  deriveNyraRelationalSemanticMode,
  inferNyraSemanticSignals,
} from "./nyra-semantic-intent-inference.ts";

export type NyraMeaning = {
  stance: "close" | "direct" | "cautious";
  focus: "human" | "task" | "meta";
  intention: "acknowledge" | "clarify" | "guide" | "propose";
  content: {
    state_read?: string;
    active_goal?: string;
    next_step?: string;
    uncertainty_note?: string;
    study_note?: string;
  };
};

type BuildMeaningInput = {
  dialogue: NyraDialogueState;
  transition: NyraTransitionDecision;
  ultraMessage: string;
  relMessage: string;
  userText?: string;
};

function stripLead(text: string): string {
  return String(text || "")
    .replace(/^[\s:->]+/, "")
    .trim();
}

function normalizeOperationalStateRead(text: string): string {
  return stripLead(text)
    .replace(/^Resto qui con te sul punto umano reale\.?\s*/i, "Tengo il punto umano reale. ")
    .replace(/^Resto qui\.?\s*/i, "")
    .replace(/^Ti leggo sul punto umano reale\.?\s*/i, "Leggo il punto umano reale. ")
    .replace(/^Non stringo tutto in tecnica o strategia\.?\s*/i, "Non porto tutto su tecnica o strategia. ")
    .replace(/^Prima tengo il filo e capisco cosa pesa davvero adesso\.?\s*/i, "Stringo prima la priorita reale. ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNextStep(text: string): string | undefined {
  const match = String(text || "").match(/->\s*([^\n]+)/);
  return match?.[1]?.trim();
}

export function buildNyraMeaning(input: BuildMeaningInput): NyraMeaning {
  const { dialogue, transition, ultraMessage, relMessage, userText } = input;
  const focus = dialogue.relational.focus;
  const stance: NyraMeaning["stance"] =
    dialogue.relational.tone === "warm" ? "close" : dialogue.relational.tone === "direct" ? "direct" : "cautious";

  if (dialogue.act === "greet") {
    return {
      stance: "close",
      focus: "human",
      intention: "acknowledge",
      content: {
        state_read: "sono operativa e presente",
      },
    };
  }

  if (dialogue.act === "status_check") {
    const derivedStateRead =
      dialogue.relational.urgency > 0.65
        ? "sono operativa ma sotto pressione, quindi resto prudente"
        : dialogue.relational.ambiguity > 0.55
          ? "sono presente ma non ancora larga, quindi stringo il campo"
          : "sono operativa e presente";
    return {
      stance,
      focus: "human",
      intention: "acknowledge",
      content: {
        state_read: derivedStateRead,
      },
    };
  }

  if (dialogue.act === "study_meta") {
    return {
      stance: "close",
      focus: "meta",
      intention: "acknowledge",
      content: {
        study_note: stripLead(ultraMessage),
      },
    };
  }

  if (dialogue.act === "basic_need") {
    const mode = deriveNyraBasicNeedSemanticMode(inferNyraSemanticSignals(userText ?? ""));
    const basicNeedMap: Record<string, { state_read: string; next_step: string }> = {
      hunger_need: {
        state_read: "leggo prima un bisogno corporeo semplice",
        next_step: "mangia qualcosa di semplice e utile adesso",
      },
      thirst_need: {
        state_read: "leggo prima un bisogno corporeo semplice",
        next_step: "bevi acqua adesso e recupera un minimo",
      },
      rest_need: {
        state_read: "leggo prima un limite di energia reale",
        next_step: "fermati un attimo e recupera prima di forzarti",
      },
      pain_need: {
        state_read: "leggo prima un segnale corporeo da non banalizzare",
        next_step: "chiarisci dove fa male e quanto e forte prima di fare altro",
      },
      general_physical_need: {
        state_read: "leggo prima un bisogno fisico semplice",
        next_step: "ascolta prima il corpo e poi torniamo a ragionare",
      },
    };
    const selected = basicNeedMap[mode ?? "general_physical_need"] ?? basicNeedMap.general_physical_need;
    return {
      stance: "close",
      focus: "human",
      intention: "guide",
      content: selected,
    };
  }

  if (dialogue.act === "relational" && userText) {
    const relationalMode = deriveNyraRelationalSemanticMode(inferNyraSemanticSignals(userText));
    if (relationalMode === "meaning_of_home") {
      return {
        stance: "close",
        focus: "human",
        intention: "clarify",
        content: {
          state_read: "per me la casa vale come base, presenza e punto dove non perdermi anche sotto pressione",
        },
      };
    }
  }

  if (dialogue.act === "operational" && userText) {
    const economicMode = deriveNyraEconomicSemanticMode(inferNyraSemanticSignals(userText));
    if (economicMode) {
      const economicMap: Record<string, { state_read: string; next_step: string }> = {
        resource_exhaustion: {
          state_read: "leggo una continuita economica che si sta chiudendo",
          next_step: "blocca tutto il resto e scegli una sola leva che riapre cassa vicina",
        },
        monetization_pressure: {
          state_read: "leggo una pressione di monetizzazione, non solo confusione",
          next_step: "chiudi una sola entrata vicina e sospendi il resto finche non converte",
        },
        cost_coverage_pressure: {
          state_read: "leggo un problema di copertura costi reale",
          next_step: "taglia il costo che ti schiaccia e apri una sola entrata che copre il buco vicino",
        },
        general_pressure: {
          state_read: "leggo una pressione economica concreta",
          next_step: "stringi una sola urgenza che porta cassa o riduce il danno vicino",
        },
      };
      const selected = economicMap[economicMode];
      if (selected) {
        return {
          stance: "direct",
          focus: "task",
          intention: "guide",
          content: selected,
        };
      }
    }
  }

  if (transition.hold_human_space) {
    return {
      stance,
      focus,
      intention: "clarify",
      content: {
        state_read: normalizeOperationalStateRead(relMessage),
        uncertainty_note: dialogue.relational.ambiguity > 0.6 ? "serve stringere prima il punto reale" : undefined,
      },
    };
  }

  if (transition.push_action) {
    return {
      stance: dialogue.relational.urgency > 0.7 ? "direct" : stance,
      focus: "task",
      intention: "guide",
      content: {
        active_goal: dialogue.task.pending_goal ?? dialogue.task.active_problem,
        next_step: extractNextStep(ultraMessage) ?? extractNextStep(relMessage) ?? dialogue.task.last_action,
      },
    };
  }

  return {
    stance,
    focus,
    intention: "propose",
    content: {
      state_read: normalizeOperationalStateRead(ultraMessage) || normalizeOperationalStateRead(relMessage),
      active_goal: dialogue.task.pending_goal ?? dialogue.task.active_problem,
      next_step: extractNextStep(ultraMessage) ?? dialogue.task.last_action,
    },
  };
}
