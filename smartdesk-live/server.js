const express = require("express");
const path = require("path");
const { DesktopMirrorService } = require("./src/DesktopMirrorService");

const app = express();
const service = new DesktopMirrorService();
const publicDir = path.resolve(__dirname, "public");

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
    res.json(service.login(req.body || {}));
  } catch (error) {
    res.status(401).send(error instanceof Error ? error.message : "Credenziali non valide");
  }
});

app.get("/api/auth/session", (req, res) => {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  res.json(service.getSession(token));
});

app.post("/api/auth/logout", (req, res) => {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  res.json(service.logout(token));
});

app.get("/api/dashboard/stats", (_req, res) => {
  res.json(service.getDashboardStats());
});

app.get("/api/reports/operational", (req, res) => {
  res.json(service.getOperationalReport(req.query.period || "day"));
});

app.get("/api/reports/export", (req, res) => {
  res.json(service.exportOperationalReport(req.query.period || "day", req.query.format || "pdf"));
});

app.get("/api/reports/open-exports", (_req, res) => {
  res.json(service.openExportsFolder());
});

app.get("/api/clients", (req, res) => {
  res.json(service.listClients(req.query.search));
});

app.post("/api/clients", (req, res) => {
  res.status(201).json(service.saveClient(req.body || {}));
});

app.put("/api/clients/:id", (req, res) => {
  res.json(service.saveClient({ ...(req.body || {}), id: req.params.id }));
});

app.get("/api/clients/:id", (req, res) => {
  try {
    res.json(service.getClientDetail(req.params.id));
  } catch (error) {
    res.status(404).send(error instanceof Error ? error.message : "Cliente non trovato");
  }
});

app.get("/api/clients/:id/consultation", (req, res) => {
  try {
    res.json(service.getClientConsultation(req.params.id));
  } catch (error) {
    res.status(404).send(error instanceof Error ? error.message : "Cliente non trovato");
  }
});

app.get("/api/appointments", (req, res) => {
  res.json(service.listAppointments(req.query.view || "day", req.query.anchorDate || new Date().toISOString()));
});

app.post("/api/appointments", (req, res) => {
  res.status(201).json(service.saveAppointment(req.body || {}));
});

app.put("/api/appointments/:id", (req, res) => {
  res.json(service.saveAppointment({ ...(req.body || {}), id: req.params.id }));
});

app.get("/api/catalog/services", (_req, res) => {
  res.json(service.listServices());
});

app.post("/api/catalog/services", (req, res) => {
  res.status(201).json(service.saveService(req.body || {}));
});

app.put("/api/catalog/services/:id", (req, res) => {
  res.json(service.saveService({ ...(req.body || {}), id: req.params.id }));
});

app.delete("/api/catalog/services/:id", (req, res) => {
  res.json(service.deleteService(req.params.id));
});

app.get("/api/catalog/staff", (_req, res) => {
  res.json(service.listStaff());
});

app.post("/api/catalog/staff", (req, res) => {
  res.status(201).json(service.saveStaff(req.body || {}));
});

app.put("/api/catalog/staff/:id", (req, res) => {
  res.json(service.saveStaff({ ...(req.body || {}), id: req.params.id }));
});

app.delete("/api/catalog/staff/:id", (req, res) => {
  res.json(service.deleteStaff(req.params.id));
});

app.get("/api/catalog/resources", (_req, res) => {
  res.json(service.listResources());
});

app.post("/api/catalog/resources", (req, res) => {
  res.status(201).json(service.saveResource(req.body || {}));
});

app.put("/api/catalog/resources/:id", (req, res) => {
  res.json(service.saveResource({ ...(req.body || {}), id: req.params.id }));
});

app.delete("/api/catalog/resources/:id", (req, res) => {
  res.json(service.deleteResource(req.params.id));
});

app.get("/api/treatments", (req, res) => {
  res.json(service.listTreatments(req.query.clientId));
});

app.post("/api/treatments", (req, res) => {
  res.status(201).json(service.createTreatment(req.body || {}));
});

app.get("/api/payments", (req, res) => {
  res.json(service.listPayments(req.query.clientId));
});

app.post("/api/payments", (req, res) => {
  res.status(201).json(service.createPayment(req.body || {}));
});

app.get("/api/settings", (_req, res) => {
  res.json(service.getSettings());
});

app.put("/api/settings", (req, res) => {
  res.json(service.saveSettings(req.body || {}));
});

app.post("/api/settings/reset", (_req, res) => {
  res.json(service.resetSettings());
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT || 10000);
app.listen(port, () => {
  console.log(`SkinHarmony Smart Desk live su http://localhost:${port}`);
});
