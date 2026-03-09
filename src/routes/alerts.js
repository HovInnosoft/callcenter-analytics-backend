import express from "express";
import { z } from "zod";
import { Alert } from "../models/Alert.js";
import { Interaction } from "../models/Interaction.js";
import { applyClientScope, requireAuth, requireRole, scopedClientId } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { status, type, limit = 50 } = req.query;
  let filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  filter = applyClientScope(req, filter);

  const items = await Alert.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(limit), 200)).lean();
  res.json({ items });
});

router.post(
  "/",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("create", "Alert", () => ""),
  async (req, res) => {
    const schema = z.object({
      type: z.enum(["crisis_spike","integrity_mismatch","compliance_fail"]),
      severity: z.enum(["medium","high","critical"]).optional().default("high"),
      title: z.string().min(3),
      description: z.string().optional().default(""),
      interactionId: z.string().optional().default(""),
      clusterId: z.string().optional().default(""),
      evidence: z.any().optional().default({}),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const d = parsed.data;
    if (d.interactionId) {
      const exists = await Interaction.exists(applyClientScope(req, { interactionId: d.interactionId }));
      if (!exists) return res.status(400).json({ error: "interactionId not found" });
    }

    const doc = await Alert.create({ ...d, clientId: scopedClientId(req), createdBy: req.user.sub });
    res.status(201).json({ ok: true, id: doc._id.toString() });
  }
);

router.patch(
  "/:id",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("update", "Alert", (req) => req.params.id),
  async (req, res) => {
    const schema = z.object({ status: z.enum(["new","reviewed","resolved"]) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const doc = await Alert.findOneAndUpdate(
      applyClientScope(req, { _id: req.params.id }),
      { status: parsed.data.status },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  }
);

export default router;
