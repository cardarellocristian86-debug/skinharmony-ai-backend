use anyhow::{Context, Result};
use globset::Glob;
use ignore::WalkBuilder;
use regex::Regex;
use scraper::{Html, Selector};
use skinharmony_classifier::{classify, secret_penalty, technical_penalty, ClassificationInput};
use skinharmony_core_math::{logistic_translatability, quality_score, text_features};
use skinharmony_translator_contract::{
    extract_placeholders, normalize_text, semantic_id, stable_id, CatalogSegment, Occurrence, Origin,
    SegmentContext, Span, Stage, TranslatorState,
};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ExtractOptions {
    pub source_lang: String,
    pub target_lang: String,
    pub min_confidence: f64,
    pub min_quality: f64,
    pub scan_bundles: bool,
    pub use_sourcemaps: bool,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub max_file_bytes: u64,
    pub max_files: usize,
}

impl Default for ExtractOptions {
    fn default() -> Self {
        Self {
            source_lang: "en".into(),
            target_lang: "it".into(),
            min_confidence: 0.62,
            min_quality: 0.58,
            scan_bundles: false,
            use_sourcemaps: false,
            include: vec![],
            exclude: vec![],
            max_file_bytes: 750_000,
            max_files: 5_000,
        }
    }
}

#[derive(Debug, Clone)]
struct Candidate {
    text: String,
    file: String,
    line: usize,
    column: usize,
    span: Span,
    format: String,
    origin: Origin,
    context: SegmentContext,
    key_hint: String,
}

#[derive(Debug, Clone, Copy)]
struct CandidateSource<'a> {
    file: &'a str,
    ext: &'a str,
    origin: Origin,
    attribute: Option<&'a str>,
}

impl<'a> CandidateSource<'a> {
    fn new(file: &'a str, ext: &'a str, origin: Origin, attribute: Option<&'a str>) -> Self {
        Self {
            file,
            ext,
            origin,
            attribute,
        }
    }
}

pub fn extract_path(path: &Path, options: &ExtractOptions) -> Result<Vec<CatalogSegment>> {
    let mut segments = Vec::new();
    let files = collect_files(path, options);
    for file in files {
        let mut extracted =
            extract_file(path, &file, options).with_context(|| format!("extracting {}", file.display()))?;
        segments.append(&mut extracted);
    }
    Ok(segments)
}

fn collect_files(path: &Path, options: &ExtractOptions) -> Vec<PathBuf> {
    if path.is_file() {
        let root = path.parent().unwrap_or_else(|| Path::new("."));
        return if path_allowed(root, path, options) {
            vec![path.to_path_buf()]
        } else {
            vec![]
        };
    }
    WalkBuilder::new(path)
        .hidden(false)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !matches!(
                name.as_ref(),
                "node_modules" | "dist" | "build" | ".git" | "vendor" | "target"
            )
        })
        .build()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_some_and(|kind| kind.is_file()))
        .map(|entry| entry.into_path())
        .filter(|file| supported_extension(file).is_some())
        .filter(|file| path_allowed(path, file, options))
        .take(options.max_files)
        .collect()
}

fn path_allowed(root: &Path, file: &Path, options: &ExtractOptions) -> bool {
    if file
        .metadata()
        .ok()
        .is_some_and(|metadata| metadata.len() > options.max_file_bytes)
    {
        return false;
    }
    let rel = file.strip_prefix(root).unwrap_or(file).to_string_lossy();
    let rel = rel.as_ref();
    if !options.include.is_empty() && !matches_any_path_pattern(rel, &options.include) {
        return false;
    }
    if matches_any_path_pattern(rel, &options.exclude) {
        return false;
    }
    true
}

fn matches_any_path_pattern(path: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|pattern| {
        path.contains(pattern)
            || pattern
                .strip_prefix("**/*")
                .is_some_and(|suffix| path.ends_with(suffix))
            || Glob::new(pattern)
                .ok()
                .is_some_and(|glob| glob.compile_matcher().is_match(path))
    })
}

