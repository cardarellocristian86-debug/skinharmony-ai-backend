"use strict";

const assert = require("assert");
const {
  COLLECTION_NAMES,
  DATASET_VERSION,
  TOTAL_CHECKOUTS,
  TOTAL_REVENUE_CENTS,
  CLIENT_VISIT_COUNT_DISTRIBUTION,
  CLOSED_DATES,
  buildGold18mDataset,
  auditCollections,
  buildApplyDigest,
  planStructureCollections,
  planWaveCollections,
  planFinalizeCollections,
  verifyGold18mCollections,
  stableStringify,
  assertSafeTargetCenterId,
  superadminSetDigest,
  tenantAuthDigest
} = require("../src/Gold18mTenantAdmin");
const {
  computeCenterProfitabilitySnapshot
} = require("../src/core/profitability/ProfitabilityCore");
const {
  skinHarmonyProtocolLibrary
} = require("../src/SkinHarmonyProtocolLibrary");

function emptyCollections() {
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [name, name === "settings" ? {} : []]));
}

function buildFixture() {
  const collections = emptyCollections();
  const superadmin = {
    id: "superadmin_1",
    username: "owner-control",
    passwordHash: "preserve-me-byte-for-byte",
    role: "SuPeRaDmIn",
    centerId: "center_admin",
    centerName: "Control",
    active: true,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  collections.users = [
    superadmin,
    {
      id: "user_keep",
      username: "tenant-keep",
      passwordHash: "keep-credential",
      role: "staff",
      centerId: "center_keep_gold",
      centerName: "Old test tenant",
      active: true,
      accountStatus: "active",
      subscriptionPlan: "gold"
    },
    {
      id: "user_keep_extra",
      username: "tenant-keep-extra",
      passwordHash: "delete-extra-account",
      role: "staff",
      centerId: "center_keep_gold",
      centerName: "Old test tenant",
      active: true,
      subscriptionPlan: "base"
    },
    {
      id: "user_delete",
      username: "tenant-delete",
      passwordHash: "delete-credential",
      role: "owner",
      centerId: "center_delete_test",
      centerName: "Delete test tenant",
      active: true,
      subscriptionPlan: "silver"
    }
  ];
  COLLECTION_NAMES
    .filter((name) => !["users", "settings"].includes(name))
    .forEach((name) => {
      collections[name] = [
        { id: `${name}_admin`, centerId: "center_admin", marker: "preserve-admin" },
        { id: `${name}_keep`, centerId: "center_keep_gold", marker: "replace-target" },
        { id: `${name}_delete`, centerId: "center_delete_test", marker: "delete-other" },
        { id: `${name}_centerless`, marker: "delete-centerless" }
      ];
    });
  collections.protocols.push(JSON.parse(JSON.stringify(skinHarmonyProtocolLibrary[0])));
  collections.protocols.push({
    id: "forged_library",
    centerId: "__skinharmony_library",
    libraryScope: "center",
    source: "forged",
    marker: "delete-forged-library"
  });
  collections.settings = {
    center_admin: { centerId: "center_admin", centerName: "Admin" },
    center_keep_gold: { centerId: "center_keep_gold", centerName: "Old" },
    center_delete_test: { centerId: "center_delete_test", centerName: "Delete" }
  };
  return { collections, superadmin };
}

function run() {
  assert.strictEqual(TOTAL_CHECKOUTS, 5250);
  assert.strictEqual(TOTAL_REVENUE_CENTS, 30000000);
  const dataset = buildGold18mDataset({
    centerId: "center_keep_gold",
    centerName: "Atelier Aurora Hair & Beauty"
  });
  assert.strictEqual(dataset.staff.length, 4);
  assert.strictEqual(dataset.resources.length, 3);
  assert.strictEqual(dataset.clients.length, 1100);
  assert.strictEqual(dataset.history.payments.length, 5250);
  assert.strictEqual(dataset.history.appointments.filter((item) => item.status === "completed").length, 5250);
  assert.strictEqual(dataset.history.appointments.filter((item) => item.status === "no_show").length, 126);
  assert.strictEqual(dataset.history.appointments.filter((item) => item.status === "cancelled").length, 84);
  assert.strictEqual(dataset.history.payments.reduce((sum, item) => sum + item.amountCents, 0), 30000000);
  assert.strictEqual(dataset.history.payments.slice(0, 3500).reduce((sum, item) => sum + item.amountCents, 0), 20000000);
  assert.strictEqual(dataset.history.payments.flatMap((item) => item.productSales).length, 1155);
  assert.strictEqual(dataset.staff.reduce((sum, item) => sum + item.grossSalaryCents, 0), 660000);
  assert.ok(dataset.inventory.every((item) => item.priceEvidence && item.priceEvidence.officialWholesale === false));
  assert.ok(dataset.resources.every((item) => item.priceEvidence?.sourceKey));
  assert.ok(dataset.services.every((item) =>
    item.priceEvidence?.type === "observed_exact"
    && item.priceEvidence.observedPriceCents === item.priceCents
  ));
  assert.ok(dataset.clients.every((item) => item.synthetic === true && item.email.endsWith(".invalid")));
  const serviceById = new Map(dataset.services.map((item) => [item.id, item]));
  const staffById = new Map(dataset.staff.map((item) => [item.id, item]));
  const completedAppointments = dataset.history.appointments.filter((item) => item.status === "completed");
  const visitsByClient = new Map(dataset.clients.map((client) => [client.id, 0]));
  completedAppointments.forEach((appointment) => {
    visitsByClient.set(appointment.clientId, Number(visitsByClient.get(appointment.clientId) || 0) + 1);
  });
  const visitDistribution = Array.from(visitsByClient.values()).reduce((counts, visits) => {
    counts[visits] = Number(counts[visits] || 0) + 1;
    return counts;
  }, {});
  assert.deepStrictEqual(
    visitDistribution,
    Object.fromEntries(CLIENT_VISIT_COUNT_DISTRIBUTION.map((item) => [String(item.visits), item.clients]))
  );
  const finalClients = dataset.clientsAtWave(3);
  const tierCounts = finalClients.reduce((counts, client) => {
    counts[client.loyaltyTier] = Number(counts[client.loyaltyTier] || 0) + 1;
    return counts;
  }, {});
  assert.deepStrictEqual(tierCounts, { base: 750, pearl: 265, silver: 63, gold: 22 });
  const clientDayKeys = completedAppointments.map((appointment) =>
    `${appointment.clientId}:${appointment.startAt.slice(0, 10)}`
  );
  assert.strictEqual(new Set(clientDayKeys).size, clientDayKeys.length);
  assert.ok(dataset.history.appointments.every((appointment) => !CLOSED_DATES.has(appointment.startAt.slice(0, 10))));
  assert.ok(dataset.history.shifts.every((shift) => !CLOSED_DATES.has(shift.date)));
  assert.ok(dataset.history.cashClosures.every((closure) => !CLOSED_DATES.has(closure.date)));
  assert.ok(dataset.history.appointments.every((appointment) => {
    const operator = staffById.get(appointment.staffId);
    const date = appointment.startAt.slice(0, 10);
    const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    return day !== Number(operator.weeklyDayOff)
      && !(operator.plannedAbsences || []).some((absence) => date >= absence.startDate && date <= absence.endDate);
  }));
  assert.strictEqual(dataset.history.shifts.length, 1443);
  assert.strictEqual(dataset.history.cashClosures.length, 445);
  assert.strictEqual(dataset.history.inventoryMovements.length, 1471);
  const movementTypes = dataset.history.inventoryMovements.reduce((counts, movement) => {
    counts[movement.type] = Number(counts[movement.type] || 0) + 1;
    return counts;
  }, {});
  assert.deepStrictEqual(movementTypes, { load: 10, sale: 1155, internal_use: 126, replenish: 180 });
  assert.ok(dataset.inventory.every((item) => {
    const signedQuantity = dataset.history.inventoryMovements
      .filter((movement) => movement.itemId === item.id)
      .reduce((sum, movement) =>
        sum + (["sale", "internal_use", "unload"].includes(movement.type)
          ? -Number(movement.quantity || 0)
          : Number(movement.quantity || 0)), 0);
    return Math.abs(signedQuantity - Number(item.stockQuantity || 0)) < 0.01;
  }));
  assert.strictEqual(dataset.inventory.find((item) => item.sku === "RV-COLORSM-060").costCents, 917);
  assert.strictEqual(dataset.inventory.find((item) => item.sku === "RV-COLSUB-075").costCents, 949);
  const technologyServiceIds = new Set(dataset.services
    .filter((item) => item.technologyLinks.length)
    .map((item) => item.id));
  const technologyAppointments = dataset.history.appointments
    .filter((item) => item.status === "completed" && technologyServiceIds.has(item.serviceId));
  assert.strictEqual(technologyAppointments.length, 350);
  assert.ok(technologyAppointments.every((item) => item.resourceId));
  assert.ok(dataset.history.appointments.every((appointment) =>
    staffById.get(appointment.staffId)?.serviceCategories.includes(serviceById.get(appointment.serviceId)?.category)
  ));
  const assertNoOverlap = (rows, keyForRow) => {
    const groups = new Map();
    rows.forEach((row) => {
      const key = keyForRow(row);
      if (!key) return;
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    });
    groups.forEach((group, key) => {
      const ordered = group.slice().sort((left, right) => left.startAt.localeCompare(right.startAt));
      for (let index = 1; index < ordered.length; index += 1) {
        assert.ok(ordered[index].startAt >= ordered[index - 1].endAt, `Overlap ${key}`);
      }
    });
  };
  const capacityAppointments = dataset.history.appointments.filter((item) => item.status !== "cancelled");
  assertNoOverlap(capacityAppointments, (item) => `${item.staffId}:${item.startAt.slice(0, 10)}`);
  assertNoOverlap(capacityAppointments, (item) => item.resourceId ? `${item.resourceId}:${item.startAt.slice(0, 10)}` : "");
  const profitability = computeCenterProfitabilitySnapshot({
    appointments: dataset.history.appointments,
    services: dataset.services,
    staff: dataset.staff,
    payments: dataset.history.payments,
    inventory: dataset.inventory,
    resources: dataset.resources,
    fixedCostProfile: dataset.settings.goldFixedCostProfile
  });
  assert.strictEqual(profitability.totals.executions, 5250);
  assert.strictEqual(profitability.totals.revenueCents, 30000000);
  assert.strictEqual(profitability.totals.retailRevenueCents, 3109943);
  assert.strictEqual(profitability.totals.retailCostCents, 1716018);
  assert.strictEqual(profitability.services.reduce((sum, item) => sum + item.revenueCents, 0), 26890057);
  assert.strictEqual(profitability.operatingCostMinuteProfile.staffMonthlyCents, 660000);
  assert.strictEqual(profitability.operatingCostMinuteProfile.technologyMonthlyCents, 19318);
  assert.strictEqual(profitability.operatingCostMinuteProfile.generalFixedMonthlyCents, 554150);
  assert.strictEqual(profitability.operatingCostMinuteProfile.ownerPayrollMonthlyCents, 180000);
  assert.strictEqual(profitability.operatingCostMinuteProfile.ownerIncludedInStaff, false);
  assert.strictEqual(profitability.operatingCostMinuteProfile.manualFixedMonthlyCents, 734150);
  assert.strictEqual(profitability.operatingCostMinuteProfile.totalMonthlyBaselineCents, 1413468);
  assert.strictEqual(profitability.technologies.reduce((sum, item) => sum + item.totalUses, 0), 350);
  const serviceProductCostCents = profitability.appointmentBreakdowns.reduce((sum, appointment) =>
    sum + appointment.productBreakdown.reduce((productSum, product) => productSum + product.costCents, 0), 0
  );
  const internalUseCostCents = dataset.history.inventoryMovements
    .filter((movement) => movement.type === "internal_use")
    .reduce((sum, movement) => sum + movement.costCents, 0);
  const retailMovementCostCents = dataset.history.inventoryMovements
    .filter((movement) => movement.type === "sale")
    .reduce((sum, movement) => sum + movement.costCents, 0);
  assert.strictEqual(serviceProductCostCents, 2414350);
  assert.strictEqual(internalUseCostCents, serviceProductCostCents);
  assert.strictEqual(retailMovementCostCents, profitability.totals.retailCostCents);
  assert.ok(dataset.services.every((service) => {
    if (!service.productLinks.length) return true;
    const linkedCost = service.productLinks.reduce((sum, link) => {
      const product = dataset.inventory.find((item) => item.id === link.productId);
      return sum + Math.round(Number(link.unitCostCents || product.unitCostCents) * Number(link.usageUnits || 0));
    }, 0);
    return linkedCost === service.estimatedProductCostCents;
  }));
  const retailOnlyCancelled = computeCenterProfitabilitySnapshot({
    appointments: [{
      id: "cancelled_retail_only",
      status: "cancelled",
      serviceId: "service_cancelled",
      staffId: "staff_cancelled",
      priceCents: 5000,
      durationMin: 60,
      startAt: "2026-01-10T10:00:00.000Z"
    }],
    services: [{
      id: "service_cancelled",
      name: "Servizio annullato",
      priceCents: 5000,
      estimatedProductCostCents: 1000
    }],
    staff: [{ id: "staff_cancelled", hourlyCostCents: 1500 }],
    payments: [{
      id: "payment_retail_only",
      appointmentId: "cancelled_retail_only",
      amountCents: 2000,
      serviceLines: [],
      productSales: [{ itemId: "retail_item", quantity: 1, salePriceCents: 2000 }]
    }],
    inventory: [{ id: "retail_item", name: "Retail", unitCostCents: 800 }]
  });
  assert.strictEqual(retailOnlyCancelled.totals.executions, 0);
  assert.strictEqual(retailOnlyCancelled.totals.revenueCents, 2000);
  assert.strictEqual(retailOnlyCancelled.totals.costCents, 800);
  assert.strictEqual(retailOnlyCancelled.totals.retailRevenueCents, 2000);
  assert.strictEqual(retailOnlyCancelled.totals.retailCostCents, 800);
  assert.strictEqual(retailOnlyCancelled.services.length, 0);
  assert.strictEqual(retailOnlyCancelled.appointmentBreakdowns[0].nonServiceRevenueCents, 0);

  const authoritativePaymentAmount = computeCenterProfitabilitySnapshot({
    appointments: [{
      id: "completed_mismatch",
      status: "completed",
      serviceId: "service_mismatch",
      priceCents: 5000,
      durationMin: 30,
      startAt: "2026-01-11T10:00:00.000Z"
    }],
    services: [{ id: "service_mismatch", name: "Servizio", priceCents: 5000 }],
    payments: [{
      id: "payment_mismatch",
      appointmentId: "completed_mismatch",
      amountCents: 5000,
      serviceLines: [{ serviceId: "service_mismatch", salePriceCents: 4000 }],
      productSales: [{ itemId: "retail_item", quantity: 1, salePriceCents: 2000 }]
    }],
    inventory: [{ id: "retail_item", name: "Retail", unitCostCents: 800 }]
  });
  assert.strictEqual(authoritativePaymentAmount.totals.revenueCents, 5000);
  assert.strictEqual(authoritativePaymentAmount.services[0].revenueCents, 3000);
  assert.strictEqual(authoritativePaymentAmount.totals.retailRevenueCents, 2000);

  const retailOverPayment = computeCenterProfitabilitySnapshot({
    appointments: [{
      id: "completed_retail_over_payment",
      status: "completed",
      serviceId: "service_retail_over_payment",
      priceCents: 5000,
      durationMin: 30,
      startAt: "2026-01-12T10:00:00.000Z"
    }],
    services: [{ id: "service_retail_over_payment", name: "Servizio", priceCents: 5000 }],
    payments: [{
      id: "payment_retail_over_payment",
      appointmentId: "completed_retail_over_payment",
      amountCents: 5000,
      productSales: [{ itemId: "retail_item", quantity: 1, salePriceCents: 6000 }]
    }],
    inventory: [{ id: "retail_item", name: "Retail", unitCostCents: 800 }]
  });
  assert.strictEqual(retailOverPayment.totals.revenueCents, 5000);
  assert.strictEqual(retailOverPayment.totals.retailRevenueCents, 5000);
  assert.strictEqual(retailOverPayment.services[0].revenueCents, 0);
  assert.strictEqual(retailOverPayment.totals.retailCostCents, 800);
  assert.ok(retailOverPayment.meta.sourceFlags.some((flag) => flag === "retail_revenue_exceeds_payment:payment_retail_over_payment"));

  const serviceConsumptionRows = profitability.products.filter((row) => row.economicRole === "service_consumption");
  const retailSaleRows = profitability.products.filter((row) => row.economicRole === "retail_sale");
  assert.ok(serviceConsumptionRows.length > 0);
  assert.ok(retailSaleRows.length > 0);
  assert.strictEqual(new Set(profitability.products.map((row) => row.id)).size, profitability.products.length);
  assert.ok(serviceConsumptionRows.every((row) =>
    row.productId
    && row.id === `${row.productId}:service_consumption`
    && row.revenueCents === 0
    && row.status === "COST_ONLY"
    && row.marginPercent === null
  ));
  assert.ok(retailSaleRows.every((row) =>
    row.productId
    && row.id === `${row.productId}:retail_sale`
    && row.status !== "COST_ONLY"
    && Number.isFinite(row.marginPercent)
  ));
  assert.strictEqual(
    serviceConsumptionRows.reduce((sum, row) => sum + Number(row.costCents || 0), 0),
    internalUseCostCents
  );
  assert.strictEqual(
    retailSaleRows.reduce((sum, row) => sum + Number(row.costCents || 0), 0),
    retailMovementCostCents
  );
  assert.strictEqual(
    retailSaleRows.reduce((sum, row) => sum + Number(row.revenueCents || 0), 0),
    profitability.totals.retailRevenueCents
  );

  const { collections, superadmin } = buildFixture();
  const audit = auditCollections(collections);
  assert.strictEqual(audit.superadminCount, 1);
  assert.strictEqual(audit.tenantCenterCount, 2);
  assert.strictEqual(audit.recommendedKeepCenterId, "center_keep_gold");
  assert.strictEqual(audit.previewDigest.length, 64);
  const applyDigest = buildApplyDigest(audit, {
    centerId: "center_keep_gold",
    userId: "user_keep",
    centerName: dataset.centerName
  });
  assert.strictEqual(applyDigest.length, 64);
  assert.notStrictEqual(applyDigest, buildApplyDigest(audit, {
    centerId: "center_keep_gold",
    userId: "user_keep",
    centerName: "Atelier Aurora Hair & Beauty Due"
  }));

  const expectedSuperadminDigest = superadminSetDigest(collections.users);
  const expectedTenantAuthDigest = tenantAuthDigest(collections.users, "user_keep");
  const structured = planStructureCollections(collections, "center_keep_gold", dataset, "user_keep");
  const preservedAdmin = structured.users.find((item) => item.id === superadmin.id);
  assert.strictEqual(stableStringify(preservedAdmin), stableStringify(superadmin));
  assert.strictEqual(structured.users.filter((item) => String(item.role || "").toLowerCase() !== "superadmin").length, 1);
  assert.strictEqual(structured.users.find((item) => item.id === "user_keep").passwordHash, "keep-credential");
  assert.strictEqual(structured.users.find((item) => item.id === "user_keep").role, "staff");
  assert.strictEqual(structured.users.find((item) => item.id === "user_keep").subscriptionPlan, "gold");
  assert.ok(!structured.users.some((item) => item.id === "user_keep_extra" || item.id === "user_delete"));
  assert.ok(structured.protocols.some((item) => item.id === skinHarmonyProtocolLibrary[0].id));
  assert.ok(!structured.protocols.some((item) => item.id === "forged_library"));
  COLLECTION_NAMES
    .filter((name) => !["settings", "users"].includes(name))
    .forEach((name) => {
      assert.ok(!structured[name].some((item) => item.centerId === "center_delete_test"), `Residuo in ${name}`);
      assert.ok(!structured[name].some((item) => !item.centerId), `Riga centerless in ${name}`);
    });
  assert.deepStrictEqual(
    Object.keys(structured.settings).sort(),
    ["center_admin", "center_keep_gold"]
  );

  const wave1 = planWaveCollections(structured, "center_keep_gold", dataset, 1);
  const wave1Again = planWaveCollections(wave1, "center_keep_gold", dataset, 1);
  assert.strictEqual(stableStringify(wave1Again), stableStringify(wave1), "Wave 1 deve essere idempotente");
  assert.strictEqual(wave1.payments.filter((item) => item.centerId === "center_keep_gold").length, 1765);

  const wave2 = planWaveCollections(wave1, "center_keep_gold", dataset, 2);
  assert.strictEqual(wave2.payments.filter((item) => item.centerId === "center_keep_gold").length, 3500);
  const wave3 = planWaveCollections(wave2, "center_keep_gold", dataset, 3);
  assert.strictEqual(wave3.payments.filter((item) => item.centerId === "center_keep_gold").length, 5250);
  wave3.gold_state = [
    {
      id: "gold_state:center_keep_gold",
      centerId: "center_keep_gold",
      metadata: { valid: true, datasetVersion: DATASET_VERSION }
    },
    ...wave3.gold_state.filter((item) => item.centerId !== "center_keep_gold")
  ];
  const preliminaryVerification = verifyGold18mCollections(
    wave3,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest,
    { requireCompleteImportManifest: false }
  );
  assert.strictEqual(preliminaryVerification.ok, true);
  const finalized = planFinalizeCollections(wave3, "center_keep_gold", dataset, [], preliminaryVerification);
  const verification = verifyGold18mCollections(
    finalized,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    verification.ok,
    true,
    `Verifica fallita: ${verification.checks.filter((item) => !item.ok).map((item) => item.name).join(", ")}`
  );
  assert.strictEqual(verification.totals.firstYearPayments, 3500);
  assert.strictEqual(verification.totals.firstYearRevenueCents, 20000000);
  assert.strictEqual(verification.totals.revenueCents, 30000000);
  assert.strictEqual(verification.checks.find((item) => item.name === "gold_marketing_history_coherent")?.ok, true);
  assert.strictEqual(verification.checks.find((item) => item.name === "profitability_product_roles_separated")?.ok, true);

  // A pre-final runtime snapshot can expose fewer checks than the committed
  // candidate. The manifest must be recertified from that candidate; otherwise
  // a safe live apply would roll back despite the dataset being coherent.
  const staleVerification = {
    ...preliminaryVerification,
    checks: preliminaryVerification.checks.slice(0, -1)
  };
  const staleFinalized = planFinalizeCollections(wave3, "center_keep_gold", dataset, [], staleVerification);
  const candidateVerification = verifyGold18mCollections(
    staleFinalized,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(candidateVerification.checks.find((item) => item.name === "gold_import_manifest_exact")?.ok, false);
  const recertified = planFinalizeCollections(staleFinalized, "center_keep_gold", dataset, [], candidateVerification);
  const recertifiedVerification = verifyGold18mCollections(
    recertified,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(recertifiedVerification.ok, true, "Il manifest deve usare il conteggio del candidato committed");

  [
    ["status", "verification_failed"],
    ["datasetVersion", "forged_version"],
    ["centerName", "Centro contraffatto"],
    ["appliedWaves", []]
  ].forEach(([key, value]) => {
    const tamperedManifest = JSON.parse(JSON.stringify(finalized));
    tamperedManifest.gold_imports.find((item) => item.centerId === "center_keep_gold")[key] = value;
    const manifestVerification = verifyGold18mCollections(
      tamperedManifest,
      "center_keep_gold",
      dataset,
      expectedSuperadminDigest,
      expectedTenantAuthDigest
    );
    assert.strictEqual(manifestVerification.checks.find((item) => item.name === "gold_import_manifest_exact")?.ok, false);
  });
  const duplicateManifest = JSON.parse(JSON.stringify(finalized));
  duplicateManifest.gold_imports.push(JSON.parse(JSON.stringify(
    duplicateManifest.gold_imports.find((item) => item.centerId === "center_keep_gold")
  )));
  const duplicateManifestVerification = verifyGold18mCollections(
    duplicateManifest,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(duplicateManifestVerification.checks.find((item) => item.name === "gold_import_manifest_exact")?.ok, false);
  const forgedVerificationSummary = JSON.parse(JSON.stringify(finalized));
  forgedVerificationSummary.gold_imports.find((item) => item.centerId === "center_keep_gold").verification = {
    ...forgedVerificationSummary.gold_imports.find((item) => item.centerId === "center_keep_gold").verification,
    checksPassed: 1,
    checksTotal: 1
  };
  const forgedVerificationSummaryResult = verifyGold18mCollections(
    forgedVerificationSummary,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(forgedVerificationSummaryResult.checks.find((item) => item.name === "gold_import_manifest_exact")?.ok, false);
  const manifestWithInjectedField = JSON.parse(JSON.stringify(finalized));
  manifestWithInjectedField.gold_imports.find((item) => item.centerId === "center_keep_gold").untrustedFlag = true;
  const manifestWithInjectedFieldResult = verifyGold18mCollections(
    manifestWithInjectedField,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(manifestWithInjectedFieldResult.checks.find((item) => item.name === "gold_import_manifest_exact")?.ok, false);

  const tamperedMarketing = JSON.parse(JSON.stringify(finalized));
  tamperedMarketing.gold_action_outcomes[0].convertedAppointmentId = "gold18m_appointment_00001";
  const tamperedMarketingVerification = verifyGold18mCollections(
    tamperedMarketing,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedMarketingVerification.checks.find((item) => item.name === "gold_marketing_history_coherent")?.ok,
    false
  );

  const tamperedPaymentClient = JSON.parse(JSON.stringify(finalized));
  const successfulOutcome = tamperedPaymentClient.gold_action_outcomes.find((item) => item.success === true);
  const convertedPayment = tamperedPaymentClient.payments.find((item) =>
    item.appointmentId === successfulOutcome.convertedAppointmentId
  );
  convertedPayment.clientId = tamperedPaymentClient.clients.find((item) => item.id !== successfulOutcome.entityId).id;
  const tamperedPaymentClientVerification = verifyGold18mCollections(
    tamperedPaymentClient,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedPaymentClientVerification.checks.find((item) => item.name === "gold_marketing_history_coherent")?.ok,
    false
  );
  assert.strictEqual(
    tamperedPaymentClientVerification.checks.find((item) => item.name === "referential_integrity")?.ok,
    false
  );

  const tamperedFutureRecall = JSON.parse(JSON.stringify(finalized));
  const failedOutcome = tamperedFutureRecall.gold_action_outcomes.find((item) => item.success === false);
  const failedAction = tamperedFutureRecall.ai_marketing_actions.find((item) => item.id === failedOutcome.actionId);
  failedAction.generatedAt = "9999-12-31T23:59:59.000Z";
  failedAction.updatedAt = failedAction.generatedAt;
  failedAction.archivedAt = failedAction.generatedAt;
  failedOutcome.createdAt = failedAction.generatedAt;
  const tamperedFutureRecallVerification = verifyGold18mCollections(
    tamperedFutureRecall,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedFutureRecallVerification.checks.find((item) => item.name === "gold_marketing_history_coherent")?.ok,
    false
  );

  const tamperedInvalidRecallDate = JSON.parse(JSON.stringify(finalized));
  const invalidDateOutcome = tamperedInvalidRecallDate.gold_action_outcomes.find((item) => item.success === false);
  const invalidDateAction = tamperedInvalidRecallDate.ai_marketing_actions.find((item) => item.id === invalidDateOutcome.actionId);
  invalidDateAction.generatedAt = "2026-06-99T10:00:00.000Z";
  invalidDateAction.updatedAt = invalidDateAction.generatedAt;
  invalidDateAction.approvedAt = invalidDateAction.generatedAt;
  invalidDateAction.archivedAt = invalidDateAction.generatedAt;
  invalidDateOutcome.createdAt = invalidDateAction.generatedAt;
  const invalidDateVerification = verifyGold18mCollections(
    tamperedInvalidRecallDate,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    invalidDateVerification.checks.find((item) => item.name === "gold_marketing_history_coherent")?.ok,
    false
  );

  const tamperedTenantPassword = JSON.parse(JSON.stringify(finalized));
  tamperedTenantPassword.users.find((item) => item.id === "user_keep").passwordHash = "tampered-credential";
  const tamperedTenantPasswordVerification = verifyGold18mCollections(
    tamperedTenantPassword,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedTenantPasswordVerification.checks.find((item) => item.name === "tenant_auth_unchanged")?.ok,
    false
  );

  const tamperedTenantRole = JSON.parse(JSON.stringify(finalized));
  tamperedTenantRole.users.find((item) => item.id === "user_keep").role = "owner";
  const tamperedTenantRoleVerification = verifyGold18mCollections(
    tamperedTenantRole,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedTenantRoleVerification.checks.find((item) => item.name === "tenant_auth_unchanged")?.ok,
    false
  );

  for (const [field, value] of [
    ["contactEmail", "recovery-hijack@example.invalid"],
    ["passwordResetTokenHash", "injected-reset-token-digest"],
    ["emailVerificationCode", "injected-verification-code"],
    ["emailVerificationTokenHash", "injected-verification-token-digest"]
  ]) {
    const tamperedRecovery = JSON.parse(JSON.stringify(finalized));
    tamperedRecovery.users.find((item) => item.id === "user_keep")[field] = value;
    const tamperedRecoveryVerification = verifyGold18mCollections(
      tamperedRecovery,
      "center_keep_gold",
      dataset,
      expectedSuperadminDigest,
      expectedTenantAuthDigest
    );
    assert.strictEqual(
      tamperedRecoveryVerification.checks.find((item) => item.name === "tenant_auth_unchanged")?.ok,
      false,
      `Tamper auth non rilevato: ${field}`
    );
  }

  for (const [field, value] of [
    ["centerName", "Tenant alterato"],
    ["businessModel", "hair_only"],
    ["planType", "trial"],
    ["subscriptionPlan", "silver"],
    ["requestedSubscriptionPlan", "base"],
    ["paymentStatus", "pending"],
    ["accountStatus", "suspended"],
    ["goldDatasetVersion", "tampered-version"]
  ]) {
    const tamperedOperationalProfile = JSON.parse(JSON.stringify(finalized));
    tamperedOperationalProfile.users.find((item) => item.id === "user_keep")[field] = value;
    const tamperedOperationalProfileVerification = verifyGold18mCollections(
      tamperedOperationalProfile,
      "center_keep_gold",
      dataset,
      expectedSuperadminDigest,
      expectedTenantAuthDigest
    );
    assert.strictEqual(
      tamperedOperationalProfileVerification.checks.find((item) => item.name === "tenant_operational_profile_exact")?.ok,
      false,
      `Tamper profilo operativo non rilevato: ${field}`
    );
  }

  const restartedProtocolLibrary = JSON.parse(JSON.stringify(finalized));
  restartedProtocolLibrary.protocols
    .filter((item) => item.centerId === "__skinharmony_library")
    .forEach((item) => {
      item.createdAt = "2026-07-26T14:00:00.000Z";
      item.updatedAt = "2026-07-26T14:00:00.000Z";
    });
  const restartedProtocolLibraryVerification = verifyGold18mCollections(
    restartedProtocolLibrary,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    restartedProtocolLibraryVerification.checks.find((item) => item.name === "canonical_global_protocols_exact")?.ok,
    true
  );

  const tamperedGlobalProtocol = JSON.parse(JSON.stringify(finalized));
  tamperedGlobalProtocol.protocols.find((item) => item.centerId === "__skinharmony_library").title = "Protocollo alterato";
  const tamperedGlobalProtocolVerification = verifyGold18mCollections(
    tamperedGlobalProtocol,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedGlobalProtocolVerification.checks.find((item) => item.name === "canonical_global_protocols_exact")?.ok,
    false
  );

  const tamperedGlobalProtocolExtra = JSON.parse(JSON.stringify(finalized));
  tamperedGlobalProtocolExtra.protocols.find((item) => item.centerId === "__skinharmony_library").untrustedInstruction = "Injected";
  const tamperedGlobalProtocolExtraVerification = verifyGold18mCollections(
    tamperedGlobalProtocolExtra,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedGlobalProtocolExtraVerification.checks.find((item) => item.name === "canonical_global_protocols_exact")?.ok,
    false
  );

  const tamperedGlobalProtocolDuplicate = JSON.parse(JSON.stringify(finalized));
  const globalProtocolIndexes = tamperedGlobalProtocolDuplicate.protocols
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.centerId === "__skinharmony_library");
  tamperedGlobalProtocolDuplicate.protocols[globalProtocolIndexes[0].index] = JSON.parse(
    JSON.stringify(globalProtocolIndexes[1].item)
  );
  const tamperedGlobalProtocolDuplicateVerification = verifyGold18mCollections(
    tamperedGlobalProtocolDuplicate,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedGlobalProtocolDuplicateVerification.checks.find((item) => item.name === "canonical_global_protocols_exact")?.ok,
    false
  );

  const tamperedWhatsappSettings = JSON.parse(JSON.stringify(finalized));
  tamperedWhatsappSettings.settings.center_keep_gold.whatsappGoldMode = "active";
  tamperedWhatsappSettings.settings.center_keep_gold.whatsappTwilioAccountSid = "injected";
  const tamperedWhatsappSettingsVerification = verifyGold18mCollections(
    tamperedWhatsappSettings,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedWhatsappSettingsVerification.checks.find((item) => item.name === "settings_dataset_exact")?.ok,
    false
  );

  const tamperedSuggestedMessage = JSON.parse(JSON.stringify(finalized));
  tamperedSuggestedMessage.ai_marketing_actions[0].suggestedMessage = "Messaggio esterno iniettato";
  const tamperedSuggestedMessageVerification = verifyGold18mCollections(
    tamperedSuggestedMessage,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedSuggestedMessageVerification.checks.find((item) => item.name === "gold_marketing_payload_exact")?.ok,
    false
  );
  assert.strictEqual(
    tamperedSuggestedMessageVerification.checks.find((item) => item.name === "managed_dataset_payload_exact")?.ok,
    false
  );

  const tamperedWhatsappQueue = JSON.parse(JSON.stringify(finalized));
  tamperedWhatsappQueue.whatsapp_messages.push({
    id: "unexpected_message",
    centerId: "center_keep_gold",
    status: "queued"
  });
  const tamperedWhatsappQueueVerification = verifyGold18mCollections(
    tamperedWhatsappQueue,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedWhatsappQueueVerification.checks.find((item) => item.name === "whatsapp_queue_empty")?.ok,
    false
  );

  const tamperedAppointmentPayload = JSON.parse(JSON.stringify(finalized));
  tamperedAppointmentPayload.appointments[0].notes = "Payload alterato";
  const tamperedAppointmentVerification = verifyGold18mCollections(
    tamperedAppointmentPayload,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(
    tamperedAppointmentVerification.checks.find((item) => item.name === "managed_dataset_payload_exact")?.ok,
    false
  );
  assert.strictEqual(
    tamperedAppointmentVerification.checks.find((item) => item.name === "dataset_digest_matches")?.ok,
    false
  );

  const forged = JSON.parse(JSON.stringify(finalized));
  forged.protocols.push({
    id: "other_protocol",
    centerId: "other_center",
    libraryScope: "center"
  });
  forged.settings.other_center = { centerId: "other_center" };
  const forgedVerification = verifyGold18mCollections(
    forged,
    "center_keep_gold",
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  assert.strictEqual(forgedVerification.ok, false);
  assert.strictEqual(forgedVerification.checks.find((item) => item.name === "cross_tenant_residue_zero").ok, false);
  assert.strictEqual(forgedVerification.checks.find((item) => item.name === "settings_keys_exact").ok, false);

  const protoPayload = JSON.parse('{"a":1,"__proto__":{"polluted":true}}');
  assert.notStrictEqual(stableStringify(protoPayload), stableStringify({ a: 1 }));

  ["", "center_admin", "__skinharmony_library", "__proto__", "bad center", "*"].forEach((value) => {
    assert.throws(() => assertSafeTargetCenterId(value));
  });

  console.log(JSON.stringify({
    success: true,
    datasetVersion: DATASET_VERSION,
    checks: {
      generator: "pass",
      exactTotals: "pass",
      superadminBytePreservation: "pass",
      exactPrune: "pass",
      globalProtocolGuard: "pass",
      waveIdempotency: "pass",
      referentialIntegrity: "pass",
      unsafeTargetRejection: "pass"
    },
    totals: verification.totals
  }, null, 2));
}

run();
