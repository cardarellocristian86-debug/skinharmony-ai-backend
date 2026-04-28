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
};
