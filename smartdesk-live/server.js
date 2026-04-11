const express = require("express");
const path = require("path");
const nodemailer = require("nodemailer");
const { DesktopMirrorService } = require("./src/DesktopMirrorService");
const { AssistantService } = require("./src/AssistantService");
const { PostgresPersistenceAdapter } = require("./src/PostgresPersistenceAdapter");

const app = express();
let service = null;
let assistantService = null;
const publicDir = path.resolve(__dirname, "public");

function trialMailConfigured() {
  return Boolean(
    process.env.TRIAL_SMTP_HOST &&
    process.env.TRIAL_SMTP_PORT &&
    process.env.TRIAL_MAIL_FROM &&
    process.env.TRIAL_SMTP_USER &&
    process.env.TRIAL_SMTP_PASS
  );
}

async function sendTrialVerificationMail({ email, centerName, ownerName, verificationUrl }) {
  if (!trialMailConfigured()) {
    return { status: "disabled" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.TRIAL_SMTP_HOST,
    port: Number(process.env.TRIAL_SMTP_PORT || 587),
    secure: String(process.env.TRIAL_SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.TRIAL_SMTP_USER,
      pass: process.env.TRIAL_SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.TRIAL_MAIL_FROM,
    to: email,
    subject: "Verifica il tuo accesso Smart Desk",
    html: `
      <div style="font-family:Arial,sans-serif;color:#163747;line-height:1.6">
        <h2 style="margin:0 0 12px">Completa l'attivazione del tuo accesso</h2>
        <p>Ciao ${ownerName || "team"}, abbiamo ricevuto la richiesta di prova per <strong>${centerName}</strong>.</p>
        <p>Per confermare la tua email e attivare la prova gratuita, usa questo link sicuro:</p>
        <p><a href="${verificationUrl}" style="display:inline-block;padding:12px 18px;border-radius:14px;background:#2a8ec4;color:#fff;text-decoration:none;font-weight:700">Conferma la tua email</a></p>
        <p style="margin:12px 0 0">Se il pulsante non si apre correttamente, copia e incolla questo link:</p>
        <p style="word-break:break-all;color:#2a8ec4">${verificationUrl}</p>
        <p style="margin-top:16px">Il link scade automaticamente e può essere usato una sola volta.</p>
      </div>
    `
  });
  return { status: "sent" };
}

function appBaseUrl(req) {
  return String(process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`);
}

async function sendTrialWelcomeMail({ email, centerName, username, trialEndsAt }) {
  if (!trialMailConfigured()) {
    return { status: "disabled" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.TRIAL_SMTP_HOST,
    port: Number(process.env.TRIAL_SMTP_PORT || 587),
    secure: String(process.env.TRIAL_SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.TRIAL_SMTP_USER,
      pass: process.env.TRIAL_SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.TRIAL_MAIL_FROM,
    to: email,
    subject: "Benvenuto in Smart Desk",
    html: `
      <div style="font-family:Arial,sans-serif;color:#163747;line-height:1.6">
        <h2 style="margin:0 0 12px">Benvenuto in Smart Desk</h2>
        <p>La prova del centro <strong>${centerName}</strong> è attiva.</p>
        <p><strong>Username:</strong> ${username}</p>
        <p><strong>Scadenza prova:</strong> ${trialEndsAt ? new Date(trialEndsAt).toLocaleDateString("it-IT") : "non disponibile"}</p>
        <p>Puoi accedere qui: <a href="${process.env.APP_BASE_URL || "https://skinharmony-smartdesk-live.onrender.com"}/login">Apri login</a></p>
      </div>
    `
  });
  return { status: "sent" };
}

async function sendPasswordResetMail({ email, resetUrl }) {
  if (!trialMailConfigured()) {
    return { status: "disabled" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.TRIAL_SMTP_HOST,
    port: Number(process.env.TRIAL_SMTP_PORT || 587),
    secure: String(process.env.TRIAL_SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.TRIAL_SMTP_USER,
      pass: process.env.TRIAL_SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.TRIAL_MAIL_FROM,
    to: email,
    subject: "Reimposta la tua password Smart Desk",
    html: `
      <div style="font-family:Arial,sans-serif;color:#163747;line-height:1.6">
        <h2 style="margin:0 0 12px">Richiesta cambio password</h2>
        <p>Abbiamo ricevuto una richiesta di reimpostazione password per il tuo account Smart Desk.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:14px;background:#2a8ec4;color:#fff;text-decoration:none;font-weight:700">Imposta una nuova password</a></p>
        <p style="margin:12px 0 0">Se il pulsante non si apre correttamente, copia e incolla questo link:</p>
        <p style="word-break:break-all;color:#2a8ec4">${resetUrl}</p>
        <p>Se non hai richiesto tu questa operazione, ignora la mail.</p>
      </div>
    `
  });
  return { status: "sent" };
}

async function sendPasswordChangedMail({ email }) {
  if (!trialMailConfigured()) {
    return { status: "disabled" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.TRIAL_SMTP_HOST,
    port: Number(process.env.TRIAL_SMTP_PORT || 587),
    secure: String(process.env.TRIAL_SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.TRIAL_SMTP_USER,
      pass: process.env.TRIAL_SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.TRIAL_MAIL_FROM,
    to: email,
    subject: "Password Smart Desk aggiornata",
    html: `
      <div style="font-family:Arial,sans-serif;color:#163747;line-height:1.6">
        <h2 style="margin:0 0 12px">Password aggiornata</h2>
        <p>La password del tuo account Smart Desk è stata modificata correttamente.</p>
        <p>Se non hai effettuato tu questa operazione, contatta subito SkinHarmony.</p>
      </div>
    `
  });
  return { status: "sent" };
}

function readToken(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

function requireAuth(req, res, next) {
  const session = service.getSession(readToken(req));
  if (!session) {
    return res.status(401).send("Sessione non valida");
  }
  req.session = session;
  return next();
}

function requireOperationalAccess(req, res, next) {
  if (service.canOperate(req.session)) {
    return next();
  }
  return res.status(402).json({
    success: false,
    code: req.session?.accessState || "blocked",
    message: req.session?.accessState === "expired"
      ? "Trial scaduto. Attiva il piano per continuare."
      : req.session?.accessState === "suspended"
        ? "Account sospeso. Contatta SkinHarmony per riattivarlo."
        : req.session?.accessState === "pending_verification"
          ? "Verifica prima la tua email per attivare la prova."
          : req.session?.accessState === "pending_payment"
            ? "Pagamento in attesa. Completa l'attivazione per continuare."
        : "Accesso operativo non disponibile.",
    session: req.session
  });
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  return next();
});

app.use(express.json({ limit: "2mb" }));
app.use("/assets", express.static(path.join(publicDir, "assets")));
app.use("/exports", express.static(path.join(publicDir, "exports")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "skinharmony-smartdesk-live" });
});

app.post("/api/auth/login", (req, res) => {
  try {
    res.json({ success: true, ...service.login(req.body || {}) });
  } catch (error) {
    res.status(401).send(error instanceof Error ? error.message : "Credenziali non valide");
  }
});

app.get("/api/auth/trial-config", (_req, res) => {
  res.json(service.getTrialPublicConfig());
});

app.post("/api/auth/request-trial", async (req, res) => {
  try {
    const result = service.requestTrial(req.body || {});
    let emailDelivery = { status: "disabled" };
    if (result.verification?.required && result.verification?.token) {
      emailDelivery = await sendTrialVerificationMail({
        email: result.verification.email,
        centerName: req.body?.centerName || "",
        ownerName: req.body?.ownerName || "",
        verificationUrl: `${appBaseUrl(req)}/verify-email?token=${encodeURIComponent(result.verification.token)}`
      });
    }
    res.status(201).json({
      success: result.success,
      message: result.message,
      credentials: result.credentials,
      user: result.user,
      verification: {
        required: Boolean(result.verification?.required),
        email: result.verification?.email || "",
        deliveryStatus: emailDelivery.status
      },
      payment: result.payment
    });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile attivare la prova");
  }
});

app.post("/api/auth/verify-trial-email", (req, res) => {
  try {
    const result = service.verifyTrialEmailToken(req.body || {});
    void sendTrialWelcomeMail({
      email: result.user.contactEmail || "",
      centerName: result.user.centerName || "",
      username: result.user.username || "",
      trialEndsAt: result.user.trialEndsAt || ""
    });
    res.json(result);
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile verificare l'email");
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const result = service.requestPasswordReset(req.body || {});
    if (result.delivery?.email && result.delivery?.token) {
      await sendPasswordResetMail({
        email: result.delivery.email,
        resetUrl: `${appBaseUrl(req)}/reset-password?token=${encodeURIComponent(result.delivery.token)}`
      });
    }
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile avviare il reset password");
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const result = service.resetPasswordWithToken(req.body || {});
    if (result.user.contactEmail) {
      await sendPasswordChangedMail({ email: result.user.contactEmail });
    }
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aggiornare la password");
  }
});

app.get("/api/auth/session", (req, res) => {
  res.json(service.getSession(readToken(req)));
});

app.post("/api/auth/logout", (req, res) => {
  res.json(service.logout(readToken(req)));
});

app.get("/api/auth/users", requireAuth, (req, res) => {
  res.json(service.listAccessUsers(req.session));
});

app.post("/api/auth/users", requireAuth, (req, res) => {
  try {
    res.status(201).json(service.createAccessUser(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile creare l'accesso");
  }
});

app.post("/api/auth/users/:id/status", requireAuth, (req, res) => {
  try {
    res.json(service.updateAccessUserStatus(req.params.id, req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aggiornare lo stato utente");
  }
});

app.post("/api/auth/users/:id/support-session", requireAuth, (req, res) => {
  try {
    res.json({ success: true, ...service.createSupportSessionForUser(req.params.id, req.session) });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aprire la sessione supporto");
  }
});

app.post("/api/auth/subscription/request-change", requireAuth, (req, res) => {
  try {
    res.json(service.requestSubscriptionChange(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile inviare la richiesta abbonamento");
  }
});

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) {
    return next();
  }
  return requireAuth(req, res, () => requireOperationalAccess(req, res, next));
});

app.get("/api/dashboard/stats", (req, res) => {
  res.json(service.getDashboardStats({
    period: req.query.period || "day",
    anchorDate: req.query.anchorDate || new Date().toISOString()
  }, req.session));
});

app.post("/api/assistant/chat", async (req, res) => {
  try {
    res.json(await assistantService.chat(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile usare l'assistente");
  }
});

app.get("/api/reports/operational", (req, res) => {
  res.json(service.getOperationalReport({
    period: req.query.period || "day",
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.session));
});

app.get("/api/reports/export", (req, res) => {
  res.json(service.exportOperationalReport({
    period: req.query.period || "day",
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.query.format || "pdf", req.session));
});

app.get("/api/reports/open-exports", (_req, res) => {
  res.json(service.openExportsFolder());
});

app.get("/api/reports/operator/:id", (req, res) => {
  try {
    res.json(service.getOperatorReport(req.params.id, {
      period: req.query.period || "month",
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || ""
    }, req.session));
  } catch (error) {
    res.status(404).send(error instanceof Error ? error.message : "Report operatore non disponibile");
  }
});

app.get("/api/reports/operator/:id/export", (req, res) => {
  try {
    res.json(service.exportOperatorReport(req.params.id, {
      period: req.query.period || "month",
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || ""
    }, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare il report operatore");
  }
});

app.get("/api/clients", (req, res) => {
  res.json(service.listClients(req.query.search, req.session));
});

app.post("/api/clients", (req, res) => {
  res.status(201).json(service.saveClient(req.body || {}, req.session));
});

app.put("/api/clients/:id", (req, res) => {
  res.json(service.saveClient({ ...(req.body || {}), id: req.params.id }, req.session));
});

app.get("/api/clients/:id", (req, res) => {
  try {
    res.json(service.getClientDetail(req.params.id, req.session));
  } catch (error) {
    res.status(404).send(error instanceof Error ? error.message : "Cliente non trovato");
  }
});

app.get("/api/clients/:id/consultation", (req, res) => {
  try {
    res.json(service.getClientConsultation(req.params.id, req.session));
  } catch (error) {
    res.status(404).send(error instanceof Error ? error.message : "Cliente non trovato");
  }
});

app.get("/api/clients/:id/consent-document", (req, res) => {
  try {
    res.json(service.generateClientConsentDocument(req.params.id, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare il documento");
  }
});

app.get("/api/appointments", (req, res) => {
  res.json(service.listAppointments(req.query.view || "day", req.query.anchorDate || new Date().toISOString(), false, req.session));
});

app.post("/api/appointments", (req, res) => {
  res.status(201).json(service.saveAppointment(req.body || {}, req.session));
});

app.put("/api/appointments/:id", (req, res) => {
  res.json(service.saveAppointment({ ...(req.body || {}), id: req.params.id }, req.session));
});

app.get("/api/catalog/services", (req, res) => {
  res.json(service.listServices(req.session));
});

app.post("/api/catalog/services", (req, res) => {
  res.status(201).json(service.saveService(req.body || {}, req.session));
});

app.put("/api/catalog/services/:id", (req, res) => {
  res.json(service.saveService({ ...(req.body || {}), id: req.params.id }, req.session));
});

app.delete("/api/catalog/services/:id", (req, res) => {
  res.json(service.deleteService(req.params.id, req.session));
});

app.get("/api/catalog/staff", (req, res) => {
  res.json(service.listStaff(req.session));
});

app.post("/api/catalog/staff", (req, res) => {
  res.status(201).json(service.saveStaff(req.body || {}, req.session));
});

app.put("/api/catalog/staff/:id", (req, res) => {
  res.json(service.saveStaff({ ...(req.body || {}), id: req.params.id }, req.session));
});

app.delete("/api/catalog/staff/:id", (req, res) => {
  res.json(service.deleteStaff(req.params.id, req.session));
});

app.get("/api/shifts", (req, res) => {
  res.json(service.listShifts(req.query.view || "month", req.query.anchorDate || new Date().toISOString(), req.query.staffId || "", req.session));
});

app.post("/api/shifts", (req, res) => {
  res.status(201).json(service.saveShift(req.body || {}, req.session));
});

app.put("/api/shifts/:id", (req, res) => {
  res.json(service.saveShift({ ...(req.body || {}), id: req.params.id }, req.session));
});

app.delete("/api/shifts/:id", (req, res) => {
  res.json(service.deleteShift(req.params.id, req.session));
});

app.get("/api/shifts/export", (req, res) => {
  try {
    res.json(service.exportShiftReport(req.query || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare il foglio presenze");
  }
});

app.get("/api/shifts/templates", (req, res) => {
  res.json(service.listShiftTemplates(req.session));
});

app.post("/api/shifts/templates", (req, res) => {
  res.status(201).json(service.saveShiftTemplate(req.body || {}, req.session));
});

app.put("/api/shifts/templates/:id", (req, res) => {
  res.json(service.saveShiftTemplate({ ...(req.body || {}), id: req.params.id }, req.session));
});

app.delete("/api/shifts/templates/:id", (req, res) => {
  res.json(service.deleteShiftTemplate(req.params.id, req.session));
});

app.post("/api/shifts/templates/generate", (req, res) => {
  try {
    res.json(service.generateShiftTemplate(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare i turni dallo schema");
  }
});

app.get("/api/catalog/resources", (req, res) => {
  res.json(service.listResources(req.session));
});

app.post("/api/catalog/resources", (req, res) => {
  res.status(201).json(service.saveResource(req.body || {}, req.session));
});

app.put("/api/catalog/resources/:id", (req, res) => {
  res.json(service.saveResource({ ...(req.body || {}), id: req.params.id }, req.session));
});

app.delete("/api/catalog/resources/:id", (req, res) => {
  res.json(service.deleteResource(req.params.id, req.session));
});

app.get("/api/inventory/items", (req, res) => {
  res.json(service.listInventoryItems(req.session));
});

app.post("/api/inventory/items", (req, res) => {
  res.status(201).json(service.saveInventoryItem(req.body || {}, req.session));
});

app.put("/api/inventory/items/:id", (req, res) => {
  res.json(service.saveInventoryItem({ ...(req.body || {}), id: req.params.id }, req.session));
});

app.delete("/api/inventory/items/:id", (req, res) => {
  res.json(service.deleteInventoryItem(req.params.id, req.session));
});

app.get("/api/inventory/movements", (req, res) => {
  res.json(service.listInventoryMovements(String(req.query.itemId || ""), req.session));
});

app.post("/api/inventory/movements", (req, res) => {
  try {
    res.status(201).json(service.createInventoryMovement(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile registrare il movimento");
  }
});

app.get("/api/inventory/overview", (req, res) => {
  res.json(service.getInventoryOverview(req.session));
});

app.get("/api/profitability/overview", (req, res) => {
  res.json(service.getProfitabilityOverview({
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.session));
});

app.get("/api/ai-gold/marketing", (req, res) => {
  res.json(service.getAiGoldMarketing(req.session));
});

app.get("/api/ai-gold/profitability", (req, res) => {
  res.json(service.getAiGoldProfitability({
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.session));
});

app.post("/api/ai-gold/ask", async (req, res) => {
  try {
    res.json(await assistantService.aiGoldAsk(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "AI Gold non disponibile");
  }
});

app.get("/api/ai-gold/marketing/autopilot", (req, res) => {
  res.json(service.getAiMarketingAutopilot(req.session));
});

app.post("/api/ai-gold/marketing/autopilot/generate", async (req, res) => {
  try {
    const generated = service.generateAiMarketingAutopilotActions(req.session);
    const enhanced = await assistantService.enhanceMarketingAutopilotActions(generated.actions || [], req.session);
    if (enhanced.actions?.length) {
      service.updateAiMarketingActionDrafts(enhanced.actions, req.session);
    }
    res.json({
      ...service.getAiMarketingAutopilot(req.session),
      createdCount: generated.createdCount || 0,
      aiProvider: enhanced.provider
    });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare Marketing Autopilot");
  }
});

app.post("/api/ai-gold/marketing/autopilot/:id/status", (req, res) => {
  try {
    res.json(service.updateAiMarketingActionStatus(req.params.id, req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aggiornare l'azione marketing");
  }
});

app.get("/api/treatments", (req, res) => {
  res.json(service.listTreatments(req.query.clientId, req.session));
});

app.post("/api/treatments", (req, res) => {
  res.status(201).json(service.createTreatment(req.body || {}, req.session));
});

app.get("/api/payments", (req, res) => {
  res.json(service.listPayments(req.query.clientId, req.session));
});

app.post("/api/payments", (req, res) => {
  res.status(201).json(service.createPayment(req.body || {}, req.session));
});

app.get("/api/settings", (req, res) => {
  res.json(service.getSettings(req.session));
});

app.put("/api/settings", (req, res) => {
  res.json(service.saveSettings(req.body || {}, req.session));
});

app.post("/api/settings/reset", (req, res) => {
  res.json(service.resetSettings(req.session));
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT || 10000);

async function bootstrap() {
  const persistenceAdapter = process.env.DATABASE_URL
    ? new PostgresPersistenceAdapter(process.env.DATABASE_URL)
    : null;

  service = new DesktopMirrorService({ persistenceAdapter });
  await service.init();
  assistantService = new AssistantService(service);

  app.listen(port, () => {
    console.log(`SkinHarmony Smart Desk live su http://localhost:${port}`);
    console.log(`[SmartDesk] Persistence: ${process.env.DATABASE_URL ? "Postgres (DATABASE_URL)" : "JSON locale"}`);
  });
}

bootstrap().catch((error) => {
  console.error("[SmartDesk] Avvio fallito:", error);
  process.exit(1);
});
