use regex::Regex;
use skinharmony_core_math::{radar_score, risk_score, visibility_score, RiskVector};
use skinharmony_translator_contract::{
    Category, RadarInfo, RadarLevel, RiskInfo, RiskLevel, VisibilityInfo, VisibilityLevel,
};

#[derive(Debug, Clone)]
pub struct ClassificationInput<'a> {
    pub text: &'a str,
    pub key: &'a str,
    pub path: &'a str,
    pub attribute: Option<&'a str>,
    pub origin: &'a str,
}

#[derive(Debug, Clone)]
pub struct Classification {
    pub category: Category,
    pub category_confidence: f64,
    pub risk: RiskInfo,
    pub radar: RadarInfo,
    pub visibility: VisibilityInfo,
    pub technical_penalty: f64,
    pub secret_penalty: f64,
    pub low_signal_penalty: f64,
}

pub fn classify(input: &ClassificationInput<'_>) -> Classification {
    let haystack = format!(
        "{} {} {} {} {}",
        input.text,
        input.key,
        input.path,
        input.attribute.unwrap_or_default(),
        input.origin
    )
    .to_lowercase();

    let category_scores = [
        (
            Category::Cta,
            score(
                &haystack,
                &[
                    "button",
                    "submit",
                    "buy",
                    "start",
                    "continue",
                    "save",
                    "upgrade",
                    "subscribe",
                    "trial",
                    "checkout",
                    "apri",
                    "salva",
                    "conferma",
                ],
            ),
        ),
        (
            Category::Navigation,
            score(
                &haystack,
                &[
                    "nav",
                    "menu",
                    "breadcrumb",
                    "tab",
                    "sidebar",
                    "footer",
                    "header",
                    "route",
                ],
            ),
        ),
        (
            Category::Errors,
            score(
                &haystack,
                &[
                    "error",
                    "validation",
                    "failed",
                    "invalid",
                    "required",
                    "unavailable",
                    "not found",
                    "warning",
                    "errore",
                    "mancano",
                ],
            ),
        ),
        (
            Category::OnboardingTrial,
            score(
                &haystack,
                &[
                    "welcome",
                    "setup",
                    "trial",
                    "get started",
                    "first step",
                    "tutorial",
                    "guided",
                    "login",
                    "registr",
                ],
            ),
        ),
        (
            Category::AiGoldCopy,
            score(
                &haystack,
                &[
                    "ai",
                    "generate",
                    "smart",
                    "recommendation",
                    "gold",
                    "premium intelligence",
                    "assistant",
                    "automation",
                    "nyra",
                    "core",
                ],
            ),
        ),
        (
            Category::DataQuality,
            score(
                &haystack,
                &[
                    "quality",
                    "missing data",
                    "invalid data",
                    "sync",
                    "duplicate",
                    "cleanup",
                    "import",
                    "export",
                    "dati",
                ],
            ),
        ),
        (
            Category::PricingPayment,
            score(
                &haystack,
                &[
                    "price",
                    "plan",
                    "checkout",
                    "payment",
                    "invoice",
                    "subscription",
                    "billing",
                    "vat",
                    "tax",
                    "refund",
                    "prezzo",
                    "pagamento",
                    "margine",
                ],
            ),
        ),
        (
            Category::LegalPrivacy,
            score(
                &haystack,
                &[
                    "privacy",
                    "terms",
                    "consent",
                    "cookie",
                    "gdpr",
                    "policy",
                    "legal",
                    "data processing",
                    "consenso",
                ],
            ),
        ),
        (
            Category::AdminSupport,
            score(
                &haystack,
                &[
                    "admin",
                    "support",
                    "ticket",
                    "help desk",
                    "operator",
                    "staff",
                    "permissions",
                    "role",
                    "utente",
                ],
            ),
        ),
        (Category::GenericUiCopy, 0.12),
    ];

    let (category, raw_confidence) = category_scores
        .iter()
        .max_by(|left, right| left.1.partial_cmp(&right.1).unwrap_or(std::cmp::Ordering::Equal))
        .copied()
        .unwrap_or((Category::GenericUiCopy, 0.12));
    let category_confidence = raw_confidence.clamp(0.35, 0.95);

    let secret_penalty = secret_penalty(input.text);
    let technical_penalty = technical_penalty(input.text);
    let low_signal_penalty = low_signal_penalty(input.text);
    let visibility = build_visibility(&haystack, input.attribute, input.origin);
    let risk = build_risk(category, input.text, input.origin);
    let radar = build_radar(category, visibility.score, risk.score);

    Classification {
        category,
        category_confidence,
        risk,
        radar,
        visibility,
        technical_penalty,
        secret_penalty,
        low_signal_penalty,
    }
}

