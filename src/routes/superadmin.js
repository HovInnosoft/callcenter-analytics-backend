import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";
import { Client } from "../models/Client.js";
import { User } from "../models/User.js";

const router = express.Router();

function genClientId() {
  return `CL_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

router.get("/clients", requireAuth, requireRole(["superadmin"]), async (req, res) => {
  const docs = await Client.find({}).sort({ createdAt: -1 }).lean();
  res.json({ items: docs.map((d) => ({ clientId: d.clientId, name: d.name, active: !!d.active, createdAt: d.createdAt })) });
});

router.post(
  "/clients",
  requireAuth,
  requireRole(["superadmin"]),
  audit("create_client", "Client", (req) => req.body?.name || ""),
  async (req, res) => {
    const schema = z.object({
      name: z.string().min(2),
      active: z.coerce.boolean().optional().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let clientId = genClientId();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await Client.exists({ clientId });
      if (!exists) break;
      clientId = genClientId();
    }

    const doc = await Client.create({
      clientId,
      name: parsed.data.name,
      active: parsed.data.active,
      createdByEmail: req.user.email || "",
    });

    res.status(201).json({
      ok: true,
      item: { clientId: doc.clientId, name: doc.name, active: !!doc.active, createdAt: doc.createdAt },
    });
  }
);

router.get("/users", requireAuth, requireRole(["superadmin"]), async (req, res) => {
  const docs = await User.find({}).sort({ createdAt: -1 }).lean();
  res.json({
    items: docs.map((u) => ({
      id: u._id.toString(),
      email: u.email,
      name: u.name,
      role: u.role,
      team: u.team,
      clientId: u.clientId || "default_client",
      createdAt: u.createdAt,
    })),
  });
});

router.post(
  "/users",
  requireAuth,
  requireRole(["superadmin"]),
  audit("create_user", "User", (req) => req.body?.email || ""),
  async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      name: z.string().min(2),
      password: z.string().min(6),
      role: z.enum(["admin", "executive", "supervisor", "qa", "agent"]),
      team: z.string().optional().default("General"),
      clientId: z.string().min(3),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const d = parsed.data;
    const clientExists = await Client.exists({ clientId: d.clientId, active: true });
    if (!clientExists) return res.status(400).json({ error: "Unknown or inactive clientId" });
    const exists = await User.exists({ email: d.email });
    if (exists) return res.status(409).json({ error: "Email already exists" });

    const passwordHash = await bcrypt.hash(d.password, 10);
    const doc = await User.create({
      email: d.email,
      name: d.name,
      role: d.role,
      team: d.team,
      clientId: d.clientId,
      passwordHash,
    });

    res.status(201).json({
      ok: true,
      item: {
        id: doc._id.toString(),
        email: doc.email,
        name: doc.name,
        role: doc.role,
        team: doc.team,
        clientId: doc.clientId,
      },
    });
  }
);

export default router;