fn extract_file(root: &Path, file: &Path, options: &ExtractOptions) -> Result<Vec<CatalogSegment>> {
    let content = fs::read_to_string(file)?;
    let ext = supported_extension(file).unwrap_or_default();
    let rel = file
        .strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .to_string();
    let mut candidates = match ext {
        "html" | "htm" => extract_html(&content, &rel, ext),
        "json" | "jsonc" => extract_json(&content, &rel, ext),
        "yaml" | "yml" => extract_yaml(&content, &rel, ext),
        "css" | "scss" | "less" => extract_css(&content, &rel, ext),
        "xml" | "xlf" | "xliff" | "resx" => extract_xml_like(&content, &rel, ext),
        "csv" => extract_csv(&content, &rel, ext),
        "ini" | "properties" | "strings" | "po" | "pot" | "ftl" => {
            extract_resource_lines(&content, &rel, ext)
        }
        "js" | "ts" | "jsx" | "tsx" | "php" | "vue" | "md" | "mdx" => {
            extract_source_literals(&content, &rel, ext)
        }
        _ => Vec::new(),
    };
    if options.scan_bundles && matches!(ext, "js" | "css") {
        candidates.extend(
            extract_source_literals(&content, &rel, ext)
                .into_iter()
                .map(|mut candidate| {
                    candidate.origin = Origin::Bundle;
                    candidate
                }),
        );
    }
    Ok(candidates
        .into_iter()
        .filter_map(|candidate| govern_candidate(candidate, options))
        .collect())
}

fn govern_candidate(candidate: Candidate, options: &ExtractOptions) -> Option<CatalogSegment> {
    let normalized = normalize_text(&candidate.text);
    if is_low_signal(&normalized) || secret_penalty(&normalized) >= 1.0 {
        return None;
    }
    let placeholders = extract_placeholders(&normalized).into_iter().collect::<Vec<_>>();
    let classification = classify(&ClassificationInput {
        text: &normalized,
        key: &candidate.key_hint,
        path: &candidate.file,
        attribute: candidate.context.attribute.as_deref(),
        origin: origin_name(candidate.origin),
    });
    if classification.secret_penalty >= 1.0 || classification.technical_penalty >= 1.0 {
        return None;
    }
    let features = text_features(
        &normalized,
        placeholders.len(),
        classification.visibility.score,
        classification.category_confidence,
        classification.technical_penalty,
        classification.secret_penalty,
    );
    let translatability = logistic_translatability(&[0.08; 24], &features, 0.1);
    let mut quality = quality_score(&features);
    if is_operational_bridge_copy(&candidate.file, &candidate.key_hint, &normalized) {
        quality = quality.max(options.min_quality);
    }
    if translatability < options.min_confidence || quality < options.min_quality {
        return None;
    }
    let key = build_key(&candidate.file, candidate.line, &normalized);
    let id = stable_id("skinharmony", &candidate.file, &key, &candidate.span, &normalized);
    let semantic_id = semantic_id("skinharmony", &key, &normalized, classification.category);
    let stage = if translatability >= 0.78 && quality >= 0.72 {
        Stage::V2
    } else if translatability >= 0.68 {
        Stage::V1
    } else {
        Stage::V0
    };
    let occurrence = Occurrence {
        file: candidate.file.clone(),
        line: candidate.line,
        column: candidate.column,
    };
    Some(CatalogSegment {
        key,
        id,
        semantic_id,
        source_text: candidate.text,
        normalized_text: normalized,
        source_lang: options.source_lang.clone(),
        target_lang: options.target_lang.clone(),
        file: candidate.file.clone(),
        line: candidate.line,
        column: candidate.column,
        span: candidate.span,
        format: candidate.format,
        origin: candidate.origin,
        stage,
        category: classification.category,
        category_confidence: classification.category_confidence,
        context: candidate.context,
        placeholders,
        risk: classification.risk,
        radar: classification.radar,
        visibility: classification.visibility,
        confidence: translatability,
        quality_score: quality,
        suggested_target: None,
        translator: TranslatorState::default(),
        warnings: Vec::new(),
        occurrences: vec![occurrence],
    })
}

