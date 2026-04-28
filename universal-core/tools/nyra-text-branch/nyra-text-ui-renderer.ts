import type { NyraTextOutput } from "./nyra-text-types.ts";

function badge(label: string): string {
  return `[${label}]`;
}

function riskBadge(risk: string): string {
  if (risk === "high") return "[risk: HIGH]";
  if (risk === "medium") return "[risk: medium]";
  return "[risk: low]";
}

function box(title: string, lines: string[]): string {
  if (!lines.length) return "";
  return [`┌─ ${title}`, ...lines.map((line) => `│ ${line}`), "└"].join("\n");
}

export function renderNyraTextOutput(output: NyraTextOutput): string {
  const actor = output.actor ?? (output.source === "rich-core" ? "rich-core" : output.source === "text-branch-command" ? "command" : "fallback");
  const domain = output.route?.primary ?? "unknown";
  const secondary = output.route?.secondary?.length ? ` + ${output.route.secondary.join(",")}` : "";
  const badges = [
    badge(actor),
    badge(`domain: ${domain}${secondary}`),
    riskBadge(output.risk),
    badge(`conf: ${output.confidence.toFixed(2)}`),
    ...(output.ui?.badges ?? []).map((item) => badge(item)),
  ];

  const warning = output.risk === "high" || output.ui?.warning?.length
    ? box("WARNING", output.ui?.warning?.length ? output.ui.warning : ["richiesta ad alto rischio"])
    : "";
  const action = output.ui?.action?.length ? box("ACTION", output.ui.action) : "";
  const notes = output.ui?.notes?.length ? box("NOTES", output.ui.notes) : "";

  return [badges.join(" "), warning, action, notes, output.content].filter(Boolean).join("\n\n");
}
