const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeKey(value = "") {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function cleanText(value = "", max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanPhone(value = "") {
  return String(value || "").replace(/[^\d+]/g, "").slice(0, 30);
}

function cleanEmail(value = "") {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

function parseAmountCents(value) {
  if (typeof value === "number") return Math.round(value * 100);
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function parseDateTime(row = {}, mapping = {}) {
  const dateValue = row[mapping.date] || row[mapping.createdAt] || row[mapping.startAt] || "";
  const timeValue = row[mapping.time] || "";
  if (!dateValue) return "";
  if (dateValue instanceof Date && Number.isFinite(dateValue.getTime())) {
    const iso = dateValue.toISOString();
    return timeValue ? `${iso.slice(0, 10)}T${String(timeValue).slice(0, 5)}:00.000Z` : iso;
  }
  const raw = String(dateValue).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T${String(timeValue || "09:00").slice(0, 5)}:00.000Z`;
  const italian = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (italian) {
    const year = italian[3].length === 2 ? `20${italian[3]}` : italian[3];
    return `${year}-${italian[2].padStart(2, "0")}-${italian[1].padStart(2, "0")}T${String(timeValue || "09:00").slice(0, 5)}:00.000Z`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function parseCsv(content = "") {
  const rows = [];
  let current = [];
  let field = "";
  let quoted = false;
  const text = String(content || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === "," || char === ";" || char === "\t") && !quoted) {
      current.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      current.push(field);
      if (current.some((item) => String(item || "").trim())) rows.push(current);
      current = [];
      field = "";
    } else {
      field += char;
    }
  }
  current.push(field);
  if (current.some((item) => String(item || "").trim())) rows.push(current);
  if (!rows.length) return [];
  const headers = rows[0].map((header, index) => normalizeKey(header || `col_${index + 1}`) || `col_${index + 1}`);
  return rows.slice(1).map((values, rowIndex) => {
    const row = { __rowNumber: rowIndex + 2 };
    headers.forEach((header, index) => {
      row[header] = cleanText(values[index] || "", 2000);
    });
    return row;
  });
}

function parseXlsx(buffer) {
  let xlsx = null;
  try {
    xlsx = require("xlsx");
  } catch {
    throw new Error("Parser Excel non disponibile sul backend. Carica CSV oppure installa la dipendenza xlsx.");
  }
  const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });
  return workbook.SheetNames.flatMap((sheetName) => {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    return rows.map((row, index) => {
      const normalized = { __sheetName: sheetName, __rowNumber: index + 2 };
      Object.entries(row).forEach(([key, value]) => {
        normalized[normalizeKey(key)] = value;
      });
      return normalized;
    });
  });
}

const FIELD_SYNONYMS = {
  name: ["nome", "cliente", "nominativo", "ragione_sociale", "full_name", "nome_cliente", "customer", "customer_name"],
  firstName: ["nome_proprio", "first_name"],
  lastName: ["cognome", "last_name"],
  phone: ["telefono", "cellulare", "mobile", "whatsapp", "tel", "phone"],
  email: ["email", "mail", "e_mail"],
  birthDate: ["data_nascita", "nascita", "birthday"],
  marketingConsent: ["consenso_marketing", "marketing", "privacy_marketing"],
  date: ["data", "giorno", "appointment_date", "data_appuntamento", "created_date"],
  time: ["ora", "orario", "time", "start_time"],
  startAt: ["inizio", "data_ora", "start", "start_at"],
  serviceName: ["servizio", "trattamento", "prestazione", "service", "service_name"],
  staffName: ["operatore", "staff", "dipendente", "collaboratore", "operator"],
  durationMin: ["durata", "durata_minuti", "duration", "duration_min"],
  status: ["stato", "status", "esito"],
  amount: ["importo", "totale", "pagato", "incasso", "amount", "prezzo", "valore"],
  method: ["metodo", "pagamento", "metodo_pagamento", "payment_method", "method"],
  note: ["note", "descrizione", "memo"]
};

function buildMapping(headers = []) {
  const mapping = {};
  Object.entries(FIELD_SYNONYMS).forEach(([field, synonyms]) => {
    const found = headers.find((header) => synonyms.includes(header));
    if (found) mapping[field] = found;
  });
  return mapping;
}

function detectFileTypeFromHeaders(headers = []) {
  const headerSet = new Set(headers);
  const hasPayment = ["importo", "totale", "pagato", "incasso", "amount"].some((key) => headerSet.has(key));
  const hasAppointment = ["data_appuntamento", "servizio", "trattamento", "operatore", "ora", "start_at"].some((key) => headerSet.has(key));
  const hasCustomer = ["nome", "cliente", "nominativo", "telefono", "email", "cellulare"].some((key) => headerSet.has(key));
  const count = [hasPayment, hasAppointment, hasCustomer].filter(Boolean).length;
  if (count >= 2) return "mixed";
  if (hasPayment) return "payments";
  if (hasAppointment) return "appointments";
  if (hasCustomer) return "customers";
  return "mixed";
}

function indexExistingClients(clients = []) {
  const byEmail = new Map();
  const byPhone = new Map();
  const byName = new Map();
  clients.forEach((client) => {
    if (client.email) byEmail.set(cleanEmail(client.email), client);
    if (client.phone) byPhone.set(cleanPhone(client.phone), client);
    const name = normalizeText(client.name || `${client.firstName || ""} ${client.lastName || ""}`);
    if (name) byName.set(name, client);
  });
  return { byEmail, byPhone, byName };
}

class GoldOnboardingEngine {
  constructor({ service, importRepository }) {
    this.service = service;
    this.importRepository = importRepository;
  }

  decodeFile(file = {}) {
    const name = cleanText(file.name || "import.csv", 240);
    const lower = name.toLowerCase();
    const rawContent = String(file.content || "");
    const base64 = String(file.contentBase64 || "");
    if (lower.endsWith(".xlsx")) {
      if (!base64) throw new Error(`File Excel ${name}: contenuto base64 mancante`);
      const buffer = Buffer.from(base64, "base64");
      return { name, format: "xlsx", rows: parseXlsx(buffer) };
    }
    const text = rawContent || (base64 ? Buffer.from(base64, "base64").toString("utf8") : "");
    return { name, format: "csv", rows: parseCsv(text) };
  }

  detectFileType(file) {
    const headers = Object.keys(file.rows[0] || {}).filter((key) => !key.startsWith("__"));
    return detectFileTypeFromHeaders(headers);
  }

  classifyRow(row = {}, fallbackType = "mixed") {
    const headers = Object.keys(row).filter((key) => !key.startsWith("__"));
    const type = detectFileTypeFromHeaders(headers);
    if (fallbackType !== "mixed") return fallbackType;
    return type;
  }

  normalizeCustomer(row = {}, mapping = {}) {
    const providedName = cleanText(row[mapping.name] || "", 180);
    const firstName = cleanText(row[mapping.firstName] || "", 80);
    const lastName = cleanText(row[mapping.lastName] || "", 80);
    const name = providedName || `${firstName} ${lastName}`.trim();
    return {
      name,
      firstName,
      lastName,
      phone: cleanPhone(row[mapping.phone] || ""),
      email: cleanEmail(row[mapping.email] || ""),
      birthDate: cleanText(row[mapping.birthDate] || "", 30),
      marketingConsent: ["si", "sì", "yes", "true", "1"].includes(normalizeText(row[mapping.marketingConsent] || "")),
      notes: cleanText(row[mapping.note] || "", 500)
    };
  }

  normalizeAppointment(row = {}, mapping = {}) {
    return {
      clientName: cleanText(row[mapping.name] || row[mapping.clientName] || "", 180),
      serviceName: cleanText(row[mapping.serviceName] || "", 160),
      staffName: cleanText(row[mapping.staffName] || "", 120),
      startAt: parseDateTime(row, mapping),
      durationMin: Number(row[mapping.durationMin] || 45) || 45,
      status: cleanText(row[mapping.status] || "completed", 40),
      notes: cleanText(row[mapping.note] || "", 500)
    };
  }

  normalizePayment(row = {}, mapping = {}) {
    return {
      walkInName: cleanText(row[mapping.name] || "", 180),
      amountCents: parseAmountCents(row[mapping.amount]),
      method: cleanText(row[mapping.method] || "cash", 40),
      createdAt: parseDateTime(row, { ...mapping, date: mapping.date || mapping.createdAt }) || nowIso(),
      note: cleanText(row[mapping.note] || "", 500)
    };
  }

  recordSnapshotItem(type, row, normalized, status, reasons = [], extra = {}) {
    return {
      id: makeId(`imp_${type}`),
      sourceRow: row.__rowNumber || null,
      sourceSheet: row.__sheetName || "",
      type,
      status,
      reasons,
      normalized,
      ...extra
    };
  }

  buildSnapshots(files = [], session = null) {
    const existingClients = this.service.filterByCenter(this.service.clientsRepository.list(), session);
    const clientIndex = indexExistingClients(existingClients);
    const seenCustomers = new Set();
    const snapshots = {
      import_customers_snapshot: { validRows: [], reviewRows: [], invalidRows: [], duplicates: [] },
      import_appointments_snapshot: { validRows: [], reviewRows: [], invalidRows: [], duplicates: [] },
      import_payments_snapshot: { validRows: [], reviewRows: [], invalidRows: [], duplicates: [] }
    };
    const fileSummaries = [];

    files.forEach((rawFile) => {
      const file = this.decodeFile(rawFile);
      const detectedType = this.detectFileType(file);
      fileSummaries.push({ name: file.name, format: file.format, detectedType, rows: file.rows.length });
      const headers = Object.keys(file.rows[0] || {}).filter((key) => !key.startsWith("__"));
      const mapping = buildMapping(headers);

      file.rows.forEach((row) => {
        const type = this.classifyRow(row, detectedType);
        const shouldCreateCustomer = type === "customers" || type === "appointments" || type === "payments" || detectedType === "mixed";
        if (shouldCreateCustomer) {
          const customer = this.normalizeCustomer(row, mapping);
          const duplicateKey = customer.email || customer.phone || normalizeText(customer.name);
          const existing = customer.email ? clientIndex.byEmail.get(customer.email) : customer.phone ? clientIndex.byPhone.get(customer.phone) : clientIndex.byName.get(normalizeText(customer.name));
          const duplicateInFile = duplicateKey && seenCustomers.has(duplicateKey);
          if (duplicateKey) seenCustomers.add(duplicateKey);
          if (!customer.name || customer.name.length < 2) {
            snapshots.import_customers_snapshot.invalidRows.push(this.recordSnapshotItem("customer", row, customer, "INVALID", ["Nome cliente mancante"]));
          } else if (existing || duplicateInFile) {
            const item = this.recordSnapshotItem("customer", row, customer, "REVIEW", [existing ? "Possibile cliente già presente" : "Possibile duplicato nel file"], { duplicateOf: existing?.id || "" });
            snapshots.import_customers_snapshot.reviewRows.push(item);
            snapshots.import_customers_snapshot.duplicates.push(item);
          } else {
            snapshots.import_customers_snapshot.validRows.push(this.recordSnapshotItem("customer", row, customer, "SAFE"));
          }
        }

        if (type === "appointments" || detectedType === "mixed") {
          const appointment = this.normalizeAppointment(row, mapping);
          if (!appointment.startAt || !appointment.clientName) {
            snapshots.import_appointments_snapshot.invalidRows.push(this.recordSnapshotItem("appointment", row, appointment, "INVALID", ["Data o cliente appuntamento mancante"]));
          } else if (!appointment.serviceName || !appointment.staffName) {
            snapshots.import_appointments_snapshot.reviewRows.push(this.recordSnapshotItem("appointment", row, appointment, "REVIEW", ["Servizio o operatore da confermare"]));
          } else {
            snapshots.import_appointments_snapshot.validRows.push(this.recordSnapshotItem("appointment", row, appointment, "SAFE"));
          }
        }

        if (type === "payments" || detectedType === "mixed") {
          const payment = this.normalizePayment(row, mapping);
          if (payment.amountCents <= 0) {
            snapshots.import_payments_snapshot.invalidRows.push(this.recordSnapshotItem("payment", row, payment, "INVALID", ["Importo pagamento non valido"]));
          } else if (!payment.walkInName) {
            snapshots.import_payments_snapshot.reviewRows.push(this.recordSnapshotItem("payment", row, payment, "REVIEW", ["Cliente pagamento da confermare"]));
          } else {
            snapshots.import_payments_snapshot.validRows.push(this.recordSnapshotItem("payment", row, payment, "SAFE"));
          }
        }
      });
    });

    return { snapshots, fileSummaries };
  }

  analyze(payload = {}, session = null) {
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length) throw new Error("Carica almeno un file CSV o Excel.");
    const { snapshots, fileSummaries } = this.buildSnapshots(files, session);
    const importId = makeId("gold_import");
    const record = {
      id: importId,
      centerId: this.service.getCenterId(session),
      centerName: this.service.getCenterName(session),
      status: "analyzed",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      fileSummaries,
      snapshots,
      summary: this.summarizeSnapshots(snapshots),
      aiResolution: {
        enabled: true,
        mode: "assisted_review",
        rule: "L'AI suggerisce mapping e collegamenti, ma i record dubbi restano REVIEW fino a conferma utente."
      }
    };
    this.importRepository.create(record);
    return { success: true, importId, ...record };
  }

  summarizeSnapshots(snapshots = {}) {
    const blocks = Object.values(snapshots);
    const safe = blocks.reduce((sum, block) => sum + block.validRows.length, 0);
    const review = blocks.reduce((sum, block) => sum + block.reviewRows.length, 0);
    const invalid = blocks.reduce((sum, block) => sum + block.invalidRows.length, 0);
    const duplicates = blocks.reduce((sum, block) => sum + block.duplicates.length, 0);
    return { safeRecords: safe, reviewRecords: review, invalidRecords: invalid, duplicates };
  }

  confirm(payload = {}, session = null) {
    const importId = String(payload.importId || "");
    const record = this.importRepository.findById(importId);
    if (!record || String(record.centerId || "") !== this.service.getCenterId(session)) {
      throw new Error("Import Gold non trovato per questo centro.");
    }
    if (record.status === "imported") return record.result;
    const decisions = payload.decisions && typeof payload.decisions === "object" ? payload.decisions : {};
    const shouldImportReview = (item) => decisions[item.id] === "approve";
    const snapshots = record.snapshots || {};
    const created = { customers: [], appointments: [], payments: [] };
    const skippedReview = [];
    const clientByName = new Map();

    this.service.filterByCenter(this.service.clientsRepository.list(), session).forEach((client) => {
      clientByName.set(normalizeText(client.name || `${client.firstName || ""} ${client.lastName || ""}`), client);
    });

    const customerRows = [
      ...(snapshots.import_customers_snapshot?.validRows || []),
      ...(snapshots.import_customers_snapshot?.reviewRows || []).filter(shouldImportReview)
    ];
    (snapshots.import_customers_snapshot?.reviewRows || []).filter((item) => !shouldImportReview(item)).forEach((item) => skippedReview.push(item.id));
    customerRows.forEach((item) => {
      const customer = item.normalized || {};
      const existing = clientByName.get(normalizeText(customer.name));
      if (existing && item.status !== "SAFE") return;
      const saved = this.service.saveClient({
        ...customer,
        idempotencyKey: `gold-onboarding:${importId}:customer:${item.id}`,
        consentSource: "import_gold_onboarding"
      }, session);
      created.customers.push(saved);
      clientByName.set(normalizeText(saved.name), saved);
    });

    const appointmentRows = [
      ...(snapshots.import_appointments_snapshot?.validRows || []),
      ...(snapshots.import_appointments_snapshot?.reviewRows || []).filter(shouldImportReview)
    ];
    (snapshots.import_appointments_snapshot?.reviewRows || []).filter((item) => !shouldImportReview(item)).forEach((item) => skippedReview.push(item.id));
    appointmentRows.forEach((item) => {
      const appointment = item.normalized || {};
      const client = clientByName.get(normalizeText(appointment.clientName || ""));
      const saved = this.service.saveAppointment({
        ...appointment,
        clientId: client?.id || "",
        idempotencyKey: `gold-onboarding:${importId}:appointment:${item.id}`
      }, session);
      created.appointments.push(saved);
    });

    const appointmentByClientAndDay = new Map();
    created.appointments.concat(this.service.filterByCenter(this.service.appointmentsRepository.list(), session)).forEach((appointment) => {
      const key = `${normalizeText(appointment.clientName || appointment.walkInName || "")}:${String(appointment.startAt || "").slice(0, 10)}`;
      if (key !== ":") appointmentByClientAndDay.set(key, appointment);
    });
    const paymentRows = [
      ...(snapshots.import_payments_snapshot?.validRows || []),
      ...(snapshots.import_payments_snapshot?.reviewRows || []).filter(shouldImportReview)
    ];
    (snapshots.import_payments_snapshot?.reviewRows || []).filter((item) => !shouldImportReview(item)).forEach((item) => skippedReview.push(item.id));
    paymentRows.forEach((item) => {
      const payment = item.normalized || {};
      const client = clientByName.get(normalizeText(payment.walkInName || ""));
      const dateKey = `${normalizeText(payment.walkInName || "")}:${String(payment.createdAt || "").slice(0, 10)}`;
      const appointment = appointmentByClientAndDay.get(dateKey);
      const saved = this.service.createPayment({
        ...payment,
        clientId: client?.id || "",
        appointmentId: appointment?.id || "",
        idempotencyKey: `gold-onboarding:${importId}:payment:${item.id}`
      }, session);
      created.payments.push(saved);
    });

    const rebuild = this.service.rebuildGoldStateForCurrentGoldTenant(session, {
      reason: "gold_onboarding_import",
      importId
    });
    const pial = this.service.getProgressiveIntelligenceStatus(session, { force: true, reason: "gold_onboarding_import" });
    const result = {
      success: true,
      importId,
      imported: {
        customers: created.customers.length,
        appointments: created.appointments.length,
        payments: created.payments.length
      },
      skippedReview,
      excludedInvalid: this.summarizeSnapshots(snapshots).invalidRecords,
      rebuild: {
        valid: rebuild.valid,
        eventSeq: rebuild.eventSeq
      },
      progressiveIntelligence: {
        maturityScore: pial.maturityScore,
        activationLevel: pial.activationLevel,
        enabledFeatures: pial.enabledFeatures
      }
    };
    this.importRepository.update(importId, (current) => ({
      ...current,
      status: "imported",
      result,
      importedAt: nowIso(),
      updatedAt: nowIso()
    }));
    return result;
  }

  list(session = null) {
    const centerId = this.service.getCenterId(session);
    return this.importRepository.list()
      .filter((item) => String(item.centerId || "") === centerId)
      .map((item) => ({
        id: item.id,
        status: item.status,
        createdAt: item.createdAt,
        importedAt: item.importedAt || "",
        summary: item.summary,
        fileSummaries: item.fileSummaries || [],
        result: item.result || null
      }));
  }
}

module.exports = {
  GoldOnboardingEngine
};