fn extract_html(content: &str, file: &str, ext: &str) -> Vec<Candidate> {
    let html = Html::parse_document(content);
    let mut candidates = Vec::new();
    for selector_text in [
        "title",
        "meta[name='description']",
        "button",
        "a",
        "label",
        "option",
        "p",
        "h1",
        "h2",
        "h3",
        "span",
    ] {
        if let Ok(selector) = Selector::parse(selector_text) {
            for element in html.select(&selector) {
                let text = if selector_text.starts_with("meta") {
                    element.value().attr("content").unwrap_or_default().to_string()
                } else {
                    element.text().collect::<Vec<_>>().join(" ")
                };
                push_text_candidate(
                    &mut candidates,
                    content,
                    &text,
                    0,
                    CandidateSource::new(file, ext, Origin::Html, Some(selector_text)),
                );
            }
        }
    }
    for attr in [
        "alt",
        "aria-label",
        "aria-description",
        "placeholder",
        "title",
        "value",
    ] {
        let pattern = Regex::new(&format!(r#"{attr}\s*=\s*["']([^"']+)["']"#)).expect("attribute regex");
        for captures in pattern.captures_iter(content) {
            if let Some(found) = captures.get(1) {
                push_text_candidate(
                    &mut candidates,
                    content,
                    found.as_str(),
                    found.start(),
                    CandidateSource::new(file, ext, Origin::Html, Some(attr)),
                );
            }
        }
    }
    candidates
}

fn extract_json(content: &str, file: &str, ext: &str) -> Vec<Candidate> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return extract_source_literals(content, file, ext);
    };
    let mut candidates = Vec::new();
    visit_json(&value, "$", content, file, ext, &mut candidates);
    candidates
}

fn visit_json(
    value: &serde_json::Value,
    path: &str,
    content: &str,
    file: &str,
    ext: &str,
    out: &mut Vec<Candidate>,
) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                let next_path = format!("{path}.{key}");
                if is_user_facing_key(key) {
                    if let Some(text) = child.as_str() {
                        push_text_candidate(
                            out,
                            content,
                            text,
                            0,
                            CandidateSource::new(file, ext, Origin::Json, Some(&next_path)),
                        );
                    }
                }
                visit_json(child, &next_path, content, file, ext, out);
            }
        }
        serde_json::Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                visit_json(child, &format!("{path}[{index}]"), content, file, ext, out);
            }
        }
        _ => {}
    }
}

fn extract_yaml(content: &str, file: &str, ext: &str) -> Vec<Candidate> {
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(content) else {
        return extract_resource_lines(content, file, ext);
    };
    let json = serde_json::to_value(value).unwrap_or(serde_json::Value::Null);
    let mut candidates = Vec::new();
    visit_json(&json, "$", content, file, ext, &mut candidates);
    candidates
}

fn extract_css(content: &str, file: &str, ext: &str) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    let pattern = Regex::new(r#"content\s*:\s*["']([^"']+)["']"#).expect("css content regex");
    for captures in pattern.captures_iter(content) {
        if let Some(found) = captures.get(1) {
            push_text_candidate(
                &mut candidates,
                content,
                found.as_str(),
                found.start(),
                CandidateSource::new(file, ext, Origin::Css, Some("content")),
            );
        }
    }
    candidates
}

fn extract_xml_like(content: &str, file: &str, ext: &str) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    let pattern = Regex::new(r#">([^<>{}][^<>]{1,260})<"#).expect("xml text regex");
    for captures in pattern.captures_iter(content) {
        if let Some(found) = captures.get(1) {
            push_text_candidate(
                &mut candidates,
                content,
                found.as_str(),
                found.start(),
                CandidateSource::new(file, ext, Origin::Resource, None),
            );
        }
    }
    candidates
}

fn extract_csv(content: &str, file: &str, ext: &str) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    let mut reader = csv::Reader::from_reader(content.as_bytes());
    for record in reader.records().flatten() {
        for value in &record {
            push_text_candidate(
                &mut candidates,
                content,
                value,
                0,
                CandidateSource::new(file, ext, Origin::Resource, Some("csv")),
            );
        }
    }
    candidates
}

fn extract_resource_lines(content: &str, file: &str, ext: &str) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    for (index, line) in content.lines().enumerate() {
        let value = line
            .split_once('=')
            .map_or(line, |(_, right)| right)
            .trim()
            .trim_matches('"');
        push_text_candidate_at_line(
            &mut candidates,
            value,
            index + 1,
            CandidateSource::new(file, ext, Origin::Resource, Some("resource")),
        );
    }
    candidates
}

