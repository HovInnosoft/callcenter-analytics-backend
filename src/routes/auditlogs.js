import express from "express";
import { applyClientScope, requireAuth, requireRole } from "../middleware/auth.js";
import { AuditLog } from "../models/AuditLog.js";

const router = express.Router();

router.get("/", requireAuth, requireRole(["admin","supervisor","qa"]), async (req, res) => {
  const { limit = 100 } = req.query;
  const items = await AuditLog.find(applyClientScope(req, {})).sort({ createdAt: -1 }).limit(Math.min(Number(limit), 500)).lean();
  res.json({ items });
});

export default router;
