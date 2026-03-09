import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { CallCenter } from "../models/CallCenter.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";

const router = express.Router();

function genCallCenterId() {
  return `CC_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function genApiKey() {
  return `cck_${crypto.randomBytes(24).toString("hex")}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(String(apiKey)).digest("hex");
}

router.get("/", requireAuth, requireRole(["admin", "supervisor", "qa"]), async (req, res) => {
  const items = await CallCenter.find({}).sort({ createdAt: -1 }).lean();
  res.json({
    items: items.map((d) => ({
      id: d.callCenterId,
      name: d.name,
      description: d.description || "",
      sipLogin: d.sipLogin || "",
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
      sipLogin: z.string().min(3),
      sipPassword: z.string().min(6),
      active: z.coerce.boolean().optional().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const d = parsed.data;
    const sipExists = await CallCenter.exists({ sipLogin: d.sipLogin });
    if (sipExists) {
      return res.status(409).json({ error: "sipLogin already exists" });
    }

    const apiKey = genApiKey();
    const apiKeyHash = hashApiKey(apiKey);
    const sipPasswordHash = await bcrypt.hash(d.sipPassword, 10);

    let callCenterId = genCallCenterId();
    for (let i = 0; i < 5; i += 1) {
      // Very low collision risk, still keep deterministic retries.
      // eslint-disable-next-line no-await-in-loop
      const exists = await CallCenter.exists({ $or: [{ callCenterId }, { apiKeyHash }] });
      if (!exists) break;
      callCenterId = genCallCenterId();
    }

    const doc = await CallCenter.create({
      callCenterId,
      name: d.name,
      description: d.description,
      sipLogin: d.sipLogin,
      sipPasswordHash,
      apiKeyHash,
      active: d.active,
      createdByEmail: req.user.email || "",
    });

    res.status(201).json({
      ok: true,
      item: {
        id: doc.callCenterId,
        name: doc.name,
        description: doc.description || "",
        sipLogin: doc.sipLogin,
        active: !!doc.active,
        createdAt: doc.createdAt,
      },
      apiKey,
      uploadEndpoint: "/api/external/audio-ingest",
    });
  }
);

router.delete(
  "/:callCenterId",
  requireAuth,
  requireRole(["admin"]),
  audit("delete_call_center", "CallCenter", (req) => req.params.callCenterId),
  async (req, res) => {
    const doc = await CallCenter.findOneAndDelete({ callCenterId: req.params.callCenterId });
    if (!doc) return res.status(404).json({ error: "Call center not found" });
    return res.json({ ok: true, deletedId: req.params.callCenterId });
  }
);

export default router;