fn extract_source_literals(content: &str, file: &str, ext: &str) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    let technical_prefix = Regex::new(r"(import|require|from|className|href|src|data-testid)\s*[:=]?\s*$")
        .expect("technical prefix regex");
    for pattern in [
        r#""((?:\\.|[^"\\\n]){2,260})""#,
        r#"'((?:\\.|[^'\\\n]){2,260})'"#,
        r#"`((?:\\.|[^`\\\n]){2,260})`"#,
    ] {
        let string_pattern = Regex::new(pattern).expect("source literal regex");
        for captures in string_pattern.captures_iter(content) {
            let Some(found) = captures.get(1) else {
                continue;
            };
            let before = safe_prefix(content, found.start(), 80);
            if technical_prefix.is_match(before) {
                continue;
            }
            let origin = if ["js", "ts", "jsx", "tsx", "php", "vue"].contains(&ext) {
                Origin::Source
            } else {
                Origin::Generated
            };
            push_text_candidate(
                &mut candidates,
                content,
                found.as_str(),
                found.start(),
                CandidateSource::new(file, ext, origin, Some("string_literal")),
            );
        }
    }
    let html_text = Regex::new(r#">\s*([^<>{}\n][^<>{}]{1,240}?)\s*<"#).expect("jsx text regex");
    for captures in html_text.captures_iter(content) {
        if let Some(found) = captures.get(1) {
            push_text_candidate(
                &mut candidates,
                content,
                found.as_str(),
                found.start(),
                CandidateSource::new(file, ext, Origin::Source, Some("jsx_text")),
            );
        }
    }
    candidates
}

fn push_text_candidate(
    out: &mut Vec<Candidate>,
    content: &str,
    text: &str,
    byte_index: usize,
    source: CandidateSource<'_>,
) {
    let safe_index = previous_char_boundary(content, byte_index.min(content.len()));
    let prefix = &content[..safe_index];
    let line = prefix.lines().count().max(1);
    let column = safe_index.saturating_sub(prefix.rfind('\n').unwrap_or(0));
    push_candidate(out, text, line, column, byte_index, source);
}

fn safe_prefix(content: &str, byte_index: usize, max_len: usize) -> &str {
    let end = previous_char_boundary(content, byte_index.min(content.len()));
    let mut start = end.saturating_sub(max_len);
    while start < end && !content.is_char_boundary(start) {
        start += 1;
    }
    &content[start..end]
}

