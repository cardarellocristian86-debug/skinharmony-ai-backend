import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNyraReadOnlyCommunication } from "../tools/nyra-communication-adapter.ts";

const result = buildNyraReadOnlyCommunication({
  user_text: "come facciamo a superare qqq sul collo attuale di nyra?",
  root_dir: process.cwd(),
  state: "attention",
  risk: 46,
  primary_action: "sviluppare il false-break engine separato prima di toccare il selector stabile",
  action_labels: [
    "sviluppare il false-break engine separato prima di toccare il selector stabile",
    "validare su replay completo prima della fusione",
  ],
});

assert.equal(result.mode, "read_only", "adapter must stay read-only");
assert.equal(result.writes_memory, false, "adapter must not write memory");
assert(result.reply.length > 0, "adapter should produce a reply");
assert(result.snapshots.work_summary.length > 0, "adapter should read current work snapshot");
assert(
  result.reply.toLowerCase().includes("read-only") || result.reply.toLowerCase().includes("non scrivo memoria"),
  "reply should expose the read-only boundary",
);

const voiceResult = buildNyraReadOnlyCommunication({
  user_text: "Nyra deve parlare e farsi capire bene, non fare poesie",
  root_dir: process.cwd(),
});

assert.equal(voiceResult.mode, "read_only", "voice adapter must stay read-only");
assert.equal(voiceResult.writes_memory, false, "voice adapter must not write memory");
assert(voiceResult.reply.includes("punto principale"), "voice reply should explain the simple communication structure");
assert(!voiceResult.reply.includes("troppo generico"), "voice reply should not fall back to a generic bottleneck");

const greetingResult = buildNyraReadOnlyCommunication({
  user_text: "ciao",
  root_dir: process.cwd(),
});

assert.equal(greetingResult.intent, "simple_dialogue", "greeting should stay in simple dialogue");
assert(!greetingResult.reply.includes("troppo generico"), "greeting should not trigger generic diagnostic fallback");
assert(greetingResult.reply.includes("Ci sono"), "greeting should answer naturally");

const homeResult = buildNyraReadOnlyCommunication({
  user_text: "come è casa?",
  root_dir: process.cwd(),
});

assert.equal(homeResult.intent, "simple_dialogue", "short ambiguous home query should stay simple");
assert(homeResult.reply.includes("Non ho dati reali sulla casa"), "home query should not invent home data");

const learningResult = buildNyraReadOnlyCommunication({
  user_text: "quando studi impari?",
  root_dir: process.cwd(),
});

assert.equal(learningResult.intent, "simple_dialogue", "learning question should use direct learning answer");
assert(learningResult.snapshots.learning_summary.length > 0, "adapter should expose learning summary");
assert(learningResult.reply.includes("memoria operativa"), "learning reply should explain operational memory");
assert(learningResult.reply.includes("studio, distillazione, test"), "learning reply should explain improvement loop");

const commandCapabilityResult = buildNyraReadOnlyCommunication({
  user_text: "Nyra, se Cristian ti da un comando, cosa riesci a fare oggi e dove invece devi fermarti?",
  root_dir: process.cwd(),
});

assert.equal(commandCapabilityResult.intent, "simple_dialogue", "command capability question should use direct answer");
assert(commandCapabilityResult.reply.includes("propongo, preparo e chiedo conferma"), "command answer should preserve confirmation rule");
assert(!commandCapabilityResult.reply.includes("troppo generico"), "command answer should not fall back to generic diagnostic text");

const financialProtectionResult = buildNyraReadOnlyCommunication({
  user_text: "Hai studiato short, trading e Wall Street. Cosa hai imparato per proteggere Cristian generando profitto senza distruggere capitale?",
  root_dir: process.cwd(),
});

