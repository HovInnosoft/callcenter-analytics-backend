import express from "express";
import { z } from "zod";
import { CoachingItem } from "../models/CoachingItem.js";
import { Interaction } from "../models/Interaction.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { status, agentId, limit = 200 } = req.query;
  const filter = {};

  if (status) filter.status = status;
  if (req.user.role === "agent") {
    filter.assignedToAgentId = req.user.email;
  } else if (agentId) {
    filter.assignedToAgentId = String(agentId);
  }

  const items = await CoachingItem.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit), 500))
    .lean();

  res.json({ items });
});

router.post(
  "/",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("create", "CoachingItem", () => ""),
  async (req, res) => {
    const schema = z.object({
      interactionId: z.string().min(3),
      assignedToAgentId: z.string().email(),
      assignedToAgentName: z.string().optional().default(""),
      dueDate: z.string(),
      note: z.string().optional().default(""),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const d = parsed.data;
    const exists = await Interaction.exists({ interactionId: d.interactionId });
    if (!exists) return res.status(400).json({ error: "interactionId not found" });

    const doc = await CoachingItem.create({
      interactionId: d.interactionId,
      assignedToAgentId: d.assignedToAgentId,
      assignedToAgentName: d.assignedToAgentName,
      dueDate: new Date(d.dueDate),
      note: d.note,
      createdBy: req.user.sub,
    });

    res.status(201).json({ ok: true, id: doc._id.toString() });
  }
);

router.patch(
  "/:id/acknowledge",
  requireAuth,
  requireRole(["agent"]),
  audit("acknowledge", "CoachingItem", (req) => req.params.id),
  async (req, res) => {
    const doc = await CoachingItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (doc.assignedToAgentId !== req.user.email) return res.status(403).json({ error: "Forbidden" });

    doc.status = "acknowledged";
    doc.acknowledgedAt = new Date();
    await doc.save();
    res.json({ ok: true });
  }
);

router.patch(
  "/:id/complete",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("complete", "CoachingItem", (req) => req.params.id),
  async (req, res) => {
    const doc = await CoachingItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    doc.status = "completed";
    doc.completedAt = new Date();
    await doc.save();
    res.json({ ok: true });
  }
);

router.patch(
  "/:id/dispute",
  requireAuth,
  requireRole(["agent"]),
  audit("dispute", "CoachingItem", (req) => req.params.id),
  async (req, res) => {
    const schema = z.object({ reason: z.string().min(3) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const doc = await CoachingItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (doc.assignedToAgentId !== req.user.email) return res.status(403).json({ error: "Forbidden" });

    doc.status = "disputed";
    doc.disputeReason = parsed.data.reason;
    doc.disputedAt = new Date();
    await doc.save();
    res.json({ ok: true });
  }
);

export default router;