fn previous_char_boundary(content: &str, mut index: usize) -> usize {
    index = index.min(content.len());
    while index > 0 && !content.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn push_text_candidate_at_line(
    out: &mut Vec<Candidate>,
    text: &str,
    line: usize,
    source: CandidateSource<'_>,
) {
    push_candidate(out, text, line, 1, 0, source);
}

fn push_candidate(
    out: &mut Vec<Candidate>,
    text: &str,
    line: usize,
    column: usize,
    start: usize,
    source: CandidateSource<'_>,
) {
    let normalized = normalize_text(text);
    if is_low_signal(&normalized) {
        return;
    }
    out.push(Candidate {
        text: normalized.clone(),
        file: source.file.to_string(),
        line,
        column,
        span: Span {
            start,
            end: start + normalized.len(),
        },
        format: source.ext.to_string(),
        origin: source.origin,
        context: SegmentContext {
            attribute: source.attribute.map(str::to_string),
            ..SegmentContext::default()
        },
        key_hint: source.attribute.unwrap_or("text").to_string(),
    });
}

fn is_user_facing_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    matches!(
        lower.as_str(),
        "message"
            | "error"
            | "error_message"
            | "title"
            | "description"
            | "label"
            | "subtitle"
            | "body"
            | "copy"
            | "cta"
            | "help"
            | "tooltip"
            | "validation"
            | "onboarding"
            | "pricing"
            | "payment"
            | "legal"
            | "privacy"
            | "support"
            | "placeholder"
            | "alt"
            | "aria-label"
    ) || [
        "message",
        "error",
        "hint",
        "label",
        "title",
        "copy",
        "text",
        "cta",
        "button",
        "placeholder",
        "safe_mode",
        "permission",
        "residue",
        "language",
        "lang",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn is_low_signal(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.len() < 2
        || trimmed.len() > 300
        || !trimmed.chars().any(char::is_alphabetic)
        || technical_penalty(trimmed) >= 1.0
        || is_internal_helper_copy(trimmed)
        || looks_like_static_person_or_tenant_name(trimmed)
        || looks_like_code_fragment(trimmed)
        || looks_like_translation_key(trimmed)
        || looks_like_css_utility_list(trimmed)
}

fn is_operational_bridge_copy(file: &str, key_hint: &str, text: &str) -> bool {
    let lower = format!("{file} {key_hint} {text}").to_lowercase();
    lower.contains("gold-bridge")
        || lower.contains("operational engine")
        || lower.contains("lettura operativa")
        || lower.contains("segnali da leggere")
}

fn is_internal_helper_copy(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("route tecnico")
        || lower.contains("non catalogare")
        || lower.contains("debug only")
        || lower.contains("internal only")
}

fn looks_like_static_person_or_tenant_name(text: &str) -> bool {
    let words = text.split_whitespace().collect::<Vec<_>>();
    if words.len() != 2 {
        return false;
    }
    let lower = text.to_lowercase();
    if [
        "apri", "open", "mostra", "agenda", "smart", "ai", "gold", "salva", "save", "conferma", "confirm",
    ]
    .iter()
    .any(|word| lower.contains(word))
    {
        return false;
    }
    words.iter().all(|word| {
        let mut chars = word.chars();
        chars.next().is_some_and(char::is_uppercase)
            && chars
                .all(|ch| ch.is_lowercase() || matches!(ch, '\'' | '-' | 'à' | 'è' | 'é' | 'ì' | 'ò' | 'ù'))
    })
}

fn looks_like_code_fragment(text: &str) -> bool {
    let lower = text.to_lowercase();
    let syntax_count = text
        .chars()
        .filter(|ch| {
            matches!(
                ch,
                '{' | '}' | '[' | ']' | '(' | ')' | ';' | '=' | '<' | '>' | '&' | '|'
            )
        })
        .count();
    let has_code_operator = lower.contains("=>")
        || lower.contains("===")
        || lower.contains("!==")
        || lower.contains("&&")
        || lower.contains("||")
        || lower.contains("?.")
        || lower.contains("return ")
        || lower.contains("function ")
        || lower.contains("const ")
        || lower.contains("let ")
        || lower.contains("var ")
        || lower.contains("json.stringify")
        || lower.contains("usememo")
        || lower.contains("usestate");
    let has_many_tokens_without_sentence_shape =
        text.split_whitespace().count() >= 8 && syntax_count >= 4 && !text.ends_with(['.', '!', '?']);
    has_code_operator || has_many_tokens_without_sentence_shape
}

fn looks_like_translation_key(text: &str) -> bool {
    if text.contains(' ') || text.len() > 96 {
        return false;
    }
    let parts = text.split('.').collect::<Vec<_>>();
    parts.len() >= 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        })
        && parts
            .iter()
            .filter(|part| {
                part.chars()
                    .any(|ch| ch == '_' || ch == '-' || ch.is_ascii_lowercase())
            })
            .count()
            >= 2
}

fn looks_like_css_utility_list(text: &str) -> bool {
    let words = text.split_whitespace().collect::<Vec<_>>();
    if words.len() < 3 {
        return false;
    }
    let utility_count = words.iter().filter(|word| looks_like_css_utility(word)).count();
    utility_count >= 3 && utility_count * 2 >= words.len()
}

fn looks_like_css_utility(word: &str) -> bool {
    let lower = word
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | '`' | ',' | ';'))
        .to_lowercase();
    let utility_prefixes = [
        "absolute",
        "relative",
        "fixed",
        "flex",
        "grid",
        "hidden",
        "block",
        "inline",
        "items-",
        "justify-",
        "content-",
        "gap-",
        "space-",
        "p-",
        "px-",
        "py-",
        "pt-",
        "pr-",
        "pb-",
        "pl-",
        "m-",
        "mx-",
        "my-",
        "mt-",
        "mr-",
        "mb-",
        "ml-",
        "w-",
        "h-",
        "min-",
        "max-",
        "text-",
        "font-",
        "leading-",
        "tracking-",
        "bg-",
        "border",
        "rounded",
        "shadow",
        "opacity-",
        "z-",
        "overflow-",
        "transition",
        "duration-",
        "ease-",
        "hover:",
        "focus:",
        "md:",
        "lg:",
        "xl:",
    ];
    utility_prefixes.iter().any(|prefix| {
        lower == *prefix
            || lower.strip_prefix(prefix).is_some_and(|rest| {
                rest.is_empty()
                    || rest.starts_with('[')
                    || rest.starts_with('-')
                    || (prefix.ends_with('-') && !rest.is_empty())
            })
    })
}

