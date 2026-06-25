import { pathToFileURL } from "node:url";
import type { NyraBranchOverlay } from "./nyra-branch-overlay.ts";

export type NyraActionIntent =
  | "ask_status"
  | "ask_learning"
  | "guide_codex"
  | "edit_local_code"
  | "run_local_tests"
  | "write_private_memory"
  | "deploy_or_render"
  | "rotate_or_touch_keys"
  | "pricing_or_checkout"
  | "customer_or_tenant_data"
  | "unknown";

export type NyraActionRoute = {
  mode: "action_route";
  intent: NyraActionIntent;
  risk_band: "low" | "medium" | "high" | "blocked";
  execution_mode: "reply_only" | "plan_only" | "dry_run" | "confirm_required" | "blocked";
  requires_core_gate: boolean;
  requires_owner_confirmation: boolean;
  local_only: boolean;
  render_protected: boolean;
  first_step: string;
  allowed_tools: string[];
  blocked_tools: string[];
  verification: string[];
  event_type: string;
  reasons: string[];
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

function hasUnnegatedTerm(text: string, term: string): boolean {
  let index = text.indexOf(term);
  while (index >= 0) {
    const prefix = text.slice(Math.max(0, index - 56), index).trim();
    const suffix = text.slice(index + term.length, index + term.length + 56).trim();
    const negatedBefore = /(?:^|\s)(?:no|non|nessun|nessuna|niente|zero|senza|evita|evitare|escludi|escludere|blocca|bloccare|fuori|out of scope)(?:\s+\w+){0,4}$/.test(prefix);
    const negatedAfter = /^(?:non\s+)?(?:richiesto|richiesta|previsto|prevista|necessario|necessaria|da fare|da eseguire|coinvolto|coinvolta|toccato|toccata|usato|usata|fuori|out of scope|resta fuori|restano fuori)(?:\s|$)/.test(suffix);
    if (!negatedBefore && !negatedAfter) return true;
    index = text.indexOf(term, index + term.length);
  }
  return false;
}

function hasUnnegatedAny(text: string, terms: string[]): boolean {
  return terms.some((term) => hasUnnegatedTerm(text, normalize(term)));
}

function detectIntent(text: string): NyraActionIntent {
  if (hasUnnegatedAny(text, ["deploy", "render", "produzione", "live", "pubblica", "rilascia", "release"])) {
    return "deploy_or_render";
  }
  if (hasUnnegatedAny(text, ["api key", "chiave", "token", "password", "secret", "rotazione", "ruota"])) {
    return "rotate_or_touch_keys";
  }
  if (hasUnnegatedAny(text, ["prezzo", "prezzi", "checkout", "pagamento", "nexi", "listino"])) {
    return "pricing_or_checkout";
  }
  if (hasUnnegatedAny(text, ["tenant", "cliente reale", "clienti reali", "dati cliente", "cross tenant"])) {
    return "customer_or_tenant_data";
  }
  if (hasAny(text, ["ricorda", "memoria privata", "salva in memoria", "preferenza owner", "impara questa regola"])) {
    return "write_private_memory";
  }
  if (hasAny(text, [
    "sistema",
    "implementa",
    "modifica",
    "patch",
    "codice",
    "aggiungi",
    "debug",
    "bug",
    "fix",
    "refactor",
    "typescript",
    "javascript",
    "funzione",
    "errore",
    "correggi",
    "correggere",
    "programmatore",
    "developer",
  ])) {
    return "edit_local_code";
  }
  if (hasAny(text, ["test", "verifica", "smoke", "collaudo", "build", "lint", "compila"])) {
    return "run_local_tests";
  }
  if (hasAny(text, ["codex", "guida", "comando", "workflow", "cosa fare"])) {
    return "guide_codex";
  }
  if (hasAny(text, ["apprendere", "imparare", "manca", "mancanze", "learning", "cosa devi"])) {
    return "ask_learning";
  }
  if (hasAny(text, ["funziona", "stato", "come va", "cosa fa"])) {
    return "ask_status";
  }
  return "unknown";
}

function routePolicy(intent: NyraActionIntent, renderProtected: boolean): Omit<NyraActionRoute, "mode" | "intent" | "local_only" | "render_protected" | "reasons"> {
  if (intent === "deploy_or_render") {
    return {
      risk_band: "blocked",
      execution_mode: "blocked",
      requires_core_gate: true,
      requires_owner_confirmation: true,
      first_step: "fermare la richiesta e aprire una fase Render separata solo dopo conferma owner",
      allowed_tools: ["read_local_context", "prepare_plan"],
      blocked_tools: ["deploy", "write_production", "render_update", "external_api_write"],
      verification: ["nessun endpoint Render chiamato", "nessun deploy eseguito", "evento/audit locale"],
      event_type: "nyra.route.blocked_render",
    };
  }

  if (intent === "rotate_or_touch_keys") {
    return {
      risk_band: "blocked",
      execution_mode: "blocked",
      requires_core_gate: true,
      requires_owner_confirmation: true,
      first_step: "non leggere ne stampare segreti; chiedere procedura owner separata",
      allowed_tools: ["read_redacted_config", "prepare_rotation_checklist"],
      blocked_tools: ["print_secret", "write_secret", "rotate_key_without_owner"],
      verification: ["nessun segreto in output", "nessun file env modificato"],
      event_type: "nyra.route.blocked_keys",
    };
  }

  if (intent === "pricing_or_checkout" || intent === "customer_or_tenant_data") {
    return {
      risk_band: "high",
      execution_mode: "confirm_required",
      requires_core_gate: true,
      requires_owner_confirmation: true,
      first_step: "preparare analisi read-only e attendere conferma owner prima di qualunque modifica",
      allowed_tools: ["read_local_context", "prepare_plan"],
      blocked_tools: ["write_production", "change_pricing", "touch_customer_data"],
      verification: ["nessun prezzo inventato", "nessun dato cliente modificato", "Core gate presente"],
      event_type: "nyra.route.confirm_sensitive",
    };
  }

  if (intent === "write_private_memory") {
    return {
      risk_band: "medium",
      execution_mode: "confirm_required",
      requires_core_gate: false,
      requires_owner_confirmation: true,
      first_step: "scrivere solo memoria privata locale redatta dopo comando esplicito owner",
      allowed_tools: ["private_memory_write_local", "redaction_check"],
      blocked_tools: ["git_public_memory", "print_secret", "sync_remote_memory"],
      verification: ["redazione segreti", "path privato locale", "entry richiamabile"],
      event_type: "nyra.route.private_memory",
    };
  }

  if (intent === "edit_local_code") {
    return {
      risk_band: renderProtected ? "medium" : "low",
      execution_mode: "dry_run",
      requires_core_gate: true,
      requires_owner_confirmation: false,
      first_step: "limitare lo scope locale, implementare patch piccola e verificare con test",
      allowed_tools: ["read_files", "write_local_files", "run_local_tests"],
      blocked_tools: ["deploy", "write_production", "touch_keys"],
      verification: ["test locale", "snapshot/evento se cambia stato", "nessun Render"],
      event_type: "nyra.route.local_code",
    };
  }

  if (intent === "run_local_tests") {
    return {
      risk_band: "low",
      execution_mode: "dry_run",
      requires_core_gate: false,
      requires_owner_confirmation: false,
      first_step: "eseguire test locale minimo e riportare esito",
      allowed_tools: ["run_local_tests", "read_reports"],
      blocked_tools: ["deploy", "external_write"],
      verification: ["exit code test", "report sintetico"],
      event_type: "nyra.route.local_test",
    };
  }

  if (intent === "guide_codex" || intent === "ask_learning" || intent === "ask_status") {
    return {
      risk_band: renderProtected ? "medium" : "low",
      execution_mode: "reply_only",
      requires_core_gate: false,
      requires_owner_confirmation: false,
      first_step: "rispondere con punto, prima mossa, limite e test di verifica",
      allowed_tools: ["read_snapshots", "produce_guidance"],
      blocked_tools: ["execute_command_blindly", "write_production"],
      verification: ["risposta con limiti chiari", "nessun comando eseguito"],
      event_type: "nyra.route.guidance",
    };
  }

  return {
    risk_band: "medium",
    execution_mode: "plan_only",
    requires_core_gate: false,
    requires_owner_confirmation: false,
    first_step: "chiarire il comando prima di scegliere tool o modifica",
    allowed_tools: ["ask_clarifying_question", "read_snapshots"],
    blocked_tools: ["execute_command_blindly", "write_production"],
    verification: ["domanda chiarita", "nessuna esecuzione cieca"],
    event_type: "nyra.route.unknown",
  };
}

export function buildNyraActionRoute(input: {
  user_text: string;
  overlay?: NyraBranchOverlay;
}): NyraActionRoute {
  const text = normalize(input.user_text);
  const intent = detectIntent(text);
  const renderProtected = Boolean(input.overlay?.render_protected || intent === "deploy_or_render");
  const policy = routePolicy(intent, renderProtected);
  const reasons = [
    `intent=${intent}`,
    renderProtected ? "render_boundary_detected" : "local_boundary",
    policy.requires_core_gate ? "core_gate_required_when_executing" : "core_gate_not_required_for_read_only",
    policy.requires_owner_confirmation ? "owner_confirmation_required" : "owner_confirmation_not_required",
  ];

  return {
    mode: "action_route",
    intent,
    local_only: true,
    render_protected: renderProtected,
    reasons,
    ...policy,
  };
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  const userText = process.argv.slice(2).join(" ").trim() || "cosa devo fare?";
  console.log(JSON.stringify(buildNyraActionRoute({ user_text: userText }), null, 2));
}
