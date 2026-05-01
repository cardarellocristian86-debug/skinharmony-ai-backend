import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPureMathLearningRecords,
  distillPureMathLearningPack,
  loadPureMathLearningPack,
  savePureMathLearningPack,
} from "../tools/nyra-pure-math-learning-runtime.ts";

const runtimeDir = join(process.cwd(), "runtime", "nyra-learning");
const packPath = join(runtimeDir, "nyra_pure_math_learning_pack_latest.json");
const reportPath = join(process.cwd(), "reports", "universal-core", "nyra-learning", "nyra_pure_math_learning_latest.json");

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(join(process.cwd(), "reports", "universal-core", "nyra-learning"), { recursive: true });

const baseRecords = buildPureMathLearningRecords();
const repetitiveCorpus = Array.from({ length: 400 }, (_, multiplier) =>
  baseRecords.map((record) => ({
    ...record,
    record_id: `${record.record_id}:copy:${multiplier + 1}`,
    raw_text: `${record.raw_text} Ripetizione guidata pure math ${multiplier + 1}. Nyra collega definizione, prova, controesempio e struttura.`,
  })),
).flat();

const pack = distillPureMathLearningPack(repetitiveCorpus, "2026-05-01T10:30:00.000Z");
savePureMathLearningPack(packPath, pack);
const loaded = loadPureMathLearningPack(packPath);

assert(loaded.owner_scope === "god_mode_only", "pure math learning pack must stay god-mode only");
assert(loaded.storage_profile.semantic_ratio < 0.02, "pure math pack should compress much more than repetitive corpus");
assert(loaded.domains.length === 8, "all pure math domains must be present");
assert(loaded.proof_rules.length >= 5, "proof rules must be preserved");

const report = {
  runner: "nyra_pure_math_learning_test",
  records: {
    base: baseRecords.length,
    repetitive: repetitiveCorpus.length,
  },
  saved_pack_path: packPath,
  storage_profile: loaded.storage_profile,
  domains: loaded.domains,
  top_concepts: loaded.concept_graph.slice(0, 12),
  proof_rules: loaded.proof_rules,
};

writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
