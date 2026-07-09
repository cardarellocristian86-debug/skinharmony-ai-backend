import type { NyraActionRoute } from "./nyra-action-router.ts";
import type { NyraBranchLearningBundle } from "./nyra-branch-learning.ts";
import type { NyraBranchOverlay } from "./nyra-branch-overlay.ts";
import type { NyraCortexGraph } from "./nyra-cortex-graph.ts";
import type { NyraCore2PipelineResult } from "./nyra-core2-pipeline.ts";

export type NyraTextChatCommand = ":memory" | ":forget" | ":exit" | ":help";

export type NyraTextChatMemory = {
  ownerPreferences: Record<string, string>;
  ownerFacts: Record<string, string>;
  dialogueNotes: string[];
  stableCorrections: string[];
  updatedAt: number;
};

export type NyraTextChatOutput = {
  content: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  memoryUpdated: boolean;
  source: "command" | "nyra_core" | "text-branch-command" | "text-fallback" | "rich-core";
  ui?: {
    notes?: string[];
    badges?: string[];
  };
  branch_overlay?: NyraBranchOverlay;
  branch_learning?: NyraBranchLearningBundle;
  action_route?: NyraActionRoute;
  core2_pipeline?: NyraCore2PipelineResult;
  cortex_graph?: NyraCortexGraph;
};
