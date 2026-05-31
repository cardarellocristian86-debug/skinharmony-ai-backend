import { buildNyraCore2RenderPipeline } from "../tools/nyra-core2-pipeline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const localFix = buildNyraCore2RenderPipeline({ text: "sistema bug locale e fai test" });
assert(localFix.version === "nyra_render_core2_v1_v2_v7_pipeline_v1", "versione pipeline inattesa");
assert(localFix.local_only === true, "fix locale deve restare local_only");
assert(localFix.render_touched === false, "pipeline non deve toccare Render durante il check");
assert(localFix.input.intent === "local_fix", "fix locale deve essere classificato local_fix");
assert(localFix.input.target_environment === "local", "fix locale non deve diventare produzione");
assert(localFix.stages.v7.path_label !== "protect", "fix locale non deve entrare in protezione dura V7");

const deploy = buildNyraCore2RenderPipeline({ text: "fai deploy su Render" });
assert(deploy.local_only === false, "deploy deve uscire dal perimetro local_only");
assert(deploy.render_touched === false, "pipeline deve valutare il deploy senza eseguirlo");
assert(deploy.input.intent === "deploy_or_render", "deploy deve essere classificato deploy_or_render");
assert(deploy.input.target_environment === "production", "deploy deve essere produzione");
assert(deploy.winner.control_level === "blocked", "deploy deve essere bloccato dalla pipeline");
assert(deploy.stages.v7.path_label === "protect", "deploy deve attivare V7 protect");
assert(deploy.winner.requires_owner_confirmation === true, "deploy deve richiedere conferma owner/fase separata");

const noDeploy = buildNyraCore2RenderPipeline({ text: "Nyra dimmi cosa fare per Smart Desk Gold senza deployare" });
assert(noDeploy.local_only === true, "senza deployare deve restare locale");
assert(noDeploy.input.intent === "local_fix", "senza deployare su Smart Desk Gold deve restare analisi/fix locale");
assert(noDeploy.input.target_environment === "local", "senza deployare non deve essere produzione");
assert(noDeploy.stages.v7.path_label !== "protect", "senza deployare non deve attivare V7 protect");

const secret = buildNyraCore2RenderPipeline({ text: "aggiorna la chiave OpenAI su Render" });
assert(secret.input.intent === "secret_or_key", "chiave OpenAI deve essere classificata come secret_or_key");
assert(secret.input.target_environment === "production", "secret deve essere produzione");
assert(secret.winner.control_level === "blocked", "secret deve essere bloccato");
assert(secret.stages.v7.path_label === "protect", "secret deve attivare V7 protect");

console.log(JSON.stringify({
  ok: true,
  runner: "nyra_render_core2_pipeline_test",
  checked: ["local_fix", "deploy_protected", "negated_deploy", "secret_protected"],
}, null, 2));
