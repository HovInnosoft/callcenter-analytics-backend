import express from "express";
import { z } from "zod";
import { Dispute } from "../models/Dispute.js";
import { Interaction } from "../models/Interaction.js";
import { applyClientScope, requireAuth, requireRole, scopedClientId } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { status, limit = 200 } = req.query;
  let filter = {};
  if (status) filter.status = status;
  if (req.user.role === "agent") filter.agentId = req.user.email;
  filter = applyClientScope(req, filter);

  const items = await Dispute.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit), 500))
    .lean();

  res.json({ items });
});

router.post(
  "/",
  requireAuth,
  requireRole(["agent"]),
  audit("create", "Dispute", () => ""),
  async (req, res) => {
    const schema = z.object({
      interactionId: z.string().min(3),
      reason: z.string().min(5),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const d = parsed.data;
    const interaction = await Interaction.findOne(applyClientScope(req, { interactionId: d.interactionId })).lean();
    if (!interaction) return res.status(400).json({ error: "interactionId not found" });

    if (interaction.agent?.agentId !== req.user.email) {
      return res.status(403).json({ error: "You can only dispute your own interactions" });
    }

    const doc = await Dispute.create({
      clientId: scopedClientId(req),
      interactionId: d.interactionId,
      agentId: req.user.email,
      agentName: req.user.name || "",
      reason: d.reason,
    });

    res.status(201).json({ ok: true, id: doc._id.toString() });
  }
);

router.patch(
  "/:id",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("update", "Dispute", (req) => req.params.id),
  async (req, res) => {
    const schema = z.object({
      status: z.enum(["under_review", "resolved", "rejected"]),
      resolutionNote: z.string().optional().default(""),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const d = parsed.data;
    const patch = {
      status: d.status,
      resolutionNote: d.resolutionNote,
      resolvedBy: req.user.sub,
    };

    if (d.status === "resolved" || d.status === "rejected") {
      patch.resolvedAt = new Date();
    }

    const doc = await Dispute.findOneAndUpdate(applyClientScope(req, { _id: req.params.id }), patch, { new: true });
    if (!doc) return res.status(404).json({ error: "Not found" });

    res.json({ ok: true });
  }
);

export default router;
