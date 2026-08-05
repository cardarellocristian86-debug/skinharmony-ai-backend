import crypto from "node:crypto";
import { createSuiteClient, SuiteClientError } from "./suite-client.js";

const CREDENTIAL_KEY = /(password|secret|token|cookie|authorization|api.?key|client_secret|access_token|refresh_token)/i;
const PERSONAL_KEY = /^(email|email_address|phone|phone_number|first_name|last_name|full_name|customer_name|address|street|postal_code)$/i;
const RAW_COLLECTION_KEY = /^(customers?|contacts?|profiles?|orders?|records?|raw|raw_.*)$/i;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function safeText(value, maximum = 2_000) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum);
  return EMAIL_VALUE.test(text) ? "[redacted]" : text;
}

export function sanitizeSuiteValue(value, key = "", depth = 0) {
  if (depth > 10 || CREDENTIAL_KEY.test(key) || PERSONAL_KEY.test(key)) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return safeText(value);
  if (RAW_COLLECTION_KEY.test(key) && (Array.isArray(value) || (value && typeof value === "object"))) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 100)
      .map((item) => sanitizeSuiteValue(item, key, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const output = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 160)) {
    const sanitized = sanitizeSuiteValue(childValue, childKey, depth + 1);
    if (sanitized !== undefined) output[childKey] = sanitized;
  }
  return output;
}

function result(payload, summary) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: safeText(summary, 1_000) }],
  };
}

function normalizedCockpit(payload) {
  const sanitized = sanitizeSuiteValue(payload || {}) || {};
  return {
    ...sanitized,
    ok: sanitized.ok !== false,
    schema_version: safeText(sanitized.schema_version || "cockpit_360_summary_v1", 100),
    guardrails: {
      ...(sanitized.guardrails || {}),
      tenant_scoped: true,
      aggregate_only: true,
      read_only: true,
      execution_allowed: false,
    },
    mcp_contract: {
      schema_version: "suite_mcp_cockpit_360_v1",
      tenant_source: "authenticated_identity",
      upstream: "suite_control_plane",
      aggregate_only: true,
      execution_allowed: false,
    },
  };
}

function branchArchitecture(payload) {
  const source = payload?.branch_map || payload?.architecture || payload || {};
  return sanitizeSuiteValue(source) || {};
}

function runbookCatalog(payload) {
  const source = payload?.catalog || payload || {};
  return sanitizeSuiteValue(source) || {};
}

function publicReferenceUrl(value) {
  const url = new URL(String(value || ""));
  if (!/^https?:$/.test(url.protocol)) throw new Error("suite_web_ui_blueprint_url_scheme_not_allowed");
  // Query strings can contain identifiers or signed links.  The reference is
  // still fetched as supplied, but the Suite result never persists or echoes it.
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function referenceFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function boundedCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.min(Math.floor(count), 20_000)) : 0;
}

function boundedEntries(value, maximum, mapper) {
  return (Array.isArray(value) ? value : []).slice(0, maximum).map(mapper).filter(Boolean);
}