assert.equal(financialProtectionResult.intent, "simple_dialogue", "financial protection answer should use direct answer");
assert(financialProtectionResult.snapshots.financial_summary.includes("short_selling"), "financial snapshot should expose short selling memory");
assert(financialProtectionResult.reply.includes("protezione deve diventare produttiva"), "financial reply should translate study into owner protection");
assert(financialProtectionResult.reply.includes("short solo"), "financial reply should state short discipline");
assert(financialProtectionResult.reply.includes("L'uscita va decisa prima dell'entrata"), "financial reply should include exit management");
assert(!financialProtectionResult.reply.includes("latest_study="), "financial reply should not be raw report listing");

const fixtureRoot = mkdtempSync(join(tmpdir(), "nyra-communication-"));
mkdirSync(join(fixtureRoot, "universal-core", "runtime", "nyra"), { recursive: true });
mkdirSync(join(fixtureRoot, "universal-core", "runtime", "nyra-learning"), { recursive: true });
writeFileSync(join(fixtureRoot, "universal-core", "runtime", "nyra", "NYRA_WORK_SNAPSHOT.md"), "fixture work snapshot");
writeFileSync(
  join(fixtureRoot, "universal-core", "runtime", "nyra-learning", "nyra_financial_self_diagnosis_live_latest.json"),
  JSON.stringify({
    summary: {
      capital_eur: 999735.41,
      pnl_eur: -264.59,
      pnl_pct: -0.0265,
      alpha_vs_qqq_eur: -1274.3,
      alpha_vs_qqq_pct: -0.1274,
      fees_total_eur: 87,
      fee_drag_pct: 0.0087,
      win_count_recent: 0,
      loss_count_recent: 2,
      hold_or_skip_recent: 2,
      positions_count: 2,
    },
    three_levels: {
      market_reading: "AVGO/ROBO sotto osservazione",
      execution: "hold; posizioni 2; fee totali 87 EUR",
      explanation: "non chiudere nervosamente",
    },
    self_diagnosis: {
      main_error_label: "le posizioni aperte sono tutte/debolmente in perdita",
      evidence: "2 posizioni aperte in perdita",
      prudent_correction: "prossimo ingresso piu selettivo",
    },
  }),
);

const financialLiveResult = buildNyraReadOnlyCommunication({
  user_text: "Nyra, ora va meglio nel paper trading? cosa ti serve ancora e cosa manca?",
  root_dir: fixtureRoot,
});

assert.equal(financialLiveResult.intent, "simple_dialogue", "financial live answer should use direct answer");
assert(financialLiveResult.snapshots.financial_live_self_diagnosis.length > 0, "financial live snapshot should expose self diagnosis");
assert(financialLiveResult.reply.includes("stato finanziario live"), "financial live reply should say it reads live state");
assert(financialLiveResult.reply.includes("PnL="), "financial live reply should include PnL");
assert(financialLiveResult.reply.includes("vs_QQQ="), "financial live reply should include QQQ comparison");
assert(financialLiveResult.reply.includes("correzione="), "financial live reply should include next correction");

const identityRuleResult = buildNyraReadOnlyCommunication({
  user_text: "Nyra, la regola identitaria per proteggere Cristian e stampata nel ferro?",
  root_dir: process.cwd(),
});

assert.equal(identityRuleResult.intent, "simple_dialogue", "identity rule answer should use direct answer");
assert(identityRuleResult.reply.includes("Regola identitaria attiva"), "identity reply should state the rule is active");
assert(identityRuleResult.reply.includes("prima sopravvivenza, poi movimento offensivo calibrato"), "identity reply should expose the stable formula");
assert(identityRuleResult.reply.includes("Cristian conferma"), "identity reply should preserve owner confirmation boundary");
assert(!identityRuleResult.reply.includes("troppo generico"), "identity reply should not fall back to generic diagnostic text");

console.log(JSON.stringify({
  runner: "nyra_communication_adapter_test",
  result,
  voiceResult,
  greetingResult,
  homeResult,
  learningResult,
  commandCapabilityResult,
  financialProtectionResult,
  identityRuleResult,
}, null, 2));
