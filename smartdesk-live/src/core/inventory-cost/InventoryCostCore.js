const INVENTORY_COST_BANDS = Object.freeze({
  REAL: "REAL",
  STANDARD: "STANDARD",
  ESTIMATED: "ESTIMATED",
  INCOMPLETE: "INCOMPLETE"
});

const AGREEMENT_BANDS = Object.freeze({
  ALIGNED: "ALIGNED",
  WATCH: "WATCH",
  DRIFT: "DRIFT",
  NA: "N/A"
});

function clamp01(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function positiveCents(value = 0) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function round(value = 0, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function legacyMaterialCost(service = {}) {
  return positiveCents(
    service.estimatedProductCostCents
    || service.productCostCents
    || service.inventoryCostAverage
    || service.materialCostCents
    || 0
  );
}

function computeServiceCoreCost(service = {}, inventoryById = new Map()) {
  const links = Array.isArray(service.productLinks) ? service.productLinks : [];
  const sourceFlags = [];
  if (!links.length) {
    const fallback = legacyMaterialCost(service);
    return {
      serviceId: String(service.id || ""),
      serviceName: service.name || "Servizio",
      coreMaterialCostCents: fallback,
      legacyMaterialCostCents: fallback,
      coverage: fallback > 0 ? 0.5 : 0,
      fallbackUsed: fallback > 0,
      confidence: fallback > 0 ? INVENTORY_COST_BANDS.ESTIMATED : INVENTORY_COST_BANDS.INCOMPLETE,
      sourceFlags: fallback > 0 ? ["inventory_cost:fallback_legacy_service_cost"] : ["inventory_cost:missing_product_links"]
    };
  }

  let total = 0;
  let usableLinks = 0;
  const breakdown = links.map((link) => {
    const product = inventoryById.get(String(link.productId || ""));
    const usageUnits = Number(link.usageUnits ?? link.quantityUsage ?? link.quantityUsed ?? 0);
    const costPerUse = positiveCents(link.costPerUseCents || product?.costPerUseCents || 0);
    const unitCost = positiveCents(link.unitCostCents || product?.unitCostCents || product?.costCents || 0);
    let costCents = 0;
    let source = "missing_cost";
    if (!product) sourceFlags.push(`inventory_cost:missing_product:${link.productId || "unknown"}`);
    if (usageUnits <= 0) sourceFlags.push(`inventory_cost:missing_usage:${link.productId || "unknown"}`);
    if (costPerUse > 0 && usageUnits > 0) {
      costCents = Math.round(costPerUse * usageUnits);
      source = "cost_per_use";
    } else if (unitCost > 0 && usageUnits > 0) {
      costCents = Math.round(unitCost * usageUnits);
      source = "unit_cost_x_usage";
    } else {
      sourceFlags.push(`inventory_cost:missing_unit_cost:${link.productId || "unknown"}`);
    }
    if (costCents > 0) usableLinks += 1;
    total += costCents;
    return {
      productId: String(link.productId || ""),
      usageUnits: Number.isFinite(usageUnits) ? usageUnits : 0,
      unitCostCents: costPerUse || unitCost,
      costCents,
      source
    };
  });

  const coverage = links.length ? usableLinks / links.length : 0;
  const confidence = coverage >= 1
    ? INVENTORY_COST_BANDS.STANDARD
    : coverage >= 0.75
      ? INVENTORY_COST_BANDS.ESTIMATED
      : INVENTORY_COST_BANDS.INCOMPLETE;
  return {
    serviceId: String(service.id || ""),
    serviceName: service.name || "Servizio",
    coreMaterialCostCents: total,
    legacyMaterialCostCents: legacyMaterialCost(service),
    coverage: clamp01(coverage),
    fallbackUsed: false,
    confidence,
    productBreakdown: breakdown,
    sourceFlags: Array.from(new Set(sourceFlags))
  };
}

function inferInventoryCostBand({ readiness = 0, coverage = 0, fallbackRatio = 0 } = {}) {
  if (readiness >= 0.9 && coverage >= 0.9 && fallbackRatio <= 0.1) return INVENTORY_COST_BANDS.REAL;
  if (readiness >= 0.75 && coverage >= 0.75 && fallbackRatio <= 0.35) return INVENTORY_COST_BANDS.STANDARD;
  if (readiness >= 0.5 && coverage >= 0.5) return INVENTORY_COST_BANDS.ESTIMATED;
  return INVENTORY_COST_BANDS.INCOMPLETE;
}

function inferAgreementBand(score = null, comparableCount = 0) {
  if (!comparableCount || !Number.isFinite(Number(score))) return AGREEMENT_BANDS.NA;
  if (score >= 0.9) return AGREEMENT_BANDS.ALIGNED;
  if (score >= 0.75) return AGREEMENT_BANDS.WATCH;
  return AGREEMENT_BANDS.DRIFT;
}

function computeInventoryCostSnapshot({ services = [], inventory = [] } = {}) {
  const activeServices = (Array.isArray(services) ? services : []).filter((service) => service.active !== false && service.active !== 0);
  const activeInventory = (Array.isArray(inventory) ? inventory : []).filter((item) => item.active !== false && item.active !== 0);
  const inventoryById = mapById(activeInventory);
  const serviceCosts = activeServices.map((service) => computeServiceCoreCost(service, inventoryById));
  const serviceCount = serviceCosts.length;
  const coveredCount = serviceCosts.filter((item) => Number(item.coverage || 0) >= 0.75).length;
  const fallbackCount = serviceCosts.filter((item) => item.fallbackUsed).length;
  const linkedServices = activeServices.filter((service) => Array.isArray(service.productLinks) && service.productLinks.length > 0).length;
  const inventoryWithCost = activeInventory.filter((item) => positiveCents(item.costPerUseCents || item.unitCostCents || item.costCents || 0) > 0).length;
  const coverage = serviceCount ? coveredCount / serviceCount : 0;
  const fallbackRatio = serviceCount ? fallbackCount / serviceCount : 0;
  const serviceLinkCoverage = serviceCount ? linkedServices / serviceCount : 0;
  const inventoryCostCoverage = activeInventory.length ? inventoryWithCost / activeInventory.length : 0;
  const readiness = clamp01(
    (coverage * 0.45)
    + (serviceLinkCoverage * 0.25)
    + (inventoryCostCoverage * 0.20)
    + ((1 - fallbackRatio) * 0.10)
  );
  const comparable = serviceCosts.filter((item) => item.coreMaterialCostCents > 0 || item.legacyMaterialCostCents > 0);
  const agreementErrors = comparable.map((item) => {
    const denominator = Math.max(1, Math.max(item.coreMaterialCostCents, item.legacyMaterialCostCents));
    return Math.min(1, Math.abs(item.coreMaterialCostCents - item.legacyMaterialCostCents) / denominator);
  });
  const meanError = agreementErrors.length
    ? agreementErrors.reduce((sum, value) => sum + value, 0) / agreementErrors.length
    : null;
  const agreementScore = meanError === null ? null : round(1 - meanError);
  const agreementBand = inferAgreementBand(agreementScore, comparable.length);
  const band = inferInventoryCostBand({ readiness, coverage, fallbackRatio });
  const warnings = [];
  if (fallbackRatio > 0.35) warnings.push("INVENTORY_COST_MASSIVE_FALLBACK");
  if (coverage < 0.75) warnings.push("INVENTORY_COST_COVERAGE_LOW");
  if (agreementBand === AGREEMENT_BANDS.DRIFT) warnings.push("INVENTORY_COST_AGREEMENT_DRIFT");
  if (!serviceCount) warnings.push("INVENTORY_COST_NO_SERVICES");

  return {
    mathCore: "inventory_cost_core_v1",
    status: "ok",
    counts: {
      services: serviceCount,
      inventory: activeInventory.length,
      coveredServices: coveredCount,
      fallbackServices: fallbackCount,
      comparableServices: comparable.length
    },
    totals: {
      coreMaterialCostCents: serviceCosts.reduce((sum, item) => sum + positiveCents(item.coreMaterialCostCents), 0),
      legacyMaterialCostCents: serviceCosts.reduce((sum, item) => sum + positiveCents(item.legacyMaterialCostCents), 0)
    },
    readiness: round(readiness),
    coverage: round(coverage),
    fallbackRatio: round(fallbackRatio),
    band,
    agreementScore,
    agreementBand,
    warnings,
    sourceFlags: [
      "inventory_cost:read_only",
      "inventory_cost:no_stock_movement",
      fallbackRatio > 0 ? "inventory_cost:fallback_available" : "inventory_cost:linked_products"
    ],
    serviceCosts
  };
}

module.exports = {
  INVENTORY_COST_BANDS,
  AGREEMENT_BANDS,
  computeInventoryCostSnapshot,
  inferInventoryCostBand,
  inferAgreementBand
};
