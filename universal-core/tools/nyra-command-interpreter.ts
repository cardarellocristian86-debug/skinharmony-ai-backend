export type NyraCommandAct =
  | "greet"
  | "status"
  | "study_meta"
  | "relational"
  | "open"
  | "followup"
  | "operational"
  | "technical"
  | "unknown";

export type NyraCommandDomain = "general" | "mail" | "strategy" | "runtime" | "engineering";

export type NyraCommandIntent = {
  act: NyraCommandAct;
  domain: NyraCommandDomain;
  objective?: string;
  asks_direct_action: boolean;
  should_suspend_previous_task: boolean;
};

function normalize(text: string): string {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export function interpretNyraCommand(userText: string): NyraCommandIntent {
  const text = normalize(userText);

  if (text.includes(" ciao ") || text.includes(" buongiorno ") || text.includes(" buonasera ") || text.includes(" ehi ")) {
    return {
      act: "greet",
      domain: "general",
      asks_direct_action: false,
      should_suspend_previous_task: true,
    };
  }

  if (text.includes(" come va ") || text.includes(" come stai ") || text.includes(" tutto bene ")) {
    return {
      act: "status",
      domain: "general",
      asks_direct_action: false,
      should_suspend_previous_task: true,
    };
  }

  if (text.includes(" hai studiato ") || text.includes(" vuoi studiare ") || text.includes(" cosa vuoi studiare ")) {
    return {
      act: "study_meta",
      domain: "general",
      asks_direct_action: false,
      should_suspend_previous_task: true,
    };
  }

  if (
    text.includes(" ho bisogno che tu mi capisca ") ||
    text.includes(" mi capisci ") ||
    text.includes(" voglio parlare con te ")
  ) {
    return {
      act: "relational",
      domain: "general",
      asks_direct_action: false,
      should_suspend_previous_task: true,
    };
  }

  if (text.includes(" render ") || text.includes(" deploy ") || text.includes(" server ") || text.includes(" runtime ")) {
    return {
      act: "technical",
      domain: "runtime",
      objective: "valutare infrastruttura e runtime",
      asks_direct_action: false,
      should_suspend_previous_task: true,
    };
  }

  if (text.includes(" rust ") || text.includes(" performance ") || text.includes(" typescript ") || text.includes(" engine ")) {
    return {
      act: "technical",
      domain: "engineering",
      objective: "valutare scelta tecnica e performance",
      asks_direct_action: false,
      should_suspend_previous_task: true,
    };
  }

  if (text.includes(" ok ") || text.includes(" quindi ") || text.includes(" e quindi ")) {
    return {
      act: "followup",
      domain: "general",
      asks_direct_action: true,
      should_suspend_previous_task: false,
    };
  }

  if (
    text.includes(" devo ") ||
    text.includes(" mandare ") ||
    text.includes(" fare ") ||
    text.includes(" apri ")
  ) {
    const domain: NyraCommandDomain =
      text.includes(" mail ") || text.includes(" email ") || text.includes(" cliente ")
        ? "mail"
        : text.includes(" soldi ") || text.includes(" lavoro ") || text.includes(" smart desk ")
          ? "strategy"
          : "general";
    return {
      act: "operational",
      domain,
      objective: userText.trim(),
      asks_direct_action: true,
      should_suspend_previous_task: false,
    };
  }

  if (
    text.includes(" come sto ") ||
    text.includes(" come la vedi ") ||
    text.includes(" cosa ne pensi ") ||
    text.includes(" secondo te ")
  ) {
    return {
      act: "open",
      domain: "general",
      asks_direct_action: false,
      should_suspend_previous_task: false,
    };
  }

  return {
    act: "unknown",
    domain: "general",
    asks_direct_action: false,
    should_suspend_previous_task: false,
  };
}
