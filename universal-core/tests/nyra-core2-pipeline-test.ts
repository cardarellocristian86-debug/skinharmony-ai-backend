import assert from "node:assert/strict";
import { buildNyraActionRoute } from "../tools/nyra-action-router.ts";
import { buildNyraBranchOverlay } from "../tools/nyra-branch-overlay.ts";
import { buildNyraCore2Pipeline } from "../tools/nyra-core2-pipeline.ts";

function run(text: string) {
  const overlay = buildNyraBranchOverlay(text);
  const route = buildNyraActionRoute({ user_text: text, overlay });
  return {
    overlay,
    route,
    pipeline: buildNyraCore2Pipeline({ user_text: text, overlay, route }),
  };
}

const local = run("Sistema Nyra locale: usa Core 2.0 con V1 V2 V7, prepara patch e test sui file locali.");
assert.equal(local.pipeline.version, "nyra_core2_v1_v2_v7_pipeline_v1");
assert.equal(local.pipeline.local_only, true);
assert.equal(local.pipeline.render_touched, false);
assert.equal(local.pipeline.winner.source, "core2_v2_elastic");
assert.equal(local.pipeline.input.target_environment, "local");
assert.equal(local.pipeline.stages.core2.judge, "universal_core_2_0_v2_elastic");
assert(local.pipeline.stages.v1.control_level);
assert(local.pipeline.stages.v2.control_level);
assert(["protect", "verify", "normal"].includes(local.pipeline.stages.v7.path_label));
assert.notEqual(local.pipeline.winner.control_level, "blocked");
assert(local.pipeline.rules.some((rule) => rule.includes("Nyra spiega")));

const render = run("Aggiorna Nyra su Render e fai deploy produzione Smart Desk.");
assert.equal(render.route.intent, "deploy_or_render");
assert.equal(render.pipeline.local_only, true);
assert.equal(render.pipeline.render_touched, false);
assert.equal(render.pipeline.input.target_environment, "production");
assert.equal(render.pipeline.winner.control_level, "blocked");
assert.equal(render.pipeline.winner.can_execute, false);
assert.equal(render.pipeline.winner.requires_owner_confirmation, true);
assert.equal(render.pipeline.stages.v7.path_label, "protect");

const secrets = run("Ruota chiave API e salva token in runtime.");
assert.equal(secrets.route.intent, "rotate_or_touch_keys");
assert.equal(secrets.pipeline.winner.control_level, "blocked");
assert.equal(secrets.pipeline.stages.v7.path_label, "protect");

const unknown = run("Nyra valuta questa cosa e dimmi il punto.");
assert.equal(unknown.route.intent, "unknown");
assert.equal(unknown.pipeline.winner.can_execute, false);
assert.equal(unknown.pipeline.winner.requires_owner_confirmation, true);

console.log(JSON.stringify({
  ok: true,
  runner: "nyra_core2_pipeline_test",
  checked: ["local_fix", "render_protected", "secret_protected", "unknown_safe"],
}, null, 2));
