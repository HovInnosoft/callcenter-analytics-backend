import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { CallCenter } from "../models/CallCenter.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";

const router = express.Router();

function genCallCenterId() {
  return `CC_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

router.get("/", requireAuth, requireRole(["admin", "supervisor", "qa"]), async (req, res) => {
  const items = await CallCenter.find({}).sort({ createdAt: -1 }).lean();
  res.json({
    items: items.map((d) => ({
      id: d.callCenterId,
      name: d.name,
      description: d.description || "",
      active: !!d.active,
      createdAt: d.createdAt,
    })),
  });
});

router.post(
  "/",
  requireAuth,
  requireRole(["admin"]),
  audit("create_call_center", "CallCenter", (req) => req.body?.name || ""),
  async (req, res) => {
    const schema = z.object({
      name: z.string().min(2),
      description: z.string().optional().default(""),
      active: z.coerce.boolean().optional().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const d = parsed.data;
    let callCenterId = genCallCenterId();
    for (let i = 0; i < 5; i += 1) {
      // Very low collision risk, still keep deterministic retries.
      // eslint-disable-next-line no-await-in-loop
      const exists = await CallCenter.exists({ callCenterId });
      if (!exists) break;
      callCenterId = genCallCenterId();
    }

    const doc = await CallCenter.create({
      callCenterId,
      name: d.name,
      description: d.description,
      active: d.active,
      createdByEmail: req.user.email || "",
    });

    res.status(201).json({
      ok: true,
      item: {
        id: doc.callCenterId,
        name: doc.name,
        description: doc.description || "",
        active: !!doc.active,
        createdAt: doc.createdAt,
      },
      uploadEndpoint: "/api/external/audio-ingest",
    });
  }
);

export default router;