fn score(haystack: &str, terms: &[&str]) -> f64 {
    let hits = terms.iter().filter(|term| haystack.contains(**term)).count() as f64;
    (hits / 3.0).min(0.95)
}

fn build_visibility(haystack: &str, attribute: Option<&str>, origin: &str) -> VisibilityInfo {
    let attr_visible = matches!(
        attribute,
        Some("placeholder" | "aria-label" | "alt" | "title" | "value")
    );
    let cta_likely = haystack.contains("button") || haystack.contains("cta") || haystack.contains("submit");
    let navigation_likely = haystack.contains("nav") || haystack.contains("menu") || haystack.contains("tab");
    let api_likely = origin == "json" || haystack.contains("message") || haystack.contains("error");
    let runtime_likely =
        haystack.contains("toast") || haystack.contains("notification") || haystack.contains("modal");
    let internal_penalty =
        haystack.contains("debug") || haystack.contains("logger") || haystack.contains("trace");
    let score = visibility_score(
        if origin == "html" { 1.0 } else { 0.6 },
        if attr_visible { 1.0 } else { 0.0 },
        if runtime_likely { 1.0 } else { 0.2 },
        if api_likely { 0.9 } else { 0.0 },
        if navigation_likely { 1.0 } else { 0.0 },
        if cta_likely { 1.0 } else { 0.0 },
        if internal_penalty { 1.0 } else { 0.0 },
    );
    let level = if score >= 0.82 {
        VisibilityLevel::CriticalVisible
    } else if score >= 0.55 {
        VisibilityLevel::Visible
    } else if score >= 0.25 {
        VisibilityLevel::Maybe
    } else {
        VisibilityLevel::Invisible
    };
    VisibilityInfo {
        level,
        score,
        reasons: vec![format!("origin:{origin}")],
    }
}

fn build_risk(category: Category, text: &str, origin: &str) -> RiskInfo {
    let lower = text.to_lowercase();
    let legal = matches!(category, Category::LegalPrivacy) as u8 as f64;
    let payment = matches!(category, Category::PricingPayment) as u8 as f64;
    let privacy = lower.contains("privacy") as u8 as f64;
    let beauty_claim =
        Regex::new(r"(?i)\b(cura|guarisce|terapia|medicale|risultato garantito|guaranteed result)\b")
            .expect("claim regex")
            .is_match(text) as u8 as f64;
    let admin = matches!(category, Category::AdminSupport) as u8 as f64;
    let bundle = (origin == "bundle") as u8 as f64;
    let missing_context = (origin == "bundle") as u8 as f64 * 0.5;
    let placeholder = Regex::new(r"\{[^}]+\}|%[sdif]|\$\{[^}]+}")
        .expect("placeholder risk regex")
        .is_match(text) as u8 as f64
        * 0.3;
    let mut score = risk_score(RiskVector {
        placeholder,
        legal,
        payment,
        privacy,
        medical_beauty_claim: beauty_claim,
        admin_danger: admin,
        bundle_context: bundle,
        missing_context,
    });
    if matches!(category, Category::LegalPrivacy) {
        score = score.max(0.62);
    }
    if matches!(category, Category::PricingPayment) {
        score = score.max(0.56);
    }
    if matches!(category, Category::Errors)
        && ["payment", "subscription", "checkout", "required", "renewed"]
            .iter()
            .any(|term| lower.contains(term))
    {
        score = score.max(0.52);
    }
    let level = if score >= 0.78 {
        RiskLevel::Block
    } else if score >= 0.52 {
        RiskLevel::High
    } else if score >= 0.24 {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    };
    RiskInfo {
        level,
        score,
        reasons: risk_reasons(category, beauty_claim > 0.0, origin),
    }
}

