import express from "express";

export function approvalRouter({ service, authenticate }) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try { req.actor = await authenticate(req); next(); } catch { res.status(401).json({ error: "unauthorized" }); }
  });
  const run = (handler) => async (req, res) => {
    try { const result = await handler(req); res.json(result); } catch (error) { res.status(error.status || 500).json({ error: error.code || "internal_error" }); }
  };
  router.get("/requests", run((req) => service.list(req.actor, req.query)));
  router.post("/requests", run((req) => service.create(req.actor, req.body)));
  router.post("/requests/:id/approve", run((req) => service.approve(req.actor, req.params.id, req.body)));
  router.post("/requests/:id/revoke", run((req) => service.revoke(req.actor, req.params.id)));
  router.post("/confirmations/consume", run((req) => service.consume(req.actor, req.body)));
  router.get("/audit", run((req) => service.auditLog(req.actor)));
  return router;
}
