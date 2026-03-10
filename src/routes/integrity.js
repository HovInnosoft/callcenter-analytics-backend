import express from "express";
import { z } from "zod";
import { applyClientScope, requireAuth, requireRole } from "../middleware/auth.js";
import { Interaction } from "../models/Interaction.js";
import { audit } from "../middleware/audit.js";

const router = express.Router();

function latestAi(doc) {
  return (doc.aiVersions || []).slice(-1)[0]?.ai || null;
}
function latestCrm(doc) {
  return (doc.crmSnapshots || []).slice(-1)[0] || null;
}

function mismatchScore(ai, crm) {
  let score = 0;

  // status mismatch heuristic
  const aiStatus = ai?.summary?.status || "unresolved";
  const crmDisp = (crm?.disposition || "").toLowerCase();

  const crmResolved = crmDisp.includes("resolved") || crmDisp.includes("done") || crmDisp.includes("closed");
  const aiResolved = aiStatus === "resolved";

  if (crmResolved && !aiResolved) score += 60;
  if (!crmResolved && aiResolved) score += 30;

  // sentiment mismatch heuristic
  const crmPositive = crmDisp.includes("positive") || crmDisp.includes("satisfied");
  if (crmPositive && ai?.sentimentLabel === "negative") score += 30;

  // topic mismatch not implemented (needs CRM reason taxonomy)
  return Math.min(100, score);
}

router.get("/", requireAuth, requireRole(["admin","supervisor","qa"]), async (req, res) => {
  const { from, to, minScore = 40, limit = 100, includePending = "false", integrationOnly = "false" } = req.query;
  const includePendingItems = String(includePending).toLowerCase() === "true";
  const onlyIntegrationItems = String(integrationOnly).toLowerCase() === "true";

  let filter = {};
  if (from || to) {
    filter.startedAt = {};
    if (from) filter.startedAt.$gte = new Date(from);
    if (to) filter.startedAt.$lte = new Date(to);
  }
  if (onlyIntegrationItems) {
    filter.interactionId = { $regex: /^(ING|UPL|EXT)_/ };
  }
  filter = applyClientScope(req, filter);

  const docs = await Interaction.find(filter).sort({ startedAt: -1 }).limit(Math.min(Number(limit), 500)).lean();
  const rows = [];

  for (const d of docs) {
    const ai = latestAi(d);
    const crm = latestCrm(d);
    const hasAudioSource = Boolean(d.media?.audioPath || d.media?.recordingUrl);

    if (!ai) {
      if (!includePendingItems || !hasAudioSource) continue;
      rows.push({
        interactionId: d.interactionId,
        startedAt: d.startedAt,
        agentId: d.agent?.agentId || "",
        agentName: d.agent?.agentName || "",
        aiStatus: "pending_analysis",
        crmDisposition: crm?.disposition || "",
        aiSentiment: "",
        sentimentMismatch: false,
        score: 0,
        status: d.integrity?.status || "new",
        assignedQa: d.integrity?.assignedQa || "",
        resolvedReason: d.integrity?.resolvedReason || "",
        canAnalyze: hasAudioSource,
        hasAi: false,
      });
      continue;
    }

    if (!crm) {
      if (!includePendingItems) continue;
      rows.push({
        interactionId: d.interactionId,
        startedAt: d.startedAt,
        agentId: d.agent?.agentId || "",
        agentName: d.agent?.agentName || "",
        aiStatus: ai.summary?.status || "",
        crmDisposition: "",
        aiSentiment: ai.sentimentLabel || "",
        sentimentMismatch: false,
        score: 0,
        status: d.integrity?.status || "new",
        assignedQa: d.integrity?.assignedQa || "",
        resolvedReason: d.integrity?.resolvedReason || "",
        canAnalyze: hasAudioSource,
        hasAi: true,
      });
      continue;
    }

    const score = mismatchScore(ai, crm);
    if (!includePendingItems && score < Number(minScore)) continue;

    rows.push({
      interactionId: d.interactionId,
      startedAt: d.startedAt,
      agentId: d.agent?.agentId || "",
      agentName: d.agent?.agentName || "",
      aiStatus: ai.summary?.status || "",
      crmDisposition: crm.disposition || "",
      aiSentiment: ai.sentimentLabel || "",
      sentimentMismatch: crm.disposition?.toLowerCase?.().includes("positive") && ai?.sentimentLabel === "negative",
      score,
      status: d.integrity?.status || "new",
      assignedQa: d.integrity?.assignedQa || "",
      resolvedReason: d.integrity?.resolvedReason || "",
      canAnalyze: hasAudioSource,
      hasAi: true,
    });
  }

  rows.sort((a,b) => {
    if (a.hasAi !== b.hasAi) return a.hasAi ? 1 : -1;
    return b.score - a.score;
  });
  res.json({ items: rows });
});

router.patch(
  "/:interactionId/assign",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("assign_qa", "Interaction", (req) => req.params.interactionId),
  async (req, res) => {
    const schema = z.object({ assignedQa: z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const doc = await Interaction.findOneAndUpdate(
      applyClientScope(req, { interactionId: req.params.interactionId }),
      {
        $set: {
          "integrity.assignedQa": parsed.data.assignedQa,
          "integrity.status": "under_review",
          "integrity.updatedAt": new Date(),
        },
      },
      { new: true }
    );

    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  }
);

router.patch(
  "/:interactionId/resolve",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("resolve_integrity", "Interaction", (req) => req.params.interactionId),
  async (req, res) => {
    const schema = z.object({ reason: z.string().min(3) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const now = new Date();
    const doc = await Interaction.findOneAndUpdate(
      applyClientScope(req, { interactionId: req.params.interactionId }),
      {
        $set: {
          "integrity.status": "resolved",
          "integrity.resolvedReason": parsed.data.reason,
          "integrity.resolvedAt": now,
          "integrity.updatedAt": now,
        },
      },
      { new: true }
    );

    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  }
);

export default router;
