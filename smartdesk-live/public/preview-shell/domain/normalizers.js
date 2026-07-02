export function createSmartDeskNormalizers({ state, t, currentLanguage }) {
  function normalizeClient(item) {
    const fullName = item.fullName || item.name || `${item.firstName || ""} ${item.lastName || ""}`.trim();
    return {
      ...item,
      name: fullName,
      firstName: item.firstName || fullName.split(" ")[0] || "",
      lastName: item.lastName || fullName.split(" ").slice(1).join(" "),
      preferences: Array.isArray(item.preferences) ? item.preferences : String(item.preferences || "").split(",").map((v) => v.trim()).filter(Boolean),
      activePlans: Array.isArray(item.activePlans) ? item.activePlans : String(item.packages || item.activePlans || "").split(",").map((v) => v.trim()).filter(Boolean),
      totalValue: Number(item.totalValue || 0),
      allergies: item.allergies || "",
      privacyConsent: Boolean(item.privacyConsent),
      marketingConsent: Boolean(item.marketingConsent),
      sensitiveDataConsent: Boolean(item.sensitiveDataConsent),
      recallDue: item.recallDue || "",
      recommendedProtocol: item.recommendedProtocol || "",
      photoStatus: item.photoStatus || "",
      loyaltyTier: item.loyaltyTier || "base"
    };
  }

  function normalizeAppointment(item) {
    const startAt = item.startAt || `${item.date || state.agendaDate}T${item.time || "09:00"}:00`;
    const [datePart, timePartRaw = "09:00:00"] = startAt.split("T");
    return {
      ...item,
      client: item.client || item.clientName || t("agendaView.client"),
      service: item.service || item.serviceName || (currentLanguage() === "en" ? "Service" : "Servizio"),
      operator: item.operator || item.staffName || (currentLanguage() === "en" ? "Operator" : "Operatore"),
      room: item.room || item.resourceName || t("agendaView.roomFallback"),
      date: item.date || datePart,
      time: item.time || timePartRaw.slice(0, 5),
      duration: Number(item.duration || item.durationMin || 45)
    };
  }

  function normalizeService(item) {
    return {
      ...item,
      duration: Number(item.duration || 45),
      price: Number(item.price || 0)
    };
  }

  function normalizeStaff(item) {
    return {
      ...item,
      active: item.active !== false,
      targetProgress: Number(item.targetProgress || 0),
      hourlyCostCents: Number(item.hourlyCostCents || item.hourlyCost || 0),
      netSalaryCents: Number(item.netSalaryCents || item.monthlyNetSalaryCents || 0),
      grossSalaryCents: Number(item.grossSalaryCents || item.monthlyGrossSalaryCents || item.payrollCostCents || 0)
    };
  }

  function normalizeInventoryItem(item) {
    return {
      ...item,
      stockQuantity: Number(item.stockQuantity ?? item.stock ?? 0),
      thresholdQuantity: Number(item.thresholdQuantity ?? item.threshold ?? 0),
      costCents: Number(item.costCents ?? 0),
      retailPriceCents: Number(item.retailPriceCents ?? 0),
      costPerUseCents: Number(item.costPerUseCents ?? 0),
      unit: item.unit || t("inventoryView.quantityUnitFallback")
    };
  }

  function normalizeInventoryMovement(item) {
    return {
      ...item,
      quantity: Number(item.quantity || 0),
      createdAt: item.createdAt || new Date().toISOString()
    };
  }

  function normalizeProfitabilityOverview(payload) {
    if (!payload || typeof payload !== "object") {
      return {
        available: false,
        totals: { executions: 0, revenueCents: 0, costCents: 0, profitCents: 0 },
        services: [],
        products: [],
        technologies: [],
        alerts: []
      };
    }
    return {
      available: true,
      totals: {
        executions: Number(payload.totals?.executions || 0),
        revenueCents: Number(payload.totals?.revenueCents || 0),
        costCents: Number(payload.totals?.costCents || 0),
        profitCents: Number(payload.totals?.profitCents || 0)
      },
      operatingCostMinuteProfile: payload.operatingCostMinuteProfile || null,
      services: Array.isArray(payload.services) ? payload.services : [],
      products: Array.isArray(payload.products) ? payload.products : [],
      technologies: Array.isArray(payload.technologies) ? payload.technologies : [],
      alerts: Array.isArray(payload.alerts) ? payload.alerts : []
    };
  }

  function normalizeTreatment(item) {
    return {
      ...item,
      createdAt: item.createdAt || new Date().toISOString()
    };
  }

  return {
    normalizeClient,
    normalizeAppointment,
    normalizeService,
    normalizeStaff,
    normalizeInventoryItem,
    normalizeInventoryMovement,
    normalizeProfitabilityOverview,
    normalizeTreatment
  };
}
