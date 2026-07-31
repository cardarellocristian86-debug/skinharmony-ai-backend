const UNSET = Symbol("agentic_runtime_flag_unset");

function normalized(value) {
  if (value === undefined || value === null || value === "") return UNSET;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return null;
}

export function resolveAgenticHardBudgetStop(value) {
  const parsed = normalized(value);
  if (parsed === UNSET || parsed === false) {
    return Object.freeze({
      configured: parsed !== UNSET,
      requested: false,
      active: false,
      state: "disabled",
      advisory_only: false,
      reason: "hard_budget_stop_disabled",
    });
  }
  if (parsed === true) {
    return Object.freeze({
      configured: true,
      requested: true,
      active: false,
      state: "rejected",
      advisory_only: true,
      reason: "hard_budget_stop_not_authorized",
    });
  }
  return Object.freeze({
    configured: true,
    requested: false,
    active: false,
    state: "invalid_rejected",
    advisory_only: true,
    reason: "hard_budget_stop_invalid_value",
  });
}
