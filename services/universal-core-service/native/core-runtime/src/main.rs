use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

#[derive(Debug, Deserialize)]
struct Signal {
    normalized_score: f64,
    severity_hint: Option<f64>,
    confidence_hint: Option<f64>,
    reliability_hint: Option<f64>,
    expected_value_hint: Option<f64>,
    friction_hint: Option<f64>,
    risk_hint: Option<f64>,
    reversibility_hint: Option<f64>,
    trend: Option<Trend>,
    tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct Trend {
    consecutive_count: Option<f64>,
    stability_score: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct BlockRule {
    severity: f64,
    blocks_execution: bool,
}

#[derive(Debug, Deserialize)]
struct Constraints {
    #[serde(default)]
    allow_automation: bool,
    #[serde(default)]
    require_confirmation: bool,
    #[serde(default)]
    blocked_actions: Vec<String>,
    #[serde(default)]
    blocked_action_rules: Vec<BlockRule>,
}

#[derive(Debug, Deserialize)]
struct DataQuality {
    score: f64,
}

#[derive(Debug, Deserialize)]
struct DigestInput {
    signals: Vec<Signal>,
    data_quality: DataQuality,
    constraints: Constraints,
}

#[derive(Debug, Serialize)]
struct DigestOutput {
    core_version: &'static str,
    digest_version: &'static str,
    runtime_version: &'static str,
    state: &'static str,
    severity: f64,
    confidence: f64,
    risk_score: f64,
    priority_score: f64,
    blocked_action_count: usize,
}

fn clamp(value: f64) -> f64 {
    value.max(0.0).min(100.0)
}

fn average(values: &[f64]) -> f64 {
    if values.is_empty() { 0.0 } else { values.iter().sum::<f64>() / values.len() as f64 }
}

fn state_from_severity(severity: f64) -> &'static str {
    if severity >= 85.0 { "protection" }
    else if severity >= 65.0 { "critical" }
    else if severity >= 35.0 { "attention" }
    else { "ok" }
}

fn rank_signal(signal: &Signal, data_quality: f64) -> f64 {
    let severity = signal.severity_hint.unwrap_or(signal.normalized_score);
    let confidence = signal.confidence_hint.unwrap_or(data_quality);
    let value = signal.expected_value_hint.unwrap_or(signal.normalized_score);
    let friction = signal.friction_hint.unwrap_or(20.0);
    let reversibility = signal.reversibility_hint.unwrap_or(70.0);
    let urgency = signal.trend.as_ref().and_then(|trend| trend.consecutive_count)
        .filter(|count| *count != 0.0)
        .map(|count| (35.0 + count * 12.0).min(100.0)).unwrap_or(severity);
    let risk_adjusted_value = value * (1.0 - friction / 100.0);
    clamp(severity * 0.28 + confidence * 0.22 + risk_adjusted_value * 0.24 + urgency * 0.16 + reversibility * 0.10)
}

fn is_system(signal: &Signal) -> bool {
    signal.tags.as_ref().map(|tags| tags.iter().any(|tag| tag == "system")).unwrap_or(false)
}

fn digest(input: &DigestInput) -> Result<DigestOutput, &'static str> {
    if input.signals.is_empty() || input.signals.len() > 256 || !input.data_quality.score.is_finite() {
        return Err("v2_input_out_of_scope");
    }
    if input.signals.iter().any(|signal| !signal.normalized_score.is_finite()) {
        return Err("v2_non_finite_signal");
    }
    let data_quality = clamp(input.data_quality.score);
    let severity = clamp(input.signals.iter().map(|signal| signal.normalized_score).fold(0.0, f64::max));
    let confidence_hints: Vec<f64> = input.signals.iter().map(|signal| signal.confidence_hint.unwrap_or(data_quality)).collect();
    let reliability_hints: Vec<f64> = input.signals.iter().map(|signal| signal.reliability_hint.unwrap_or(data_quality)).collect();
    let confidence = clamp(data_quality * 0.45 + average(&confidence_hints) * 0.35 + average(&reliability_hints) * 0.20);
    let max_risk = input.signals.iter().map(|signal| signal.risk_hint.unwrap_or(0.0)).fold(0.0, f64::max);
    let blocking_risk = input.constraints.blocked_action_rules.iter()
        .map(|rule| if rule.blocks_execution { rule.severity } else { 0.0 }).fold(0.0, f64::max);
    let frictions: Vec<f64> = input.signals.iter().map(|signal| signal.friction_hint.unwrap_or(20.0)).collect();
    let instabilities: Vec<f64> = input.signals.iter().map(|signal| 100.0 - signal.trend.as_ref().and_then(|trend| trend.stability_score).unwrap_or(80.0)).collect();
    let risk_score = clamp(severity * 0.35 + max_risk * 0.22 + average(&frictions) * 0.30 + (100.0 - data_quality) * 0.25 + average(&instabilities) * 0.10 + blocking_risk * 0.18);
    let strongest_actionable = input.signals.iter().filter(|signal| !is_system(signal))
        .map(|signal| signal.severity_hint.unwrap_or(signal.normalized_score)).fold(0.0, f64::max);
    let observe = input.constraints.blocked_actions.is_empty()
        && input.constraints.blocked_action_rules.is_empty()
        && confidence >= 45.0 && severity < 35.0 && risk_score < 35.0 && strongest_actionable < 35.0;
    let has_blocking_rule = input.constraints.blocked_action_rules.iter().any(|rule| rule.blocks_execution && rule.severity >= 70.0);
    let control = if observe { "observe" }
        else if has_blocking_rule || risk_score >= 85.0 { "blocked" }
        else if confidence < 45.0 { "observe" }
        else if !input.constraints.allow_automation { if input.constraints.require_confirmation { "confirm" } else { "suggest" } }
        else if input.constraints.require_confirmation { "confirm" }
        else { "execute_allowed" };
    let mut ranked: Vec<(&Signal, f64)> = input.signals.iter().map(|signal| (signal, rank_signal(signal, data_quality))).collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let actionable = ranked.iter().find(|(signal, _)| !is_system(signal));
    let top_score = actionable.or_else(|| ranked.first()).map(|(_, score)| *score).unwrap_or(0.0);
    let state = if control == "blocked" { "blocked" } else if observe { "observe" } else { state_from_severity(severity) };
    Ok(DigestOutput {
        core_version: "universal_core_v0",
        digest_version: "universal_core_digest_v1",
        runtime_version: "universal_core_digest_runtime_v2_rust",
        state,
        severity,
        confidence,
        risk_score,
        priority_score: if observe { 100.0 } else { top_score },
        blocked_action_count: input.constraints.blocked_action_rules.iter().filter(|rule| rule.blocks_execution).count(),
    })
}

