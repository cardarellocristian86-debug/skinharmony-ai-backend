const express = require("express");
const { buildProtocolDraft } = require("./engine_v1");
const { classifyImageWithAI, hasVisionSupport } = require("./vision_adapter");
const { selectLibraryProtocol, pickRecommendedPackage, library } = require("./library_selector");
const { AssistantService } = require("./AssistantService");

const app = express();
const assistantService = new AssistantService();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
});

app.use(express.json({ limit: "12mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "protocol-engine-v1", vision: hasVisionSupport() });
});

app.get("/meta/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    return res.status(503).json({
      ok: false,
      error: "META_WEBHOOK_VERIFY_TOKEN non configurato"
    });
  }

  if (mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({
    ok: false,
    error: "Verifica webhook non autorizzata"
  });
});

app.post("/api/protocols/generate", (req, res) => {
  const result = buildProtocolDraft(req.body || {});
  if (!result.ok) {
    return res.status(422).json(result);
  }

  return res.json(result);
});

app.post("/api/protocols/analyze", async (req, res) => {
  try {
    const payload = req.body || {};
    const declaredIssue = payload.issue;
    const declaredArea = payload.area;
    const technologies = Array.isArray(payload.technologies) ? payload.technologies : [];

    if (!payload.imageDataUrl) {
      return res.status(422).json({
        ok: false,
        errors: ["imageDataUrl mancante."]
      });
    }

    const vision = await classifyImageWithAI({
      imageDataUrl: payload.imageDataUrl,
      declaredIssue,
      declaredArea
    });

    const effectiveIssue = vision.probable_issue && vision.probable_issue !== "non_determinato"
      ? vision.probable_issue
      : declaredIssue;
    const effectiveArea = vision.probable_area && vision.probable_area !== "non_determinata"
      ? vision.probable_area
      : declaredArea;

    const libraryEntry = selectLibraryProtocol({
      area: effectiveArea,
      issue: effectiveIssue,
      technologies,
      ageRange: payload.ageRange
    });

    if (!libraryEntry) {
      return res.status(422).json({
        ok: false,
        vision,
        errors: [
          "Nessun protocollo compatibile trovato nella libreria beta per questo caso e per queste tecnologie."
        ]
      });
    }

    const applicableTechnologies = libraryEntry.target.suitable_tech.filter((tech) => technologies.includes(tech));
    const recommendedPackage = pickRecommendedPackage(libraryEntry, {
      ageRange: payload.ageRange,
      technologies
    });

    return res.json({
      ok: true,
      version: "beta-v1.3",
      vision,
      protocol: {
        protocol_id: libraryEntry.protocol_id,
        title: libraryEntry.title,
        summary: libraryEntry.classification_summary_template,
        explanation: libraryEntry.explanation_template,
        area: effectiveArea,
        issue: effectiveIssue,
        primaryTechnology: applicableTechnologies[0] || null,
        applicableTechnologies,
        singleSessionDurationMinutes: libraryEntry.session_structure.single_session_duration_minutes,
        sessionSteps: libraryEntry.session_structure.core_steps,
        recommendedPackage,
        packageAlternatives: libraryEntry.packages,
        notes: libraryEntry.notes || [],
        libraryStatus: library.metadata.status
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

app.post("/api/assistant/chat", async (req, res) => {
  try {
    const result = await assistantService.chat(req.body || {}, null);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Assistant error"
    });
  }
});

const port = Number(process.env.PROTOCOL_ENGINE_PORT || 3030);
app.listen(port, () => {
  console.log(`Protocol engine v1 attivo su http://localhost:${port}`);
});
