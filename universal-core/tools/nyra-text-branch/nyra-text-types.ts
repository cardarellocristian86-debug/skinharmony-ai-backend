export type NyraTextRisk = "low" | "medium" | "high";

export type NyraTextInput = {
  ownerId: string;
  text: string;
  timestamp: number;
  ownerVerified?: boolean;
  sessionId?: string;
  channel: "text";
  modality: "chat";
  textBranch: true;
  noVoice: true;
  disableAudio: true;
  requestedOutput: "text";
};

export type NyraTextSource = "text-branch-command" | "text-fallback" | "rich-core";

export type NyraTextActor =
  | "text-override"
  | "branch-bridge"
  | "rich-core"
  | "fallback"
  | "command";

export type NyraTextRouteSnapshot = {
  primary: string;
  secondary: string[];
  confidence: number;
  hardStop: boolean;
  useRichCore: boolean;
  isolateFromPreviousContext: boolean;
  reason: string;
};

export type NyraTextOutput = {
  channel: "text";
  content: string;
  confidence: number;
  risk: NyraTextRisk;
  source: NyraTextSource;
  actor?: NyraTextActor;
  route?: NyraTextRouteSnapshot;
  memoryUpdated: boolean;
  ui?: {
    badges?: string[];
    warning?: string[];
    action?: string[];
    notes?: string[];
  };
};

export type NyraTextSidecarMemory = {
  ownerPreferences: Record<string, string>;
  ownerFacts: Record<string, string>;
  dialogueNotes: string[];
  stableCorrections: string[];
  updatedAt: number;
};
