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

const NON_REVENUE_APPOINTMENT_STATUSES = new Set([
  "cancelled",
  "canceled",
  "no_show",
  "no-show",
  "noshow",
  "deleted",
  "void",
  "voided",
  "annullato",
  "annullata",
  "mancato",
  "non_presentato"
]);

function isNonRevenueAppointmentStatus(appointment = {}) {
  const status = normalizeText(appointment.status || appointment.appointmentStatus || "");
  return NON_REVENUE_APPOINTMENT_STATUSES.has(status);
}

function shouldIncludeAppointmentInProfitability(appointment = {}, linkedPayments = []) {
  return !isNonRevenueAppointmentStatus(appointment)
    || (Array.isArray(linkedPayments) && linkedPayments.some((payment) => positive(payment.amountCents) > 0));
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

function retailPaymentTotalCents(payment = {}) {
  return (Array.isArray(payment.productSales) ? payment.productSales : [])
    .reduce((sum, line) =>
      sum + positive(line.salePriceCents || line.priceCents) * Math.max(0, Number(line.quantity || 0)), 0
    );
}

function servicePaymentRevenueCents(linkedPayments = []) {
  return (Array.isArray(linkedPayments) ? linkedPayments : []).reduce((sum, payment) => {
    const retailTotal = retailPaymentTotalCents(payment);
    const paymentAmount = positive(payment.amountCents);
    if (paymentAmount > 0) return sum + Math.max(0, paymentAmount - retailTotal);
    const explicitServiceTotal = (Array.isArray(payment.serviceLines) ? payment.serviceLines : [])
      .reduce((lineSum, line) => lineSum + positive(line.salePriceCents || line.amountCents || line.priceCents), 0);
    return sum + explicitServiceTotal;
  }, 0);
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
  const hasLinkedPayments = Array.isArray(linkedPayments) && linkedPayments.length > 0;
  const paidTotal = servicePaymentRevenueCents(linkedPayments);
  const discount = appointmentDiscountCents(appointment);
  const targetNet = hasLinkedPayments ? paidTotal : Math.max(0, grossTotal - discount);
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
      revenueSource: hasLinkedPayments ? "linked_payments" : discount > 0 ? "service_price_minus_discount" : "service_price"
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
      revenueAllocatedCents: 0,
      source,
      usageSource: link.usageSource || "standard_service",
      economicRole: "service_consumption"
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

function computeRetailBreakdown(linkedPayments = [], inventoryById = new Map()) {
  const rows = [];
  const sourceFlags = [];
  (Array.isArray(linkedPayments) ? linkedPayments : []).forEach((payment) => {
    const paymentLines = (Array.isArray(payment.productSales) ? payment.productSales : []).map((line) => {
      const productId = String(line.itemId || line.productId || "");
      const product = inventoryById.get(productId) || {};
      const quantity = Math.max(0, Number(line.quantity || 0));
      const salePriceCents = positive(line.salePriceCents || line.priceCents || 0);
      const unitCostCents = positive(
        line.unitCostCents
        || line.costCents
        || product.unitCostCents
        || product.costCents
        || product.purchaseCostCents
        || 0
      );
      if (!unitCostCents && quantity > 0) sourceFlags.push(`retail_missing_cost:${productId || "unknown"}`);
      return {
        productId,
        name: product.name || line.name || "Prodotto retail",
        quantity,
        unitCostCents,
        costCents: Math.round(unitCostCents * quantity),
        rawRevenueCents: Math.round(salePriceCents * quantity),
        paymentId: String(payment.id || ""),
        source: unitCostCents ? "inventory_unit_cost_x_quantity" : "missing_cost",
        economicRole: "retail_sale"
      };
    });
    const rawRetailRevenueCents = paymentLines.reduce((sum, row) => sum + positive(row.rawRevenueCents), 0);
    const paymentAmountCents = positive(payment.amountCents);
    const retailRevenueCapCents = paymentAmountCents > 0
      ? Math.min(rawRetailRevenueCents, paymentAmountCents)
      : rawRetailRevenueCents;
    if (paymentAmountCents > 0 && rawRetailRevenueCents > paymentAmountCents) {
      sourceFlags.push(`retail_revenue_exceeds_payment:${String(payment.id || "unknown")}`);
    }
    let allocatedRevenueCents = 0;
    paymentLines.forEach((row, index) => {
      const isLast = index === paymentLines.length - 1;
      const proportionalRevenueCents = rawRetailRevenueCents > 0
        ? Math.round(retailRevenueCapCents * positive(row.rawRevenueCents) / rawRetailRevenueCents)
        : 0;
      const revenueCents = isLast
        ? Math.max(0, retailRevenueCapCents - allocatedRevenueCents)
        : Math.max(0, Math.min(proportionalRevenueCents, retailRevenueCapCents - allocatedRevenueCents));
      allocatedRevenueCents += revenueCents;
      const { rawRevenueCents, ...publicRow } = row;
      rows.push({
        ...publicRow,
        revenueCents,
        revenueSource: retailRevenueCapCents < rawRetailRevenueCents
          ? "product_sales_capped_to_payment"
          : "product_sales"
      });
    });
  });
  return {
    rows,
    revenueCents: rows.reduce((sum, row) => sum + positive(row.revenueCents), 0),
    costCents: rows.reduce((sum, row) => sum + positive(row.costCents), 0),
    sourceFlags,
    confidence: sourceFlags.length ? CONFIDENCE.INCOMPLETE : rows.length ? CONFIDENCE.REAL : CONFIDENCE.STANDARD
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
    const costOnly = item.economicRole === "service_consumption";
    return {
      ...item,
      averageRevenueCents: item.executions ? Math.round(Number(item.revenueCents || 0) / item.executions) : Number(item.averageRevenueCents || 0),
      averageCostCents: item.executions ? Math.round(Number(item.costCents || 0) / item.executions) : Number(item.averageCostCents || 0),
      marginPercent: costOnly ? null : marginPercent,
      status: costOnly ? "COST_ONLY" : statusFromMargin(item.profitCents, item.revenueCents)
    };
  }).sort((a, b) =>
    String(a.economicRole || "").localeCompare(String(b.economicRole || ""))
    || Number(a.marginPercent ?? 0) - Number(b.marginPercent ?? 0)
    || String(a.name || "").localeCompare(String(b.name || ""))
  );
}


function computeOperatingCostMinuteProfile({ staff = [], inventory = [], resources = [], fixedCostProfile = {} } = {}) {
  const activeStaff = (Array.isArray(staff) ? staff : []).filter((item) => item.active !== false);
  const staffRows = activeStaff.map((item) => {
    const grossMonthlyCents = positive(item.grossSalaryCents || item.monthlyGrossSalaryCents || item.salaryGrossCents || item.payrollCostCents || item.monthlyCostCents || 0);
    const netMonthlyCents = positive(item.netSalaryCents || item.monthlyNetSalaryCents || item.salaryNetCents || 0);
    const hourlyCostCents = positive(item.hourlyCostCents || item.hourlyCost || 0);
    return {
      id: String(item.id || ""),
      name: item.name || "Operatore",
      grossMonthlyCents,
      netMonthlyCents,
      hourlyCostCents,
      source: grossMonthlyCents ? "gross_salary" : hourlyCostCents ? "hourly_cost" : netMonthlyCents ? "net_salary_context" : "missing"
    };
  });
  const staffMonthlyCents = staffRows.reduce((sum, item) => sum + positive(item.grossMonthlyCents || 0), 0);
  const staffHourlyDeclaredCents = staffRows.reduce((sum, item) => sum + positive(item.hourlyCostCents || 0), 0);
  const technologyRows = (Array.isArray(resources) ? resources : []).filter((item) => item.active !== false).map((item) => ({
    id: String(item.id || ""),
    name: item.name || "Tecnologia",
    monthlyCostCents: positive(item.monthlyCostCents || item.installmentCents || item.rataCents || item.leaseCostCents || 0),
    costPerUseCents: positive(item.costPerUseCents || 0)
  }));
  const technologyMonthlyCents = technologyRows.reduce((sum, item) => sum + positive(item.monthlyCostCents || 0), 0);
  const inventoryRows = (Array.isArray(inventory) ? inventory : []).filter((item) => item.active !== false).map((item) => ({
    id: String(item.id || ""),
    name: item.name || "Prodotto",
    costCents: positive(item.costCents || item.unitCostCents || item.purchaseCostCents || 0),
    costPerUseCents: positive(item.costPerUseCents || 0),
    stockQuantity: Number(item.stockQuantity ?? item.quantity ?? item.stock ?? 0)
  }));
  const inventoryWithCost = inventoryRows.filter((item) => item.costCents > 0 || item.costPerUseCents > 0).length;
  const missing = [];
  const operatorsMissingCost = staffRows.filter((item) => !item.grossMonthlyCents && !item.hourlyCostCents);
  const technologiesMissingCost = technologyRows.filter((item) => !item.monthlyCostCents && !item.costPerUseCents);
  const inventoryMissingCost = inventoryRows.filter((item) => !item.costCents && !item.costPerUseCents);
  if (operatorsMissingCost.length) missing.push({ key: "operators_cost", label: "costo operatori", count: operatorsMissingCost.length });
  if (technologiesMissingCost.length) missing.push({ key: "technologies_cost", label: "rata/costo tecnologie", count: technologiesMissingCost.length });
  if (inventoryMissingCost.length) missing.push({ key: "inventory_cost", label: "costo prodotti", count: inventoryMissingCost.length });
  const fixedCostKeys = ["rent", "utilitiesPower", "utilitiesWaterGas", "accountant", "insurance", "software", "marketing", "cleaningLaundry", "bankPosFees", "taxesContributionsReserve", "otherFixedCosts"];
  const generalFixedMonthlyCents = fixedCostKeys.reduce((sum, key) => sum + positive(Math.round(Number(fixedCostProfile?.[key] || 0) * 100)), 0);
  const ownerIncludedInStaff = fixedCostProfile?.ownerIncludedInStaff === true;
  const ownerPayrollMonthlyCents = ownerIncludedInStaff
    ? 0
    : positive(Math.round(Number(fixedCostProfile?.payrollOwner || 0) * 100));
  const manualFixedMonthlyCents = generalFixedMonthlyCents + ownerPayrollMonthlyCents;
  return {
    source: "profitability_core_existing_data",
    staffMonthlyCents,
    staffHourlyDeclaredCents,
    technologyMonthlyCents,
    generalFixedMonthlyCents,
    ownerPayrollMonthlyCents,
    ownerIncludedInStaff,
    manualFixedMonthlyCents,
    existingMonthlyCents: staffMonthlyCents + technologyMonthlyCents,
    totalMonthlyBaselineCents: staffMonthlyCents + technologyMonthlyCents + manualFixedMonthlyCents,
    fixedCostProfile: fixedCostProfile && typeof fixedCostProfile === "object" ? fixedCostProfile : {},
    staffRows,
    technologyRows,
    inventoryCoverage: {
      total: inventoryRows.length,
      withCost: inventoryWithCost,
      missingCost: inventoryMissingCost.length
    },
    missing,
    notes: [
      "Prodotti: costo e consumo restano nel magazzino e nei link servizio.",
      "Tecnologie: rata/costo mensile e costo uso restano nelle risorse/tecnologie.",
      "Operatori: usare costo orario o stipendio lordo mensile; netto resta contesto.",
      "Il margine diretto per servizio e il payroll mensile sono viste alternative: non sommarli due volte nel conto economico."
    ]
  };
}

function computeCenterProfitabilitySnapshot({
  appointments = [],
  services = [],
  staff = [],
  payments = [],
  inventory = [],
  resources = [],
  fixedCostProfile = {}
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
    const linkedPayments = paymentsByAppointmentId.get(String(appointment.id || "")) || [];
    if (!shouldIncludeAppointmentInProfitability(appointment, linkedPayments)) return;
    const nonRevenueStatus = isNonRevenueAppointmentStatus(appointment);
    const nonServicePaymentRevenueCents = nonRevenueStatus
      ? servicePaymentRevenueCents(linkedPayments)
      : 0;
    const serviceBreakdown = nonRevenueStatus
      ? buildProfitabilityBreakdown({
          revenueCents: nonServicePaymentRevenueCents,
          laborCostCents: 0,
          materialCostCents: 0,
          technologyCostCents: 0,
          confidence: CONFIDENCE.REAL,
          sourceFlags: nonServicePaymentRevenueCents > 0
            ? ["paid_non_revenue_appointment_fee"]
            : ["non_revenue_appointment_retail_only"],
          serviceBreakdown: [],
          productBreakdown: [],
          technologyBreakdown: []
        })
      : computeAppointmentProfitability({
          appointment,
          servicesById,
          staffById,
          inventoryById,
          resourcesById,
          linkedPayments
        });
    const retail = computeRetailBreakdown(linkedPayments, inventoryById);
    const breakdown = buildProfitabilityBreakdown({
      revenueCents: serviceBreakdown.revenueCents + retail.revenueCents,
      laborCostCents: serviceBreakdown.laborCostCents,
      materialCostCents: serviceBreakdown.materialCostCents + retail.costCents,
      technologyCostCents: serviceBreakdown.technologyCostCents,
      confidence: mergeConfidence([serviceBreakdown.confidence, retail.confidence]),
      sourceFlags: [
        ...(serviceBreakdown.sourceFlags || []),
        ...(retail.rows.length ? ["retail_payment_lines"] : []),
        ...retail.sourceFlags
      ],
      serviceBreakdown: serviceBreakdown.serviceBreakdown,
      productBreakdown: serviceBreakdown.productBreakdown,
      technologyBreakdown: serviceBreakdown.technologyBreakdown
    });
    breakdown.retailRevenueCents = retail.revenueCents;
    breakdown.retailCostCents = retail.costCents;
    breakdown.retailBreakdown = retail.rows;
    breakdown.nonServiceRevenueCents = nonServicePaymentRevenueCents;
    breakdown.serviceExecutionCount = nonRevenueStatus ? 0 : 1;
    appointmentBreakdowns.push({ appointmentId: appointment.id || "", ...breakdown });
    serviceBreakdown.serviceBreakdown.forEach((service) => {
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
        confidence: serviceBreakdown.confidence,
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
      current.confidence = mergeConfidence([current.confidence, serviceBreakdown.confidence]);
      current.sourceFlags = Array.from(new Set([...(current.sourceFlags || []), ...(serviceBreakdown.sourceFlags || [])]));
    });
    serviceBreakdown.productBreakdown.forEach((product) => {
      const productId = product.productId || "unknown";
      const economicRole = "service_consumption";
      const seed = {
        id: `${productId}:${economicRole}`,
        productId,
        economicRole,
        name: `${product.name || "Prodotto"} · consumo cabina`,
        totalUses: 0,
        costConsumedCents: 0,
        costCents: 0,
        revenueCents: 0,
        profitCents: 0,
        marginPercent: 0,
        status: "HEALTHY"
      };
      addAggregate(productMap, `${productId}:${economicRole}`, seed, {
        totalUses: product.usageUnits,
        costConsumedCents: product.costCents,
        costCents: product.costCents,
        revenueCents: product.revenueAllocatedCents,
        profitCents: product.revenueAllocatedCents - product.costCents
      });
    });
    retail.rows.forEach((product) => {
      const productId = product.productId || "unknown";
      const economicRole = "retail_sale";
      const seed = {
        id: `${productId}:${economicRole}`,
        productId,
        economicRole,
        name: `${product.name || "Prodotto retail"} · vendita retail`,
        totalUses: 0,
        costConsumedCents: 0,
        costCents: 0,
        revenueCents: 0,
        profitCents: 0,
        marginPercent: 0,
        status: "HEALTHY"
      };
      addAggregate(productMap, `${productId}:${economicRole}`, seed, {
        totalUses: product.quantity,
        costConsumedCents: product.costCents,
        costCents: product.costCents,
        revenueCents: product.revenueCents,
        profitCents: product.revenueCents - product.costCents
      });
    });
    serviceBreakdown.technologyBreakdown.forEach((technology) => {
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
      executions: nonRevenueStatus ? 0 : 1,
      revenueCents: breakdown.revenueCents,
      costCents: breakdown.directCostCents,
      profitCents: breakdown.grossMarginCents
    });
  });

  const serviceRows = finalizeRows(Array.from(serviceMap.values()));
  const productRows = finalizeRows(Array.from(productMap.values()));
  const technologyRows = finalizeRows(Array.from(technologyMap.values()));
  const operatingCostMinuteProfile = computeOperatingCostMinuteProfile({ staff, inventory, resources, fixedCostProfile });
  const totals = appointmentBreakdowns.reduce((summary, item) => ({
    executions: summary.executions + Number(item.serviceExecutionCount || 0),
    revenueCents: summary.revenueCents + Number(item.revenueCents || 0),
    costCents: summary.costCents + Number(item.directCostCents || 0),
    profitCents: summary.profitCents + Number(item.grossMarginCents || 0),
    retailRevenueCents: summary.retailRevenueCents + Number(item.retailRevenueCents || 0),
    retailCostCents: summary.retailCostCents + Number(item.retailCostCents || 0)
  }), { executions: 0, revenueCents: 0, costCents: 0, profitCents: 0, retailRevenueCents: 0, retailCostCents: 0 });
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
    operatingCostMinuteProfile,
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
  computeOperatingCostMinuteProfile,
  buildProfitabilityBreakdown,
  inferProfitabilityConfidence,
  shouldIncludeAppointmentInProfitability
};