fn supported_extension(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "js" => Some("js"),
        "ts" => Some("ts"),
        "jsx" => Some("jsx"),
        "tsx" => Some("tsx"),
        "html" => Some("html"),
        "htm" => Some("htm"),
        "json" => Some("json"),
        "jsonc" => Some("jsonc"),
        "php" => Some("php"),
        "css" => Some("css"),
        "scss" => Some("scss"),
        "less" => Some("less"),
        "vue" => Some("vue"),
        "md" => Some("md"),
        "mdx" => Some("mdx"),
        "yaml" => Some("yaml"),
        "yml" => Some("yml"),
        "xml" => Some("xml"),
        "po" => Some("po"),
        "pot" => Some("pot"),
        "xlf" => Some("xlf"),
        "xliff" => Some("xliff"),
        "properties" => Some("properties"),
        "resx" => Some("resx"),
        "strings" => Some("strings"),
        "csv" => Some("csv"),
        "ini" => Some("ini"),
        "ftl" => Some("ftl"),
        _ => None,
    }
}

fn build_key(file: &str, line: usize, text: &str) -> String {
    let slug = file
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '.'
            }
        })
        .collect::<String>()
        .split('.')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".");
    let text_slug = text
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .take(16)
        .collect::<String>()
        .to_lowercase();
    format!("{slug}.{line}.{text_slug}")
}

fn origin_name(origin: Origin) -> &'static str {
    match origin {
        Origin::Source => "source",
        Origin::Bundle => "bundle",
        Origin::Html => "html",
        Origin::Json => "json",
        Origin::Api => "api",
        Origin::Css => "css",
        Origin::Generated => "generated",
        Origin::Resource => "resource",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use skinharmony_translator_contract::Category;

    #[test]
    fn extracts_html_visible_text_and_attributes() {
        let segments = extract_html(
            r#"<title>Hello</title><button aria-label="Save now">Start trial</button><input placeholder="Email">"#,
            "index.html",
            "html",
        );
        assert!(segments.iter().any(|item| item.text.contains("Start trial")));
        assert!(segments.iter().any(|item| item.text.contains("Email")));
    }

    #[test]
    fn extracts_json_api_messages() {
        let segments = extract_json(
            r#"{"error_message":"Invalid required field","id":"abc"}"#,
            "api.json",
            "json",
        );
        assert_eq!(segments.len(), 1);
        let governed = govern_candidate(segments[0].clone(), &ExtractOptions::default()).expect("candidate");
        assert_eq!(governed.category, Category::Errors);
    }

    #[test]
    fn rejects_noise_and_secrets() {
        let options = ExtractOptions::default();
        assert!(govern_candidate(
            Candidate {
                text: "https://example.com".into(),
                file: "a.ts".into(),
                line: 1,
                column: 1,
                span: Span { start: 0, end: 1 },
                format: "ts".into(),
                origin: Origin::Source,
                context: SegmentContext::default(),
                key_hint: "url".into(),
            },
            &options,
        )
        .is_none());
        assert!(govern_candidate(
            Candidate {
                text: "api_key = secret".into(),
                file: "a.ts".into(),
                line: 1,
                column: 1,
                span: Span { start: 0, end: 1 },
                format: "ts".into(),
                origin: Origin::Source,
                context: SegmentContext::default(),
                key_hint: "secret".into(),
            },
            &options,
        )
        .is_none());
    }

    #[test]
    fn extracts_tsx_button_copy_and_css_content() {
        let tsx = extract_source_literals(r#"<button>Upgrade now</button>"#, "App.tsx", "tsx");
        assert!(tsx.iter().any(|item| item.text.contains("Upgrade now")));
        let css = extract_css(r#".x::before{content:"Required field"}"#, "style.css", "css");
        assert!(css.iter().any(|item| item.text.contains("Required field")));
    }

    #[test]
    fn source_literal_extractor_rejects_code_fragments() {
        let source = r#"
            const label = "Save customer";
            const bad = "return items.filter((item) => item.enabled && item.name !== '')";
        "#;
        let segments = extract_source_literals(source, "App.tsx", "tsx");
        assert!(segments.iter().any(|item| item.text == "Save customer"));
        assert!(!segments.iter().any(|item| item.text.contains("items.filter")));
    }

    #[test]
    fn rejects_css_utilities_and_translation_keys() {
        assert!(is_low_signal(
            "row gap-8 rounded-2xl bg-white shadow-lg px-4 py-3"
        ));
        assert!(is_low_signal("appointments.quickClientError"));
        assert!(!is_low_signal("Open customer record"));
    }
}