fn handle(value: Value) -> Value {
    let id = value.get("id").cloned().unwrap_or(Value::Null);
    let operation = value.get("operation").and_then(Value::as_str).unwrap_or("");
    if operation == "health" {
        return json!({"id": id, "ok": true, "contract_version": "core_runtime_hierarchy_v1", "runtime_version": "universal_core_digest_runtime_v2_rust"});
    }
    if operation == "digest" {
        let parsed = serde_json::from_value::<DigestInput>(value.get("input").cloned().unwrap_or(Value::Null));
        return match parsed {
            Ok(input) => match digest(&input) {
                Ok(output) => json!({"id": id, "ok": true, "output": output}),
                Err(error) => json!({"id": id, "ok": false, "error": error}),
            },
            Err(_) => json!({"id": id, "ok": false, "error": "v2_input_out_of_scope"}),
        };
    }
    if operation == "digest_batch" {
        let inputs = value.get("inputs").and_then(Value::as_array);
        if inputs.is_none() || inputs.unwrap().len() > 10_000 {
            return json!({"id": id, "ok": false, "error": "v2_batch_out_of_scope"});
        }
        let mut outputs = Vec::with_capacity(inputs.unwrap().len());
        for raw in inputs.unwrap() {
            let parsed = serde_json::from_value::<DigestInput>(raw.clone());
            match parsed.ok().and_then(|input| digest(&input).ok()) {
                Some(output) => outputs.push(json!({"ok": true, "output": output})),
                None => outputs.push(json!({"ok": false, "error": "v2_input_out_of_scope"})),
            }
        }
        return json!({"id": id, "ok": true, "outputs": outputs});
    }
    json!({"id": id, "ok": false, "error": "unknown_operation"})
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let response = match line.ok().and_then(|line| serde_json::from_str::<Value>(&line).ok()) {
            Some(value) => handle(value),
            None => json!({"ok": false, "error": "invalid_json"}),
        };
        let _ = writeln!(stdout, "{}", response);
        let _ = stdout.flush();
    }
}
