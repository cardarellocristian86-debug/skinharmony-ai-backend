const CONFIDENCE = Object.freeze({
  REAL: "REAL",
  STANDARD: "STANDARD",
  ESTIMATED: "ESTIMATED",
  INCOMPLETE: "INCOMPLETE"
});

function cents(value = 0) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function positive(value = 0) {
  return Math.max(0, cents(value));
}

function ratio(numerator = 0, denominator = 0) {
  const den = Number(denominator || 0);
  if (!den) return null;
  return Number(numerator || 0) / den;
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function toDateOnly(value = "") {
  return String(value || "").slice(0, 10);
}

function monthKey(value = "") {
  return String(value || "").slice(0, 7) || "senza-data";
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function groupPaymentsByAppointment(payments = []) {
  const grouped = new Map();
  (Array.isArray(payments) ? payments : []).forEach((payment) => {
    const appointmentId = String(payment.appointmentId || "");
    if (!appointmentId) return;
    const rows = grouped.get(appointmentId) || [];
    rows.push(payment);
    grouped.set(appointmentId, rows);
  });
  return grouped;
}

function statusFromMargin(profitCents = 0, revenueCents = 0) {
  const pct = revenueCents > 0 ? Math.round((Number(profitCents || 0) / Number(revenueCents || 0)) * 100) : 0;
  if (Number(profitCents || 0) < 0) return "LOSS";
  if (pct < 30) return "LOW_MARGIN";
  return "HEALTHY";
}

function mergeConfidence(values = []) {
  const order = [CONFIDENCE.REAL, CONFIDENCE.STANDARD, CONFIDENCE.ESTIMATED, CONFIDENCE.INCOMPLETE];
  const indexes = values
    .filter(Boolean)
    .map((item) => order.indexOf(item))
    .filter((index) => index >= 0);
  if (!indexes.length) return CONFIDENCE.INCOMPLETE;
  return order[Math.max(...indexes)];
}

function serviceIdsForAppointment(appointment = {}) {
  const ids = Array.isArray(appointment.serviceIds)
    ? appointment.serviceIds
    : (appointment.serviceId ? [appointment.serviceId] : []);
  return ids.map((id) => String(id || "")).filter(Boolean);
}

function serviceRowsForAppointment(appointment = {}, servicesById = new Map()) {
  const ids = serviceIdsForAppointment(appointment);
  if (ids.length) {
    return ids.map((id) => {
      const service = servicesById.get(String(id)) || {};
      return {
        serviceId: String(service.id || id),
        service,
        name: service.name || appointment.serviceName || "Servizio non configurato"
      };
    });
  }
  return [{
    serviceId: String(appointment.serviceId || appointment.serviceName || "unknown"),
    service: {},
    name: appointment.serviceName || "Servizio non configurato"
  }];
}

function serviceGrossPriceCents(appointment = {}, service = {}, serviceCount = 1) {
  if (serviceCount <= 1 && Number(appointment.priceCents || 0) > 0) return positive(appointment.priceCents);
  return positive(service.priceCents || service.price || appointment.priceCents || 0);
}

function appointmentDiscountCents(appointment = {}) {
  return positive(
    appointment.discountCents
    || appointment.appointmentDiscountCents
    || appointment.totalDiscountCents
    || 0
  );
}

function allocateRevenue(appointment = {}, services = [], linkedPayments = []) {
  const grossRows = services.map((row) => ({
    ...row,
    grossRevenueCents: serviceGrossPriceCents(appointment, row.service, services.length)
  }));
  const grossTotal = grossRows.reduce((sum, row) => sum + positive(row.grossRevenueCents), 0);
  const paidTotal = linkedPayments.reduce((sum, payment) => sum + positive(payment.amountCents), 0);
  const discount = appointmentDiscountCents(appointment);
  const targetNet = paidTotal > 0 ? paidTotal : Math.max(0, grossTotal - discount);
  const denominator = grossTotal || grossRows.length || 1;
  let allocated = 0;
  return grossRows.map((row, index) => {
    const isLast = index === grossRows.length - 1;
    const share = grossTotal > 0 ? positive(row.grossRevenueCents) / denominator : 1 / denominator;
    const revenueCents = isLast ? Math.max(0, targetNet - allocated) : Math.round(targetNet * share);
    allocated += revenueCents;
    return {
      ...row,
      revenueCents,
      discountAllocatedCents: Math.max(0, positive(row.grossRevenueCents) - revenueCents),
      revenueSource: paidTotal > 0 ? "linked_payments" : discount > 0 ? "service_price_minus_discount" : "service_price"
    };
  });
}

function allocateServiceMinutes(appointment = {}, serviceRows = []) {
  const hasActualMinutes = Number(appointment.actualDurationMin || appointment.durationWorkedMin || 0) > 0;
  const appointmentMinutes = positive(appointment.actualDurationMin || appointment.durationWorkedMin || appointment.durationMin || appointment.duration || 0);
  const explicitDurations = serviceRows.map((row) => positive(row.service.actualDurationMin || row.service.durationMin || row.service.duration || 0));
  const explicitTotal = explicitDurations.reduce((sum, value) => sum + value, 0);
  const targetMinutes = appointmentMinutes || explicitTotal || 0;
  if (!serviceRows.length) return [];
  if (serviceRows.length === 1) {
    return [{ minutes: targetMinutes || explicitDurations[0] || 0, source: hasActualMinutes ? "actual_duration" : appointmentMinutes ? "appointment_duration" : explicitDurations[0] ? "service_duration" : "missing_duration" }];
  }
  if (explicitTotal > 0) {
    let allocated = 0;
    return serviceRows.map((row, index) => {
      const isLast = index === serviceRows.length - 1;
      const minutes = isLast
        ? Math.max(0, (targetMinutes || explicitTotal) - allocated)
        : Math.round((targetMinutes || explicitTotal) * (explicitDurations[index] / explicitTotal));
      allocated += minutes;
      return { minutes, source: hasActualMinutes ? "actual_duration_proportional" : "service_duration_proportional" };
    });
  }
  const even = Math.round(targetMinutes / serviceRows.length);
  return serviceRows.map((_, index) => ({
    minutes: index === serviceRows.length - 1 ? Math.max(0, targetMinutes - even * (serviceRows.length - 1)) : even,
    source: hasActualMinutes ? "actual_duration_even_split" : targetMinutes ? "appointment_duration_even_split" : "missing_duration"
  }));
}

function computeLaborForService({ appointment = {}, operator = {}, minutes = 0, allocationSource = "" }) {
  const hourlyCostCents = positive(
    appointment.operatorHourlyCostCents
    || appointment.hourlyCostCents
    || operator.hourlyCostCents
    || 0
  );
  const laborCostCents = hourlyCostCents > 0 && minutes > 0 ? Math.round((hourlyCostCents / 60) * minutes) : 0;
  const sourceFlags = [];
  if (!hourlyCostCents) sourceFlags.push("labor_cost_missing");
  if (!minutes) sourceFlags.push("labor_minutes_missing");
  if (allocationSource) sourceFlags.push(`labor_allocation:${allocationSource}`);
  const realMinutes = String(allocationSource || "").startsWith("actual_duration");
  return {
    laborCostCents,
    hourlyCostCents,
    minutes,
    sourceFlags,
    confidence: hourlyCostCents && minutes ? (realMinutes ? CONFIDENCE.REAL : CONFIDENCE.STANDARD) : CONFIDENCE.INCOMPLETE
  };
}

function computeProductBreakdown({ service = {}, appointment = {}, inventoryById = new Map(), serviceRevenueCents = 0 }) {
  const productOverrides = Array.isArray(appointment.productUsageOverrides)
    ? appointment.productUsageOverrides.filter((item) => String(item.serviceId || "") === String(service.id || "")).map((item) => ({ ...item, usageSource: "appointment_override" }))
    : [];
  const links = [
    ...(productOverrides.length ? [] : Array.isArray(service.productLinks) ? service.productLinks.map((item) => ({ ...item, usageSource: "standard_service" })) : []),
    ...productOverrides
  ];
  const rows = [];
  const sourceFlags = [];
  let fallbackCost = 0;
  if (!links.length) {
    fallbackCost = positive(service.estimatedProductCostCents || service.productCostCents || service.inventoryCostAverage || 0);
    if (fallbackCost > 0) sourceFlags.push(service.inventoryCostAverage ? "material_fallback:inventory_average" : "material_fallback:legacy_service_cost");
    return {
      materialCostCents: fallbackCost,
      productBreakdown: [],
      sourceFlags: fallbackCost ? sourceFlags : ["material_not_declared"],
      confidence: fallbackCost ? CONFIDENCE.ESTIMATED : CONFIDENCE.STANDARD
    };
  }
  links.forEach((link) => {
    const product = inventoryById.get(String(link.productId || ""));
    const usageUnits = Number(link.usageUnits ?? link.quantityUsage ?? link.quantityUsed ?? 1);
    const costPerUse = positive(link.costPerUseCents || product?.costPerUseCents || 0);
    const unitCost = positive(link.unitCostCents || product?.unitCostCents || product?.costCents || 0);
    let source = "";
    let cost = 0;
    if (costPerUse > 0) {
      cost = Math.round(costPerUse * usageUnits);
      source = "cost_per_use";
    } else if (unitCost > 0 && usageUnits > 0) {
      cost = Math.round(unitCost * usageUnits);
      source = "unit_cost_x_usage";
    } else {
      source = "missing_cost";
      sourceFlags.push(`material_missing_cost:${link.productId || "unknown"}`);
    }
    rows.push({
      productId: String(link.productId || ""),
      name: product?.name || link.productName || "Prodotto",
      usageUnits,
      unitCostCents: costPerUse || unitCost,
      costCents: cost,
      revenueAllocatedCents: links.length ? Math.round(serviceRevenueCents / links.length) : 0,
      source,
      usageSource: link.usageSource || "standard_service"
    });
  });
  const materialCostCents = rows.reduce((sum, row) => sum + positive(row.costCents), 0);
  const hasMissing = rows.some((row) => row.source === "missing_cost");
  return {
    materialCostCents,
    productBreakdown: rows,
    sourceFlags,
    confidence: hasMissing ? CONFIDENCE.INCOMPLETE : rows.some((row) => row.usageSource === "appointment_override") ? CONFIDENCE.REAL : CONFIDENCE.STANDARD
  };
}

function computeTechnologyBreakdown({ service = {}, appointment = {}, resourcesById = new Map(), serviceRevenueCents = 0 }) {
  const technologyOverrides = Array.isArray(appointment.technologyUsageOverrides)
    ? appointment.technologyUsageOverrides.filter((item) => String(item.serviceId || "") === String(service.id || "")).map((item) => ({ ...item, usageSource: "appointment_override" }))
    : [];
  const links = [
    ...(technologyOverrides.length ? [] : Array.isArray(service.technologyLinks) ? service.technologyLinks.map((item) => ({ ...item, usageSource: "standard_service" })) : []),
    ...technologyOverrides
  ];
  const rows = [];
  const sourceFlags = [];
  if (!links.length) {
    const fallbackCost = positive(service.technologyCostCents || 0);
    if (fallbackCost > 0) sourceFlags.push("technology_fallback:legacy_service_cost");
    return {
      technologyCostCents: fallbackCost,
      technologyBreakdown: [],
      sourceFlags: fallbackCost ? sourceFlags : ["technology_not_declared"],
      confidence: fallbackCost ? CONFIDENCE.ESTIMATED : CONFIDENCE.STANDARD
    };
  }
  links.forEach((link) => {
    const technology = resourcesById.get(String(link.technologyId || ""));
    const usageUnits = Number(link.usageUnits ?? link.quantityUsage ?? link.quantityUsed ?? 1);
    const costPerUseCents = positive(link.costPerUseCents || technology?.costPerUseCents || 0);
    const cost = costPerUseCents > 0 && usageUnits > 0 ? Math.round(costPerUseCents * usageUnits) : 0;
    if (!costPerUseCents) sourceFlags.push(`technology_missing_cost:${link.technologyId || "unknown"}`);
    rows.push({
      technologyId: String(link.technologyId || ""),
      name: technology?.name || link.technologyName || "Tecnologia",
      usageUnits,
      costPerUseCents,
      costCents: cost,
      revenueAllocatedCents: links.length ? Math.round(serviceRevenueCents / links.length) : 0,
      source: costPerUseCents ? "cost_per_use_x_usage" : "missing_cost",
      usageSource: link.usageSource || "standard_service"
    });
  });
  const technologyCostCents = rows.reduce((sum, row) => sum + positive(row.costCents), 0);
  const hasMissing = rows.some((row) => row.source === "missing_cost");
  return {
    technologyCostCents,
    technologyBreakdown: rows,
    sourceFlags,
    confidence: hasMissing ? CONFIDENCE.INCOMPLETE : rows.some((row) => row.usageSource === "appointment_override") ? CONFIDENCE.REAL : CONFIDENCE.STANDARD
  };
}

function inferProfitabilityConfidence(parts = {}) {
  const sourceFlags = Array.isArray(parts.sourceFlags) ? parts.sourceFlags : [];
  if (sourceFlags.some((flag) => String(flag).includes("fallback"))) return CONFIDENCE.ESTIMATED;
  if (sourceFlags.some((flag) => String(flag).includes("missing"))) return CONFIDENCE.INCOMPLETE;
  const base = mergeConfidence([parts.laborConfidence, parts.materialConfidence, parts.technologyConfidence]);
  if (base === CONFIDENCE.INCOMPLETE && parts.revenueCents > 0 && parts.directCostCents > 0) return CONFIDENCE.STANDARD;
  return base;
}

function buildProfitabilityBreakdown(parts = {}) {
  const revenueCents = positive(parts.revenueCents);
  const laborCostCents = positive(parts.laborCostCents);
  const materialCostCents = positive(parts.materialCostCents);
  const technologyCostCents = positive(parts.technologyCostCents);
  const directCostCents = laborCostCents + materialCostCents + technologyCostCents;
  const grossMarginCents = revenueCents - directCostCents;
  const grossMarginPct = ratio(grossMarginCents, revenueCents);
  const sourceFlags = Array.from(new Set(Array.isArray(parts.sourceFlags) ? parts.sourceFlags.filter(Boolean) : []));
  return {
    revenueCents,
    laborCostCents,
    materialCostCents,
    technologyCostCents,
    directCostCents,
    grossMarginCents,
    grossMarginPct,
    confidence: parts.confidence || inferProfitabilityConfidence({ ...parts, sourceFlags, directCostCents, revenueCents }),
    sourceFlags,
    serviceBreakdown: Array.isArray(parts.serviceBreakdown) ? parts.serviceBreakdown : [],
    productBreakdown: Array.isArray(parts.productBreakdown) ? parts.productBreakdown : [],
    technologyBreakdown: Array.isArray(parts.technologyBreakdown) ? parts.technologyBreakdown : []
  };
}

function computeServiceProfitability({
  appointment = {},
  serviceRow = {},
  operator = {},
  inventoryById = new Map(),
  resourcesById = new Map(),
  allocatedMinutes = 0,
  laborAllocationSource = ""
} = {}) {
  const service = serviceRow.service || {};
  const labor = computeLaborForService({ appointment, operator, minutes: allocatedMinutes, allocationSource: laborAllocationSource });
  const products = computeProductBreakdown({ service, appointment, inventoryById, serviceRevenueCents: serviceRow.revenueCents });
  const technologies = computeTechnologyBreakdown({ service, appointment, resourcesById, serviceRevenueCents: serviceRow.revenueCents });
  const sourceFlags = [
    `revenue_source:${serviceRow.revenueSource || "unknown"}`,
    ...labor.sourceFlags,
    ...products.sourceFlags,
    ...technologies.sourceFlags
  ];
  const confidence = inferProfitabilityConfidence({
    revenueCents: serviceRow.revenueCents,
    laborConfidence: labor.confidence,
    materialConfidence: products.confidence,
    technologyConfidence: technologies.confidence,
    sourceFlags
  });
  return buildProfitabilityBreakdown({
    serviceId: serviceRow.serviceId,
    revenueCents: serviceRow.revenueCents,
    laborCostCents: labor.laborCostCents,
    materialCostCents: products.materialCostCents,
    technologyCostCents: technologies.technologyCostCents,
    confidence,
    sourceFlags,
    serviceBreakdown: [{
      serviceId: serviceRow.serviceId,
      name: serviceRow.name,
      revenueCents: serviceRow.revenueCents,
      grossRevenueCents: serviceRow.grossRevenueCents,
      discountAllocatedCents: serviceRow.discountAllocatedCents,
      laborMinutes: labor.minutes,
      laborAllocationSource,
      laborCostCents: labor.laborCostCents,
      materialCostCents: products.materialCostCents,
      technologyCostCents: technologies.technologyCostCents
    }],
    productBreakdown: products.productBreakdown,
    technologyBreakdown: technologies.technologyBreakdown
  });
}

function computeAppointmentProfitability({
  appointment = {},
  servicesById = new Map(),
  staffById = new Map(),
  inventoryById = new Map(),
  resourcesById = new Map(),
  linkedPayments = []
} = {}) {
  const operator = staffById.get(String(appointment.staffId || "")) || {};
  const serviceRows = serviceRowsForAppointment(appointment, servicesById);
  const revenueRows = allocateRevenue(appointment, serviceRows, linkedPayments);
  const minuteRows = allocateServiceMinutes(appointment, revenueRows);
  const serviceBreakdowns = revenueRows.map((serviceRow, index) => computeServiceProfitability({
    appointment,
    serviceRow,
    operator,
    inventoryById,
    resourcesById,
    allocatedMinutes: minuteRows[index]?.minutes || 0,
    laborAllocationSource: minuteRows[index]?.source || ""
  }));
  const sourceFlags = serviceBreakdowns.flatMap((item) => item.sourceFlags || []);
  return buildProfitabilityBreakdown({
    revenueCents: serviceBreakdowns.reduce((sum, item) => sum + positive(item.revenueCents), 0),
    laborCostCents: serviceBreakdowns.reduce((sum, item) => sum + positive(item.laborCostCents), 0),
    materialCostCents: serviceBreakdowns.reduce((sum, item) => sum + positive(item.materialCostCents), 0),
    technologyCostCents: serviceBreakdowns.reduce((sum, item) => sum + positive(item.technologyCostCents), 0),
    confidence: mergeConfidence(serviceBreakdowns.map((item) => item.confidence)),
    sourceFlags,
    serviceBreakdown: serviceBreakdowns.flatMap((item) => item.serviceBreakdown || []),
    productBreakdown: serviceBreakdowns.flatMap((item) => item.productBreakdown || []),
    technologyBreakdown: serviceBreakdowns.flatMap((item) => item.technologyBreakdown || [])
  });
}

function addAggregate(map, key, seed, delta) {
  const current = map.get(String(key)) || { ...seed };
  Object.entries(delta).forEach(([field, value]) => {
    current[field] = Number(current[field] || 0) + Number(value || 0);
  });
  map.set(String(key), current);
  return current;
}

function finalizeRows(rows = []) {
  return rows.map((item) => {
    const marginPercent = item.revenueCents > 0 ? Math.round((item.profitCents / item.revenueCents) * 100) : 0;
    return {
      ...item,
      averageRevenueCents: item.executions ? Math.round(Number(item.revenueCents || 0) / item.executions) : Number(item.averageRevenueCents || 0),
      averageCostCents: item.executions ? Math.round(Number(item.costCents || 0) / item.executions) : Number(item.averageCostCents || 0),
      marginPercent,
      status: statusFromMargin(item.profitCents, item.revenueCents)
    };
  }).sort((a, b) => a.marginPercent - b.marginPercent);
}

function computeCenterProfitabilitySnapshot({
  appointments = [],
  services = [],
  staff = [],
  payments = [],
  inventory = [],
  resources = []
} = {}) {
  const servicesById = mapById(services);
  const staffById = mapById(staff);
  const inventoryById = mapById(inventory);
  const resourcesById = mapById(resources);
  const paymentsByAppointmentId = groupPaymentsByAppointment(payments);
  const serviceMap = new Map();
  const productMap = new Map();
  const technologyMap = new Map();
  const monthlyMap = new Map();
  const appointmentBreakdowns = [];

  (Array.isArray(appointments) ? appointments : []).forEach((appointment) => {
    const breakdown = computeAppointmentProfitability({
      appointment,
      servicesById,
      staffById,
      inventoryById,
      resourcesById,
      linkedPayments: paymentsByAppointmentId.get(String(appointment.id || "")) || []
    });
    appointmentBreakdowns.push({ appointmentId: appointment.id || "", ...breakdown });
    breakdown.serviceBreakdown.forEach((service) => {
      const seed = {
        id: service.serviceId || "unknown",
        name: service.name || "Servizio non configurato",
        executions: 0,
        revenueCents: 0,
        costCents: 0,
        profitCents: 0,
        laborCostCents: 0,
        materialCostCents: 0,
        technologyCostCents: 0,
        confidence: breakdown.confidence,
        sourceFlags: []
      };
      const current = addAggregate(serviceMap, seed.id, seed, {
        executions: 1,
        revenueCents: service.revenueCents,
        costCents: service.laborCostCents + service.materialCostCents + service.technologyCostCents,
        profitCents: service.revenueCents - service.laborCostCents - service.materialCostCents - service.technologyCostCents,
        laborCostCents: service.laborCostCents,
        materialCostCents: service.materialCostCents,
        technologyCostCents: service.technologyCostCents
      });
      current.confidence = mergeConfidence([current.confidence, breakdown.confidence]);
      current.sourceFlags = Array.from(new Set([...(current.sourceFlags || []), ...(breakdown.sourceFlags || [])]));
    });
    breakdown.productBreakdown.forEach((product) => {
      const seed = {
        id: product.productId || "unknown",
        name: product.name || "Prodotto",
        totalUses: 0,
        costConsumedCents: 0,
        revenueCents: 0,
        profitCents: 0,
        marginPercent: 0,
        status: "HEALTHY"
      };
      addAggregate(productMap, seed.id, seed, {
        totalUses: product.usageUnits,
        costConsumedCents: product.costCents,
        revenueCents: product.revenueAllocatedCents,
        profitCents: product.revenueAllocatedCents - product.costCents
      });
    });
    breakdown.technologyBreakdown.forEach((technology) => {
      const resource = resourcesById.get(String(technology.technologyId || "")) || {};
      const seed = {
        id: technology.technologyId || "unknown",
        name: technology.name || "Tecnologia",
        totalUses: 0,
        monthlyCostCents: positive(resource.monthlyCostCents || 0),
        revenueCents: 0,
        costCents: 0,
        profitCents: 0,
        marginPercent: 0,
        status: "HEALTHY"
      };
      addAggregate(technologyMap, seed.id, seed, {
        totalUses: technology.usageUnits,
        revenueCents: technology.revenueAllocatedCents,
        costCents: technology.costCents,
        profitCents: technology.revenueAllocatedCents - technology.costCents
      });
    });
    const month = monthKey(appointment.startAt || appointment.createdAt);
    addAggregate(monthlyMap, month, {
      month,
      executions: 0,
      revenueCents: 0,
      costCents: 0,
      profitCents: 0,
      marginPercent: 0,
      deltaRevenueCents: 0,
      signal: "stable"
    }, {
      executions: 1,
      revenueCents: breakdown.revenueCents,
      costCents: breakdown.directCostCents,
      profitCents: breakdown.grossMarginCents
    });
  });

  const serviceRows = finalizeRows(Array.from(serviceMap.values()));
  const productRows = finalizeRows(Array.from(productMap.values()));
  const technologyRows = finalizeRows(Array.from(technologyMap.values()));
  const totals = serviceRows.reduce((summary, item) => ({
    executions: summary.executions + Number(item.executions || 0),
    revenueCents: summary.revenueCents + Number(item.revenueCents || 0),
    costCents: summary.costCents + Number(item.costCents || 0),
    profitCents: summary.profitCents + Number(item.profitCents || 0)
  }), { executions: 0, revenueCents: 0, costCents: 0, profitCents: 0 });
  const monthlyTrend = Array.from(monthlyMap.values())
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .map((item, index, rows) => {
      const marginPercent = item.revenueCents > 0 ? Math.round((item.profitCents / item.revenueCents) * 100) : 0;
      const previous = rows[index - 1];
      const deltaRevenueCents = previous ? item.revenueCents - Number(previous.revenueCents || 0) : 0;
      const signal = deltaRevenueCents <= -300000 ? "drop" : deltaRevenueCents >= 300000 ? "growth" : "stable";
      return { ...item, marginPercent, deltaRevenueCents, signal };
    });
  const alerts = serviceRows
    .filter((item) => item.status !== "HEALTHY")
    .map((item) => ({
      area: "servizi",
      level: item.status === "LOSS" ? "critical" : "warning",
      title: item.status === "LOSS" ? `${item.name} lavora in perdita` : `${item.name} ha margine basso`,
      body: item.status === "LOSS"
        ? "Controlla prezzo, durata, costo operatore e prodotti usati prima di proporlo ancora."
        : "Il servizio rende poco rispetto al ricavo: verifica durata reale e consumo prodotti.",
      serviceId: item.id
    }));
  return {
    totals,
    services: serviceRows,
    products: productRows,
    technologies: technologyRows,
    monthlyTrend,
    alerts,
    appointmentBreakdowns,
    revenueCents: totals.revenueCents,
    inventoryCostCents: totals.costCents,
    meta: {
      engine: "profitability_core_v1",
      confidence: mergeConfidence(appointmentBreakdowns.map((item) => item.confidence)),
      sourceFlags: Array.from(new Set(appointmentBreakdowns.flatMap((item) => item.sourceFlags || [])))
    }
  };
}

module.exports = {
  CONFIDENCE,
  computeAppointmentProfitability,
  computeServiceProfitability,
  computeCenterProfitabilitySnapshot,
  buildProfitabilityBreakdown,
  inferProfitabilityConfidence
};
