import { buildNyraActionRoute, type NyraActionRoute } from "./nyra-action-router.ts";
import { buildNyraBranchOverlay, type NyraBranchOverlay } from "./nyra-branch-overlay.ts";
import { buildNyraCore2Pipeline, type NyraCore2PipelineResult } from "./nyra-core2-pipeline.ts";
import { buildNyraBranchLearningBundle, type NyraBranchLearningBundle } from "./nyra-branch-learning.ts";
import branchComposerShared from "./nyra-branch-composer-shared.cjs";

export type NyraRuntimeOverlayBundle = {
  branch_overlay: NyraBranchOverlay;
  action_route: NyraActionRoute;
  core2_pipeline: NyraCore2PipelineResult;
  branch_learning?: NyraBranchLearningBundle;
};

export function buildNyraRuntimeOverlayBundle(userText: string, rootDir?: string): NyraRuntimeOverlayBundle {
  const branchOverlay = buildNyraBranchOverlay(userText);
  const actionRoute = buildNyraActionRoute({ user_text: userText, overlay: branchOverlay });
  const core2Pipeline = buildNyraCore2Pipeline({
    user_text: userText,
    overlay: branchOverlay,
    route: actionRoute,
  });
  const branchLearning = buildNyraBranchLearningBundle({
    root_dir: rootDir,
    branch_overlay: branchOverlay,
  });
  return {
    branch_overlay: branchOverlay,
    action_route: actionRoute,
    core2_pipeline: core2Pipeline,
    branch_learning: branchLearning,
  };
}

export function buildNyraBranchSummaryNotes(bundle: NyraRuntimeOverlayBundle): string[] {
  return branchComposerShared.buildNyraBranchSummaryNotesData(bundle);
}

export function buildNyraBranchSummaryLine(bundle: NyraRuntimeOverlayBundle): string {
  return branchComposerShared.buildNyraBranchSummaryLineData(bundle);
}