function oneOf(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

function safeUiStructure(value) {
  const source = value && typeof value === "object" ? value : {};
  const regions = source.layout_regions || {};
  const components = source.components || {};
  const controls = components.controls || {};
  const behavior = source.behavior_signals || {};
  const headingSource = Array.isArray(source.hierarchy?.headings) ? source.hierarchy.headings : [];
  return {
    layout_regions: Object.fromEntries(["header", "navigation", "main", "section", "article", "aside", "footer"]
      .map((key) => [key, boundedCount(regions[key])])),
    hierarchy: {
      headings: headingSource.slice(0, 6).map((entry) => ({
        level: Math.max(1, Math.min(6, boundedCount(entry?.level))),
        count: boundedCount(entry?.count),
      })).filter((entry) => entry.level > 0 && entry.count > 0),
      landmarks: boundedCount(source.hierarchy?.landmarks),
    },
    components: {
      links: boundedCount(components.links), buttons: boundedCount(components.buttons), forms: boundedCount(components.forms),
      controls: Object.fromEntries(["inputs", "textarea", "select", "buttons"].map((key) => [key, boundedCount(controls[key])])),
      dialogs: boundedCount(components.dialogs), tabs: boundedCount(components.tabs), accordions: boundedCount(components.accordions),
      tables: boundedCount(components.tables), lists: boundedCount(components.lists), cards_like: boundedCount(components.cards_like), media: boundedCount(components.media),
    },
    behavior_signals: {
      client_scripts: boundedCount(behavior.client_scripts),
      inline_forms: boundedCount(behavior.inline_forms),
      has_search: behavior.has_search === true,
      has_live_regions: behavior.has_live_regions === true,
    },
    navigation: boundedEntries(source.navigation, 24, (entry) => ({
      region: oneOf(entry?.region, ["header", "main", "footer", "aside", "other"], "other"),
      items: boundedCount(entry?.items),
      buttons: boundedCount(entry?.buttons),
      list_groups: boundedCount(entry?.list_groups),
      nested_groups: boundedCount(entry?.nested_groups),
      disclosure_controls: boundedCount(entry?.disclosure_controls),
      mobile_toggle_present: entry?.mobile_toggle_present === true,
    })),
    ctas: boundedEntries(source.ctas, 80, (entry) => ({
      kind: oneOf(entry?.kind, ["link", "button", "submit"], "button"),
      region: oneOf(entry?.region, ["header", "main", "footer", "aside", "other"], "other"),
      action: oneOf(entry?.action, ["navigation", "submit", "command"], "command"),
      target_scope: oneOf(entry?.target_scope, ["internal", "external", "fragment", "none"], "none"),
      has_accessible_name: entry?.has_accessible_name === true,
      has_icon: entry?.has_icon === true,
      disabled: entry?.disabled === true,
      text_length: Math.min(boundedCount(entry?.text_length), 500),
    })),
    page_sections: boundedEntries(source.page_sections, 60, (entry) => ({
      kind: oneOf(entry?.kind, ["header", "navigation", "main", "section", "article", "aside", "footer", "other"], "other"),
      region: oneOf(entry?.region, ["header", "main", "footer", "aside", "other"], "other"),
      heading_level: Math.min(6, boundedCount(entry?.heading_level)),
      child_sections: boundedCount(entry?.child_sections),
      links: boundedCount(entry?.links),
      buttons: boundedCount(entry?.buttons),
      media: boundedCount(entry?.media),
    })),
    forms: boundedEntries(source.forms, 24, (entry) => ({
      region: oneOf(entry?.region, ["header", "main", "footer", "aside", "other"], "other"),
      inputs: boundedCount(entry?.inputs),
      textareas: boundedCount(entry?.textareas),
      selects: boundedCount(entry?.selects),
      required_controls: boundedCount(entry?.required_controls),
      submit_controls: boundedCount(entry?.submit_controls),
      has_search: entry?.has_search === true,
    })),
    complexity: { dom_elements: boundedCount(source.complexity?.dom_elements) },
  };
}

const UI_STRUCTURE_SCRIPT = `(() => {
  const count = (selector) => Math.min(document.querySelectorAll(selector).length, 9999);
  const regionOf = (element) => {
    if (element.closest('header')) return 'header';
    if (element.closest('main')) return 'main';
    if (element.closest('footer')) return 'footer';
    if (element.closest('aside')) return 'aside';
    return 'other';
  };
  const targetScope = (element) => {
    if (element.tagName !== 'A') return 'none';
    const href = element.getAttribute('href') || '';
    if (href.startsWith('#')) return 'fragment';
    try { return new URL(href, location.href).origin === location.origin ? 'internal' : 'external'; } catch { return 'none'; }
  };
  const headings = [1, 2, 3, 4, 5, 6].map((level) => ({ level, count: count('h' + level) }))
    .filter((entry) => entry.count > 0);
  const controls = {
    inputs: count('input'), textarea: count('textarea'), select: count('select'),
    buttons: count('button, input[type="submit"], input[type="button"]'),
  };
  const navigation = [...document.querySelectorAll('nav, [role="navigation"]')].slice(0, 24).map((element) => ({
    region: regionOf(element), items: element.querySelectorAll('a[href]').length,
    buttons: element.querySelectorAll('button').length, list_groups: element.querySelectorAll('ul, ol').length,
    nested_groups: element.querySelectorAll('ul ul, ul ol, ol ul, ol ol').length,
    disclosure_controls: element.querySelectorAll('[aria-expanded], details > summary').length,
    mobile_toggle_present: Boolean(element.querySelector('button[aria-controls], [aria-label*="menu" i], [class*="hamburger" i]')),
  }));
  const ctas = [...document.querySelectorAll('a[href], button, input[type="submit"], input[type="button"]')].slice(0, 80).map((element) => {
    const isSubmit = element.matches('input[type="submit"], button[type="submit"]');
    const isLink = element.tagName === 'A';
    return {
      kind: isSubmit ? 'submit' : (isLink ? 'link' : 'button'), region: regionOf(element),
      action: isSubmit ? 'submit' : (isLink ? 'navigation' : 'command'), target_scope: targetScope(element),
      has_accessible_name: Boolean((element.getAttribute('aria-label') || '').trim() || (element.textContent || '').trim()),
      has_icon: Boolean(element.querySelector('svg, img, [role="img"]')), disabled: element.matches(':disabled, [aria-disabled="true"]'),
      text_length: Math.min(((element.textContent || element.getAttribute('value') || '').trim()).length, 500),
    };
  });
  const pageSections = [...document.querySelectorAll('header, nav, main, main section, main article, aside, footer')].slice(0, 60).map((element) => {
    const tag = element.tagName.toLowerCase();
    const heading = element.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, h1, h2, h3, h4, h5, h6');
    return {
      kind: ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer'].includes(tag) ? (tag === 'nav' ? 'navigation' : tag) : 'other',
      region: regionOf(element), heading_level: heading ? Number(heading.tagName.slice(1)) : 0,
      child_sections: element.querySelectorAll(':scope > section, :scope > article').length,
      links: element.querySelectorAll('a[href]').length, buttons: element.querySelectorAll('button, input[type="submit"], input[type="button"]').length,
      media: element.querySelectorAll('img, video, picture, svg').length,
    };
  });
  const forms = [...document.querySelectorAll('form')].slice(0, 24).map((element) => ({
    region: regionOf(element), inputs: element.querySelectorAll('input').length, textareas: element.querySelectorAll('textarea').length,
    selects: element.querySelectorAll('select').length, required_controls: element.querySelectorAll('[required], [aria-required="true"]').length,
    submit_controls: element.querySelectorAll('button[type="submit"], input[type="submit"]').length,
    has_search: Boolean(element.querySelector('input[type="search"], [role="search"]')),
  }));
  return {
    layout_regions: {
      header: count('header'), navigation: count('nav'), main: count('main'), section: count('section'),
      article: count('article'), aside: count('aside'), footer: count('footer'),
    },
    hierarchy: { headings, landmarks: count('[role="banner"], [role="navigation"], [role="main"], [role="contentinfo"]') },
    components: {
      links: count('a[href]'), buttons: controls.buttons, forms: count('form'), controls,
      dialogs: count('dialog, [role="dialog"]'), tabs: count('[role="tab"]'), accordions: count('details, [aria-expanded]'),
      tables: count('table'), lists: count('ul, ol'), cards_like: count('article, [role="article"]'),
      media: count('img, video, picture, svg'),
    },
    behavior_signals: {
      client_scripts: Math.min(document.scripts.length, 9999),
      inline_forms: count('form'), has_search: Boolean(document.querySelector('input[type="search"], [role="search"]')),
      has_live_regions: Boolean(document.querySelector('[aria-live], [role="alert"], [role="status"]')),
    },
    navigation, ctas, page_sections: pageSections, forms,
    complexity: { dom_elements: Math.min(document.getElementsByTagName('*').length, 20000) },
  };
})()`;

async function createWebUiBlueprint(browserRuntime, args, identity) {
  if (!browserRuntime?.execute) throw new Error("suite_web_ui_blueprint_browser_unavailable");
  const references = await Promise.all(args.reference_urls.map(async (url) => {
    const safeUrl = publicReferenceUrl(url);
    const runtime = await browserRuntime.execute({
      tenantId: identity.tenantId,
      url,
      actions: [],
      javascript: UI_STRUCTURE_SCRIPT,
      screenshot: false,
      waitUntil: "domcontentloaded",
    });
    const structure = safeUiStructure(runtime?.javascript);
    return {
      reference_url: safeUrl,
      origin: new URL(safeUrl).origin,
      fingerprint: referenceFingerprint({ reference_url: safeUrl, structure }),
      structure,
    };
  }));
  const ownContentSlots = (args.own_content_slots || []).map((slot) => ({
    slot_id: safeText(slot.slot_id, 80),
    kind: slot.kind,
    required: slot.required === true,
  }));
  return {
    ok: true,
    schema_version: "suite_web_ui_blueprint_v1",
    tenant_id: identity.tenantId,
    references,
    own_content_contract: {
      slots: ownContentSlots,
      accepted_asset_kinds: ["own_image", "own_logo", "own_icon", "own_video"],
      accepted_copy_kinds: ["own_heading", "own_body", "own_cta", "own_product_data"],
    },
    next_action: "Use this structure-only blueprint with first-party content and assets in a separate approved UI build request.",
    guardrails: {
      tenant_scoped: true,
      proposal_only: true,
      execution_allowed: false,
      third_party_text_copied: false,
      third_party_assets_copied: false,
      third_party_code_copied: false,
      screenshots_returned: false,
      query_and_fragment_redacted: true,
    },
  };
}

export function createSuiteHandlers(config, options = {}) {
  const client = options.client || createSuiteClient(config, options);
  return {
    suite_status: async (args, identity) => {
      const cockpit = normalizedCockpit(await client.cockpit360(identity, args.node_id));
      const status = {
        ok: true,
        schema_version: "suite_mcp_status_v1",
        source_schema_version: cockpit.schema_version,
        revision_hash: cockpit.revision_hash || "",
        generated_at: cockpit.generated_at || "",
        scope: cockpit.scope || {},
        connection: {
          node_status: cockpit.freshness?.node_status || "unknown",
          heartbeat_fresh: cockpit.freshness?.heartbeat_fresh === true,
          latest_heartbeat_at: cockpit.freshness?.latest_heartbeat_at || "",
          latest_snapshot_at: cockpit.freshness?.latest_snapshot_at || "",
          heartbeat_age_seconds: cockpit.freshness?.heartbeat_age_seconds ?? null,
        },
        readiness: {
          branches_total: cockpit.summary?.branches_total || 0,
          ready: cockpit.summary?.ready || 0,
          attention: cockpit.summary?.attention || 0,
          blocked: cockpit.summary?.blocked || 0,
          insufficient_data: cockpit.summary?.insufficient_data || 0,
          tenant_status: cockpit.summary?.tenant_readiness_status || "unknown",
          tenant_score: cockpit.summary?.tenant_readiness_score || 0,
        },
        module_coverage: cockpit.module_coverage || cockpit.summary?.module_coverage || {},
        guardrails: {
          tenant_scoped: true,
          aggregate_only: true,
          execution_allowed: false,
        },
      };
      return result(status, `Suite status: ${status.connection.node_status}; ${status.readiness.ready}/${status.readiness.branches_total} branches ready.`);
    },

    suite_cockpit_360: async (args, identity) => {
      const cockpit = normalizedCockpit(await client.cockpit360(identity, args.node_id));
      return result(cockpit, `Suite Cockpit 360 loaded at revision ${cockpit.revision_hash || "unknown"}; execution remains disabled.`);
    },

    suite_branch_catalog: async (_args, identity) => {
      const architecture = branchArchitecture(await client.branchCatalog(identity));
      const payload = {
        ok: true,
        schema_version: "suite_mcp_branch_catalog_v1",
        architecture_schema: architecture.schema || "nyra_suite_branch_architecture_v2",
        version: architecture.version || "",
        branch_count: Array.isArray(architecture.branch_keys) ? architecture.branch_keys.length : 0,
        branch_keys: Array.isArray(architecture.branch_keys) ? architecture.branch_keys : [],
        branch_groups: architecture.branch_groups || {},
        pipeline: architecture.pipeline || {},
        branches: Array.isArray(architecture.branches) ? architecture.branches : [],
        guardrails: architecture.guardrails || { execution_allowed: false, tenant_binding_required: true },
        validation: architecture.validation || {},
      };
      return result(payload, `Suite branch architecture loaded with ${payload.branch_count} tenant-scoped branches.`);
    },

    suite_branch_read: async (args, identity) => {
      const [catalogResponse, cockpitResponse] = await Promise.all([
        client.branchCatalog(identity),
        client.cockpit360(identity, args.node_id),
      ]);
      const architecture = branchArchitecture(catalogResponse);
      const cockpit = normalizedCockpit(cockpitResponse);
      const definition = (Array.isArray(architecture.branches) ? architecture.branches : [])
        .find((branch) => branch?.key === args.branch_key);
      if (!definition) throw new SuiteClientError("suite_branch_not_found", 404);
      const state = (Array.isArray(cockpit.branches) ? cockpit.branches : [])
        .find((branch) => branch?.key === args.branch_key) || null;
      const payload = {
        ok: true,
        schema_version: "suite_mcp_branch_read_v1",
        branch_key: args.branch_key,
        cockpit_revision_hash: cockpit.revision_hash || "",
        generated_at: cockpit.generated_at || "",
        definition: sanitizeSuiteValue(definition) || {},
        state: sanitizeSuiteValue(state) || {
          key: args.branch_key,
          state: "insufficient_data",
          primary_reason: "branch_state_not_available",
        },
        conflicts: (Array.isArray(cockpit.conflicts) ? cockpit.conflicts : [])
          .filter((conflict) => conflict?.winner_branch === args.branch_key || conflict?.affected_branches?.includes?.(args.branch_key)),
        guardrails: {
          tenant_scoped: true,
          aggregate_only: true,
          read_only: true,
          execution_allowed: false,
        },
      };
      return result(payload, `Suite branch ${args.branch_key}: ${payload.state.state || "unknown"}.`);
    },

    suite_decision_preview: async (args, identity) => {
      const preview = sanitizeSuiteValue(await client.decisionPreview(identity, args)) || {};
      const payload = {
        ...preview,
        ok: preview.ok !== false,
        schema_version: "suite_mcp_decision_preview_v1",
        guardrails: {
          ...(preview.guardrails || {}),
          tenant_scoped: true,
          aggregate_only: true,
          preview_only: true,
          execution_allowed: false,
        },
      };
      return result(payload, "Nyra/Core Suite decision preview completed from the server-hydrated Cockpit; no action was executed.");
    },

    suite_runbook_catalog: async (_args, identity) => {
      const catalog = runbookCatalog(await client.runbookCatalog(identity));
      const payload = {
        ...catalog,
        ok: true,
        schema_version: "suite_mcp_runbook_catalog_v1",
        runbooks: Array.isArray(catalog.runbooks) ? catalog.runbooks : [],
        execution_allowed: false,
        guardrails: {
          proposal_only: true,
          dispatch_tool_exposed: false,
          execution_allowed: false,
        },
      };
      return result(payload, `Suite runbook catalog loaded with ${payload.runbooks.length} proposal-only runbooks.`);
    },

    suite_runbook_preview: async (args, identity) => {
      const upstream = sanitizeSuiteValue(await client.runbookPreview(identity, args)) || {};
      const payload = {
        ...upstream,
        ok: upstream.ok !== false,
        schema_version: "suite_mcp_runbook_preview_v1",
        execution_allowed: false,
        guardrails: {
          preview_only: true,
          dispatch_tool_exposed: false,
          owner_confirmation_required: true,
          execution_allowed: false,
        },
      };
      return result(payload, `Suite runbook ${args.runbook_id} previewed; nothing was queued or executed.`);
    },

    suite_web_ui_blueprint: async (args, identity) => {
      const payload = await createWebUiBlueprint(options.browserRuntime, args, identity);
      return result(payload, `Suite UI blueprint prepared from ${payload.references.length} reference page(s); no third-party content or code was copied.`);
    },
  };
}

export const suiteHandlerInternals = Object.freeze({ branchArchitecture, normalizedCockpit, runbookCatalog, safeText, publicReferenceUrl, createWebUiBlueprint, safeUiStructure });
