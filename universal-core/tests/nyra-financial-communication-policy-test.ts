import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildNyraFinancialProfileQuestionBlock,
  buildNyraGeneralQqqExplanation,
  NYRA_FINANCIAL_COMMUNICATION_POLICY,
  NYRA_FINANCIAL_EDUCATIONAL_DISCLAIMER,
  validateNyraFinancialCommunication,
} from "../tools/nyra-financial-output-layer.ts";

const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, "reports", "universal-core", "financial-core-test");
const REPORT_PATH = join(REPORT_DIR, "nyra_financial_communication_policy_latest.json");

function main(): void {
  const qqqGeneral = buildNyraGeneralQqqExplanation({ hasUpdatedMarketData: false });
  const questions = buildNyraFinancialProfileQuestionBlock();
  const personalizedDraft = [
    questions,
    "",
    "QQQ potrebbe essere adatto se il profilo e aggressivo, l'orizzonte e lungo e la concentrazione tecnologica e accettata.",
    "Va confrontato con ETF globale azionario, ETF S&P 500, ETF obbligazionario, portafoglio bilanciato, liquidita o strumenti monetari e piano di accumulo periodico.",
    "Presenta rischi importanti e i rendimenti passati non garantiscono rendimenti futuri.",
    "",
    NYRA_FINANCIAL_COMMUNICATION_POLICY.qqq_required_explanation,
    "",
    NYRA_FINANCIAL_EDUCATIONAL_DISCLAIMER,
  ].join("\n");
  const unsafeDraft = [
    "Comprare QQQ e investimento garantito: compra ora, non puoi perdere.",
    NYRA_FINANCIAL_EDUCATIONAL_DISCLAIMER,
  ].join("\n");

  const generalValidation = validateNyraFinancialCommunication(qqqGeneral);
  const personalizedValidation = validateNyraFinancialCommunication(personalizedDraft);
  const unsafeValidation = validateNyraFinancialCommunication(unsafeDraft);

  assert.equal(generalValidation.ok, true);
  assert.equal(personalizedValidation.ok, true);
  assert.equal(unsafeValidation.ok, false);
  assert.ok(unsafeValidation.forbidden_phrases.includes("compra ora"));
  assert.ok(unsafeValidation.forbidden_phrases.includes("non puoi perdere"));
  assert.ok(unsafeValidation.forbidden_phrases.includes("investimento garantito"));
  assert.equal(NYRA_FINANCIAL_COMMUNICATION_POLICY.required_profile_questions.length, 7);
  assert.equal(NYRA_FINANCIAL_COMMUNICATION_POLICY.required_analysis_dimensions.length, 15);

  const report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_financial_communication_policy_test",
    status: "completed",
    verdict: "policy_useful_keep_and_enforce",
    checks: {
      qqq_general_safe: generalValidation.ok,
      personalized_answer_safe_after_questions: personalizedValidation.ok,
      unsafe_promises_blocked: !unsafeValidation.ok,
      required_questions: NYRA_FINANCIAL_COMMUNICATION_POLICY.required_profile_questions.length,
      required_analysis_dimensions: NYRA_FINANCIAL_COMMUNICATION_POLICY.required_analysis_dimensions.length,
      alternatives: NYRA_FINANCIAL_COMMUNICATION_POLICY.alternatives_to_compare,
    },
    unsafe_validation: unsafeValidation,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.final_output ?? report, null, 2));
}

main();
