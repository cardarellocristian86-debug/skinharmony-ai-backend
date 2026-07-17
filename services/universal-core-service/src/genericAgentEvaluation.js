function requireText(value, field, max = 240) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function normalizeCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 200) throw new Error("evaluation_cases_invalid");
  return cases.map((item) => ({
    id: requireText(item?.id, "evaluation_case_id"),
    expected: item?.expected && typeof item.expected === "object" && !Array.isArray(item.expected) ? item.expected : {},
    actual: item?.actual && typeof item.actual === "object" && !Array.isArray(item.actual) ? item.actual : {},
    weight: Number.isFinite(Number(item?.weight)) && Number(item.weight) > 0 ? Number(item.weight) : 1,
  }));
}

export function evaluateGenericAgentRun(cases) {
  const normalized = normalizeCases(cases);
  let weightedScore = 0;
  let totalWeight = 0;
  const results = normalized.map((item) => {
    const assertions = Object.entries(item.expected);
    const passed = assertions.filter(([key, value]) => JSON.stringify(item.actual[key]) === JSON.stringify(value));
    const score = assertions.length === 0 ? 1 : passed.length / assertions.length;
    weightedScore += score * item.weight;
    totalWeight += item.weight;
    return {
      id: item.id,
      score,
      passed_assertions: passed.map(([key]) => key),
      failed_assertions: assertions.filter(([key, value]) => JSON.stringify(item.actual[key]) !== JSON.stringify(value)).map(([key]) => key),
    };
  });
  return {
    schema_version: "generic_agent_evaluation_v1",
    case_count: results.length,
    score: totalWeight ? Number((weightedScore / totalWeight).toFixed(4)) : 0,
    passed: results.every((result) => result.score === 1),
    results,
  };
}