fn build_radar(category: Category, visibility: f64, risk: f64) -> RadarInfo {
    let conversion = matches!(category, Category::Cta | Category::PricingPayment) as u8 as f64;
    let payment = matches!(category, Category::PricingPayment) as u8 as f64;
    let legal = matches!(category, Category::LegalPrivacy) as u8 as f64;
    let onboarding = matches!(category, Category::OnboardingTrial) as u8 as f64;
    let error = matches!(category, Category::Errors) as u8 as f64;
    let brand = matches!(category, Category::AiGoldCopy) as u8 as f64;
    let mut score =
        radar_score(visibility, conversion, payment, legal, onboarding, error, brand).max(risk * 0.8);
    if matches!(category, Category::AiGoldCopy) {
        score = score.max(0.56);
    }
    let level = if score >= 0.78 {
        RadarLevel::Critical
    } else if score >= 0.52 {
        RadarLevel::Important
    } else if score >= 0.18 {
        RadarLevel::Normal
    } else {
        RadarLevel::Silent
    };
    RadarInfo {
        level,
        score,
        reasons: vec![format!("category:{category:?}")],
    }
}

fn risk_reasons(category: Category, claim: bool, origin: &str) -> Vec<String> {
    let mut reasons = vec![format!("category:{category:?}")];
    if claim {
        reasons.push("medical_beauty_claim".to_string());
    }
    if origin == "bundle" {
        reasons.push("bundle_context".to_string());
    }
    reasons
}

pub fn secret_penalty(text: &str) -> f64 {
    let patterns = [
        r"(?i)api[_-]?key\s*[:=]",
        r"(?i)secret\s*[:=]",
        r"(?i)token\s*[:=]",
        r"eyJ[a-zA-Z0-9_-]{20,}\.",
        r"-----BEGIN [A-Z ]+PRIVATE KEY-----",
        r"[A-Za-z0-9+/]{80,}={0,2}",
    ];
    if patterns
        .iter()
        .any(|pattern| Regex::new(pattern).expect("secret regex").is_match(text))
    {
        1.0
    } else {
        0.0
    }
}

pub fn technical_penalty(text: &str) -> f64 {
    let patterns = [
        r"^https?://",
        r"^[a-f0-9]{32,}$",
        r"^[0-9a-fA-F-]{36}$",
        r"^\d+(\.\d+){1,3}$",
        r"^[a-z0-9_./:-]+$",
        r"^[A-Z0-9_]{3,}$",
    ];
    if patterns.iter().any(|pattern| {
        Regex::new(pattern)
            .expect("technical regex")
            .is_match(text.trim())
    }) {
        1.0
    } else {
        0.0
    }
}

pub fn low_signal_penalty(text: &str) -> f64 {
    let trimmed = text.trim();
    if trimmed.len() < 2 || trimmed.len() > 300 || !trimmed.chars().any(char::is_alphabetic) {
        return 1.0;
    }
    0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classification_detects_required_categories() {
        let cases = [
            ("Start free trial", Category::Cta),
            ("Invalid required field", Category::Errors),
            ("Privacy consent required", Category::LegalPrivacy),
            ("Gold AI recommendation", Category::AiGoldCopy),
            ("Subscription price", Category::PricingPayment),
        ];
        for (text, expected) in cases {
            let result = classify(&ClassificationInput {
                text,
                key: text,
                path: "src/App.tsx",
                attribute: None,
                origin: "source",
            });
            assert_eq!(result.category, expected);
        }
    }

    #[test]
    fn ai_gold_copy_is_at_least_important_radar() {
        let result = classify(&ClassificationInput {
            text: "AI Gold ha letto il centro. Prima priorità: apri servizi/operatori.",
            key: "gold_hint",
            path: "smartdesk/AiGoldPanel.tsx",
            attribute: Some("message"),
            origin: "json",
        });
        assert_eq!(result.category, Category::AiGoldCopy);
        assert!(matches!(
            result.radar.level,
            RadarLevel::Important | RadarLevel::Critical
        ));
    }

    #[test]
    fn secret_and_technical_noise_are_detected() {
        assert_eq!(secret_penalty("api_key = abc"), 1.0);
        assert_eq!(technical_penalty("https://example.com"), 1.0);
    }
}
