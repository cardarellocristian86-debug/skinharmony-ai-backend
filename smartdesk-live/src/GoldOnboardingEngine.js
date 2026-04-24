const crypto = require("crypto");

const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_XLSX_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx"]);
const ALLOWED_MIME_TYPES = new Set([
  "",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const ALLOWED_DECLARED_TYPES = new Set(["customers", "appointments", "payments"]);

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeFileContentForHash(value = "") {
  return String(value || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function fileExtension(name = "") {
  const match = String(name || "").toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : "";
}

function normalizeKey(value = "") {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function cleanText(value = "", max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanPhone(value = "") {
  const phone = String(value || "").replace(/[^\d+]/g, "").slice(0, 30);
  if (phone.startsWith("+39")) return phone.slice(3);
  if (phone.startsWith("0039")) return phone.slice(4);
  return phone;
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

function parseXlsx(buffer, fileName = "import.xlsx") {
  let xlsx = null;
  try {
    xlsx = require("xlsx");
  } catch {
    throw new Error("Parser Excel non disponibile sul backend. Carica CSV oppure installa la dipendenza xlsx.");
  }
  try {
    const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true, bookVBA: false });
    const formulaCells = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      Object.entries(sheet || {}).forEach(([cell, value]) => {
        if (cell.startsWith("!")) return;
        if (value && typeof value === "object" && value.f) {
          formulaCells.push(`${sheetName}!${cell}`);
        }
      });
    });
    if (formulaCells.length) {
      throw new Error(`File Excel ${fileName}: contiene formule. Esporta in CSV o incolla valori statici prima dell'import.`);
    }
    return workbook.SheetNames.flatMap((sheetName) => {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
      return rows.map((row, index) => {
        const normalized = { __sheetName: sheetName, __rowNumber: index + 2 };
        Object.entries(row).forEach(([key, value]) => {
          normalized[normalizeKey(key)] = value;
        });
        return normalized;
      });
    });
  } catch (error) {
    console.warn("[gold_onboarding_parser_error]", JSON.stringify({
      fileName,
      format: "xlsx",
      message: error instanceof Error ? error.message : "Excel non leggibile"
    }));
    throw error instanceof Error ? error : new Error(`File Excel ${fileName}: errore lettura.`);
  }
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
  const hasCustomer = [
    "first_name",
    "last_name",
    "telefono",
    "email",
    "cellulare",
    "data_nascita",
    "consenso_marketing",
    "marketing",
    "privacy_marketing"
  ].some((key) => headerSet.has(key));
  if (hasAppointment && hasPayment) return "mixed";
  if (hasAppointment) return "appointments";
  if (hasPayment) return "payments";
  if (hasCustomer) return "customers";
  return "mixed";
}

function normalizeDeclaredType(value = "") {
  const normalized = normalizeText(value);
  return ALLOWED_DECLARED_TYPES.has(normalized) ? normalized : "";
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

function customerComparableName(customer = {}) {
  return normalizeText(customer.name || `${customer.firstName || ""} ${customer.lastName || ""}`);
}

function phoneCompatible(a = "", b = "") {
  const left = cleanPhone(a);
  const right = cleanPhone(b);
  if (!left || !right) return false;
  return left === right || (left.length >= 7 && right.length >= 7 && (left.endsWith(right) || right.endsWith(left)));
}

function evaluateCustomerMatch(customer = {}, clientIndex = {}) {
  const email = cleanEmail(customer.email || "");
  const phone = cleanPhone(customer.phone || "");
  const name = customerComparableName(customer);
  if (email && clientIndex.byEmail?.has(email)) {
    return { confidence: 1, reason: "Email già presente", duplicateOf: clientIndex.byEmail.get(email) };
  }
  if (phone && clientIndex.byPhone?.has(phone)) {
    return { confidence: 0.96, reason: "Telefono già presente", duplicateOf: clientIndex.byPhone.get(phone) };
  }
  const sameName = name ? clientIndex.byName?.get(name) : null;
  if (sameName && phoneCompatible(phone, sameName.phone)) {
    return { confidence: 0.86, reason: "Nome e telefono compatibili", duplicateOf: sameName };
  }
  if (sameName && email && cleanEmail(sameName.email || "") === email) {
    return { confidence: 0.86, reason: "Nome ed email compatibili", duplicateOf: sameName };
  }
  if (sameName && (phone || email || customer.birthDate)) {
    return { confidence: 0.62, reason: "Nome già presente con dati parziali compatibili", duplicateOf: sameName };
  }
  if (sameName) {
    return { confidence: 0.48, reason: "Nome già presente, dati insufficienti", duplicateOf: sameName };
  }
  return { confidence: 0, reason: "", duplicateOf: null };
}

function pushSnapshotRow(block, item) {
  if (item.status === "SAFE") {
    block.validRows.push(item);
  } else if (item.status === "REVIEW") {
    block.reviewRows.push(item);
    if (item.duplicateOf || item.matchConfidence >= 0.45) block.duplicates.push(item);
  } else {
    block.invalidRows.push(item);
  }
}

class GoldOnboardingEngine {
  constructor({ service, importRepository }) {
    this.service = service;
    this.importRepository = importRepository;
  }

  validateRawFile(file = {}) {
    const name = cleanText(file.name || "import.csv", 240);
    const ext = fileExtension(name);
    const mimeType = String(file.mimeType || file.type || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`File ${name}: formato non ammesso. Usa CSV o XLSX.`);
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error(`File ${name}: tipo file non ammesso. Usa CSV o XLSX esportati dal gestionale.`);
    }
    if (ext === ".xlsm" || String(name).toLowerCase().endsWith(".xlsm")) {
      throw new Error(`File ${name}: macro non ammesse. Esporta in CSV o XLSX senza macro.`);
    }
    const base64 = String(file.contentBase64 || "");
    const rawContent = String(file.content || "");
    const estimatedBytes = base64 ? Math.ceil((base64.length * 3) / 4) : Buffer.byteLength(rawContent, "utf8");
    const limit = ext === ".xlsx" ? MAX_XLSX_FILE_BYTES : MAX_IMPORT_FILE_BYTES;
    if (estimatedBytes > limit) {
      throw new Error(`File ${name}: dimensione troppo alta. Limite ${Math.round(limit / 1024 / 1024)} MB.`);
    }
    return { name, ext, mimeType, estimatedBytes };
  }

  decodeFile(file = {}) {
    const validation = this.validateRawFile(file);
    const name = validation.name;
    const lower = name.toLowerCase();
    const rawContent = String(file.content || "");
    const base64 = String(file.contentBase64 || "");
    if (lower.endsWith(".xlsx")) {
      if (!base64) throw new Error(`File Excel ${name}: contenuto base64 mancante`);
      const buffer = Buffer.from(base64, "base64");
      const fileHash = sha256(buffer);
      const rows = parseXlsx(buffer, name);
      if (!rows.length) throw new Error(`File Excel ${name}: nessuna riga leggibile.`);
      return {
        name,
        format: "xlsx",
        fileHash,
        bytes: validation.estimatedBytes,
        rows,
        declaredType: normalizeDeclaredType(file.declaredType || file.typeHint || "")
      };
    }
    const text = rawContent || (base64 ? Buffer.from(base64, "base64").toString("utf8") : "");
    const normalizedText = normalizeFileContentForHash(text);
    const rows = parseCsv(normalizedText);
    if (!rows.length) throw new Error(`File CSV ${name}: nessuna riga leggibile.`);
    const fileHash = sha256(Buffer.from(normalizedText, "utf8"));
    return {
      name,
      format: "csv",
      fileHash,
      bytes: validation.estimatedBytes,
      rows,
      declaredType: normalizeDeclaredType(file.declaredType || file.typeHint || "")
    };
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
    const fileHashes = [];

    files.forEach((rawFile) => {
      const file = this.decodeFile(rawFile);
      const detectedType = this.detectFileType(file);
      const declaredType = normalizeDeclaredType(rawFile.declaredType || file.declaredType || "");
      if (!declaredType) {
        throw new Error(`File ${file.name}: specifica il tipo file (customers, appointments o payments).`);
      }
      if (detectedType === "mixed") {
        throw new Error(`File ${file.name}: header ambigui. Usa un file dedicato per ${declaredType}.`);
      }
      if (detectedType !== declaredType) {
        throw new Error(`File ${file.name}: tipo dichiarato ${declaredType} ma header rilevati come ${detectedType}.`);
      }
      fileHashes.push(file.fileHash);
      fileSummaries.push({
        name: file.name,
        format: file.format,
        fileHash: file.fileHash,
        detectedType,
        declaredType,
        rows: file.rows.length,
        bytes: file.bytes
      });
      const headers = Object.keys(file.rows[0] || {}).filter((key) => !key.startsWith("__"));
      const mapping = buildMapping(headers);

      file.rows.forEach((row) => {
        const type = declaredType;
        const shouldCreateCustomer = type === "customers";
        if (shouldCreateCustomer) {
          const customer = this.normalizeCustomer(row, mapping);
          const duplicateKey = customer.email || customer.phone || normalizeText(customer.name);
          const match = evaluateCustomerMatch(customer, clientIndex);
          const duplicateInFile = duplicateKey && seenCustomers.has(duplicateKey);
          if (duplicateKey) seenCustomers.add(duplicateKey);
          if (!customer.name || customer.name.length < 2) {
            pushSnapshotRow(snapshots.import_customers_snapshot, this.recordSnapshotItem("customer", row, customer, "INVALID", ["Nome cliente mancante"]));
          } else if (match.confidence >= 0.45 || duplicateInFile) {
            pushSnapshotRow(snapshots.import_customers_snapshot, this.recordSnapshotItem("customer", row, customer, "REVIEW", [duplicateInFile ? "Possibile duplicato nel file" : match.reason], {
              duplicateOf: match.duplicateOf?.id || "",
              matchConfidence: match.confidence
            }));
          } else if (!customer.phone && !customer.email) {
            pushSnapshotRow(snapshots.import_customers_snapshot, this.recordSnapshotItem("customer", row, customer, "REVIEW", ["Contatto cliente mancante"], { matchConfidence: 0.25 }));
          } else {
            pushSnapshotRow(snapshots.import_customers_snapshot, this.recordSnapshotItem("customer", row, customer, "SAFE", [], { matchConfidence: 0 }));
          }
        }

        if (type === "appointments") {
          const appointment = this.normalizeAppointment(row, mapping);
          if (!appointment.startAt || !appointment.clientName) {
            pushSnapshotRow(snapshots.import_appointments_snapshot, this.recordSnapshotItem("appointment", row, appointment, "INVALID", ["Data o cliente appuntamento mancante"]));
          } else if (!appointment.serviceName || !appointment.staffName) {
            pushSnapshotRow(snapshots.import_appointments_snapshot, this.recordSnapshotItem("appointment", row, appointment, "REVIEW", ["Servizio o operatore da confermare"]));
          } else {
            pushSnapshotRow(snapshots.import_appointments_snapshot, this.recordSnapshotItem("appointment", row, appointment, "SAFE"));
          }
        }

        if (type === "payments") {
          const payment = this.normalizePayment(row, mapping);
          if (payment.amountCents <= 0) {
            pushSnapshotRow(snapshots.import_payments_snapshot, this.recordSnapshotItem("payment", row, payment, "INVALID", ["Importo pagamento non valido"]));
          } else if (!payment.walkInName) {
            pushSnapshotRow(snapshots.import_payments_snapshot, this.recordSnapshotItem("payment", row, payment, "REVIEW", ["Cliente pagamento da confermare"]));
          } else {
            pushSnapshotRow(snapshots.import_payments_snapshot, this.recordSnapshotItem("payment", row, payment, "SAFE"));
          }
        }
      });
    });

    return {
      snapshots,
      fileSummaries,
      importHash: sha256(fileHashes.sort().join("|"))
    };
  }

  analyze(payload = {}, session = null) {
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length) throw new Error("Carica almeno un file CSV o Excel.");
    let snapshots;
    let fileSummaries;
    let importHash;
    try {
      ({ snapshots, fileSummaries, importHash } = this.buildSnapshots(files, session));
    } catch (error) {
      console.warn("[gold_onboarding_analyze_error]", JSON.stringify({
        centerId: this.service.getCenterId(session),
        createdBy: session?.username || session?.role || "",
        message: error instanceof Error ? error.message : "Analisi import non riuscita"
      }));
      throw error;
    }
    const existingImport = this.importRepository.list().find((item) => (
      String(item.centerId || "") === this.service.getCenterId(session) &&
      String(item.importHash || "") === importHash &&
      ["analyzed", "imported"].includes(String(item.status || ""))
    ));
    if (existingImport) {
      return {
        success: true,
        duplicateImport: true,
        importId: existingImport.id,
        ...existingImport
      };
    }
    const importId = makeId("gold_import");
    const summary = this.summarizeSnapshots(snapshots);
    const record = {
      id: importId,
      importId,
      importHash,
      fileName: fileSummaries.map((item) => item.name).join(", "),
      fileHash: fileSummaries.map((item) => item.fileHash).join(","),
      detectedType: Array.from(new Set(fileSummaries.map((item) => item.detectedType))).join(","),
      centerId: this.service.getCenterId(session),
      centerName: this.service.getCenterName(session),
      status: "analyzed",
      createdBy: session?.username || session?.role || "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      fileSummaries,
      snapshots,
      summary,
      createdCounts: { customers: 0, appointments: 0, payments: 0 },
      reviewCounts: summary.reviewByType,
      invalidCounts: summary.invalidByType,
      confirmedAt: "",
      aiResolution: {
        enabled: true,
        mode: "assisted_review",
        rule: "L'AI suggerisce mapping e collegamenti, ma i record dubbi restano REVIEW fino a conferma utente."
      }
    };
    this.importRepository.create(record);
    console.log("[gold_onboarding_analyze]", JSON.stringify({
      centerId: record.centerId,
      importId,
      importHash,
      files: fileSummaries.length,
      summary
    }));
    return { success: true, importId, ...record };
  }

  summarizeSnapshots(snapshots = {}) {
    const blocks = Object.entries(snapshots);
    const byType = (field) => blocks.reduce((acc, [key, block]) => {
      const label = key.includes("customers") ? "customers" : key.includes("appointments") ? "appointments" : "payments";
      acc[label] = Number(block?.[field]?.length || 0);
      return acc;
    }, { customers: 0, appointments: 0, payments: 0 });
    const blockValues = blocks.map(([, block]) => block);
    const safeByType = byType("validRows");
    const reviewByType = byType("reviewRows");
    const invalidByType = byType("invalidRows");
    const safe = blockValues.reduce((sum, block) => sum + block.validRows.length, 0);
    const review = blockValues.reduce((sum, block) => sum + block.reviewRows.length, 0);
    const invalid = blockValues.reduce((sum, block) => sum + block.invalidRows.length, 0);
    const duplicates = blockValues.reduce((sum, block) => sum + block.duplicates.length, 0);
    return {
      safeRecords: safe,
      reviewRecords: review,
      invalidRecords: invalid,
      duplicates,
      customersFound: safeByType.customers + reviewByType.customers + invalidByType.customers,
      customersNew: safeByType.customers,
      appointmentsFound: safeByType.appointments + reviewByType.appointments + invalidByType.appointments,
      paymentsFound: safeByType.payments + reviewByType.payments + invalidByType.payments,
      safeByType,
      reviewByType,
      invalidByType
    };
  }

  confirm(payload = {}, session = null) {
    const importId = String(payload.importId || "");
    const record = this.importRepository.findById(importId);
    if (!record || String(record.centerId || "") !== this.service.getCenterId(session)) {
      throw new Error("Import Gold non trovato per questo centro.");
    }
    if (record.status === "imported") {
      return {
        ...(record.result || {}),
        success: true,
        duplicateConfirm: true,
        status: "imported"
      };
    }
    const decisions = payload.decisions && typeof payload.decisions === "object" ? payload.decisions : {};
    const shouldImportReview = (item) => decisions[item.id] === "approve";
    const snapshots = record.snapshots || {};
    const created = { customers: [], appointments: [], payments: [] };
    const skippedDuplicates = { customers: 0, appointments: 0, payments: 0 };
    const skippedReview = [];
    const hardValidationErrors = [];
    const clientByName = new Map();
    const existingClients = this.service.filterByCenter(this.service.clientsRepository.list(), session);
    const clientIndex = indexExistingClients(existingClients);

    existingClients.forEach((client) => {
      clientByName.set(normalizeText(client.name || `${client.firstName || ""} ${client.lastName || ""}`), client);
    });

    const customerRows = [
      ...(snapshots.import_customers_snapshot?.validRows || []),
      ...(snapshots.import_customers_snapshot?.reviewRows || []).filter(shouldImportReview)
    ];
    (snapshots.import_customers_snapshot?.reviewRows || []).filter((item) => !shouldImportReview(item)).forEach((item) => skippedReview.push(item.id));
    customerRows.forEach((item) => {
      const customer = item.normalized || {};
      const existing = evaluateCustomerMatch(customer, clientIndex).duplicateOf || clientByName.get(normalizeText(customer.name));
      if (existing) {
        skippedDuplicates.customers += 1;
        clientByName.set(normalizeText(customer.name), existing);
        return;
      }
      const saved = this.service.saveClient({
        ...customer,
        idempotencyKey: `gold-onboarding:${importId}:customer:${item.id}`,
        consentSource: "import_gold_onboarding"
      }, session);
      created.customers.push(saved);
      clientByName.set(normalizeText(saved.name), saved);
      if (saved.email) clientIndex.byEmail.set(cleanEmail(saved.email), saved);
      if (saved.phone) clientIndex.byPhone.set(cleanPhone(saved.phone), saved);
      clientIndex.byName.set(customerComparableName(saved), saved);
    });

    const appointmentRows = [
      ...(snapshots.import_appointments_snapshot?.validRows || []),
      ...(snapshots.import_appointments_snapshot?.reviewRows || []).filter(shouldImportReview)
    ];
    (snapshots.import_appointments_snapshot?.reviewRows || []).filter((item) => !shouldImportReview(item)).forEach((item) => skippedReview.push(item.id));
    appointmentRows.forEach((item) => {
      const appointment = item.normalized || {};
      if (!appointment.serviceName || !appointment.staffName) {
        hardValidationErrors.push({
          type: "appointment",
          id: item.id,
          sourceRow: item.sourceRow || null,
          reason: "Appuntamento senza servizio o operatore"
        });
      }
    });
    appointmentRows.forEach((item) => {
      const appointment = item.normalized || {};
      const client = clientByName.get(normalizeText(appointment.clientName || ""));
      const duplicateAppointment = this.service.filterByCenter(this.service.appointmentsRepository.list(), session).find((existing) => (
        normalizeText(existing.clientName || existing.walkInName || "") === normalizeText(appointment.clientName || "") &&
        String(existing.startAt || "").slice(0, 16) === String(appointment.startAt || "").slice(0, 16) &&
        normalizeText(existing.serviceName || "") === normalizeText(appointment.serviceName || "")
      ));
      if (duplicateAppointment) {
        skippedDuplicates.appointments += 1;
        return;
      }
      const saved = this.service.saveAppointment({
        ...appointment,
        clientId: client?.id || "",
        idempotencyKey: `gold-onboarding:${importId}:appointment:${item.id}`
      }, session);
      created.appointments.push(saved);
    });

    const importedAppointments = created.appointments.concat(this.service.filterByCenter(this.service.appointmentsRepository.list(), session));
    const latestVisitByClientId = new Map();
    importedAppointments.forEach((appointment) => {
      const clientId = String(appointment.clientId || "").trim();
      const startAt = String(appointment.startAt || appointment.createdAt || "");
      const status = String(appointment.status || "").toLowerCase();
      const time = new Date(startAt).getTime();
      if (!clientId || !Number.isFinite(time) || ["cancelled", "no_show"].includes(status)) return;
      const current = latestVisitByClientId.get(clientId);
      if (!current || time > current.time) {
        latestVisitByClientId.set(clientId, { time, startAt });
      }
    });
    latestVisitByClientId.forEach((visit, clientId) => {
      this.service.clientsRepository.update(clientId, (current) => ({
        ...current,
        lastVisit: visit.startAt
      }));
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
      if (!payment.walkInName || Number(payment.amountCents || 0) <= 0) {
        hardValidationErrors.push({
          type: "payment",
          id: item.id,
          sourceRow: item.sourceRow || null,
          reason: !payment.walkInName ? "Pagamento senza cliente" : "Pagamento con importo non valido"
        });
      }
    });
    if (hardValidationErrors.length) {
      const first = hardValidationErrors[0];
      throw new Error(`Import bloccato: ${first.reason} (record ${first.id}${first.sourceRow ? `, riga ${first.sourceRow}` : ""}).`);
    }
    paymentRows.forEach((item) => {
      const payment = item.normalized || {};
      const client = clientByName.get(normalizeText(payment.walkInName || ""));
      const dateKey = `${normalizeText(payment.walkInName || "")}:${String(payment.createdAt || "").slice(0, 10)}`;
      const appointment = appointmentByClientAndDay.get(dateKey);
      const duplicatePayment = this.service.filterByCenter(this.service.paymentsRepository.list(), session).find((existing) => (
        Number(existing.amountCents || 0) === Number(payment.amountCents || 0) &&
        String(existing.createdAt || "").slice(0, 10) === String(payment.createdAt || "").slice(0, 10) &&
        normalizeText(existing.walkInName || "") === normalizeText(payment.walkInName || "")
      ));
      if (duplicatePayment) {
        skippedDuplicates.payments += 1;
        return;
      }
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
    const summary = this.summarizeSnapshots(snapshots);
    const result = {
      success: true,
      importId,
      importHash: record.importHash || "",
      status: "imported",
      imported: {
        customers: created.customers.length,
        appointments: created.appointments.length,
        payments: created.payments.length
      },
      createdCounts: {
        customers: created.customers.length,
        appointments: created.appointments.length,
        payments: created.payments.length
      },
      finalSummary: {
        customersFound: summary.customersFound,
        customersNew: created.customers.length,
        duplicatesReview: summary.duplicates,
        appointmentsImported: created.appointments.length,
        paymentsImported: created.payments.length,
        invalidExcluded: summary.invalidRecords,
        skippedDuplicates,
        finalStatus: "imported"
      },
      skippedReview,
      skippedDuplicates,
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
      createdCounts: result.createdCounts,
      result,
      confirmedAt: nowIso(),
      importedAt: nowIso(),
      updatedAt: nowIso()
    }));
    console.log("[gold_onboarding_confirm]", JSON.stringify({
      centerId: this.service.getCenterId(session),
      importId,
      importHash: record.importHash || "",
      createdCounts: result.createdCounts,
      skippedDuplicates,
      invalidExcluded: result.excludedInvalid,
      rebuildValid: rebuild.valid,
      pialLevel: pial.activationLevel
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
        confirmedAt: item.confirmedAt || "",
        importHash: item.importHash || "",
        fileName: item.fileName || "",
        fileHash: item.fileHash || "",
        detectedType: item.detectedType || "",
        createdCounts: item.createdCounts || { customers: 0, appointments: 0, payments: 0 },
        reviewCounts: item.reviewCounts || {},
        invalidCounts: item.invalidCounts || {},
        createdBy: item.createdBy || "",
        summary: item.summary,
        fileSummaries: item.fileSummaries || [],
        result: item.result || null
      }));
  }
}

module.exports = {
  GoldOnboardingEngine
};
