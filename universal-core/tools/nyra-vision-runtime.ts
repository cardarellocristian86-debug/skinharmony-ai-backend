import { existsSync, readFileSync } from "node:fs";

export type VisionStageId =
  | "site"
  | "method"
  | "smartdesk"
  | "universal_core"
  | "nyra"
  | "corelia";

export type VisionStageAlignment = {
  primary_stage: VisionStageId;
  confidence: number;
  trajectory_hint: string;
  stage_scores: Array<{
    id: VisionStageId;
    score: number;
  }>;
  map_loaded: boolean;
};

const STAGE_TRAJECTORY: Record<VisionStageId, string> = {
  site: "sito -> metodo",
  method: "metodo -> Smart Desk",
  smartdesk: "Smart Desk -> Universal Core",
  universal_core: "Universal Core -> Nyra",
  nyra: "Nyra -> Corelia",
  corelia: "Nyra -> Corelia",
};

const STAGE_KEYWORDS: Record<VisionStageId, string[]> = {
  site: ["sito", "wordpress", "home", "pagina", "hero", "landing", "copy", "brand", "skinharmony.it"],
  method: ["metodo", "protocollo", "rituale", "metodo skinharmony", "linguaggio", "nomenclatura"],
  smartdesk: ["smart desk", "agenda", "cliente", "cassa", "magazzino", "dashboard", "centro operativo", "ai gold"],
  universal_core: ["universal core", "flow core", "v0", "v1", "v2", "v3", "digest", "runtime", "core"],
  nyra: ["nyra", "owner-only", "entita", "visione", "ombra", "riconoscimento", "comportamentale"],
  corelia: ["corelia", "commerciale", "prodotto", "enterprise", "cliente", "multi-tenant", "vendibile"],
};

export function loadVisionMapText(path: string): { loaded: boolean; text: string } {
  if (!existsSync(path)) return { loaded: false, text: "" };
  return { loaded: true, text: readFileSync(path, "utf8") };
}

export function scoreVisionAlignment(userText: string, mapText: string, mapLoaded: boolean): VisionStageAlignment {
  const normalized = ` ${userText.toLowerCase()} `;
  const stageScores = (Object.entries(STAGE_KEYWORDS) as Array<[VisionStageId, string[]]>)
    .map(([id, keywords]) => {
      const keywordScore = keywords.reduce((sum, keyword) => sum + (normalized.includes(keyword) ? 1 : 0), 0);
      const mapBoost = mapLoaded && mapText.toLowerCase().includes(id.replace("_", " ")) ? 0.35 : 0;
      return {
        id,
        score: keywordScore + mapBoost,
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = stageScores[0];
  const second = stageScores[1];
  const confidence = Math.min(100, Math.round((top.score * 28 + Math.max(0, top.score - (second?.score ?? 0)) * 18) * 10) / 10);

  return {
    primary_stage: top.score > 0 ? top.id : "nyra",
    confidence: top.score > 0 ? confidence : 36,
    trajectory_hint: STAGE_TRAJECTORY[top.score > 0 ? top.id : "nyra"],
    stage_scores: stageScores.map((entry) => ({
      id: entry.id,
      score: Math.round(entry.score * 100) / 100,
    })),
    map_loaded: mapLoaded,
  };
}
