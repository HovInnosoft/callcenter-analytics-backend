import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { Interaction } from "../models/Interaction.js";
import { maskPII } from "../utils/pii.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";
import { analyzeAudioWithGemini, analyzeTextWithGemini, geminiConfig } from "../utils/gemini.js";

const router = express.Router();

const uploadDir = process.env.UPLOAD_DIR || "uploads";
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage });

router.get("/", requireAuth, async (req, res) => {
  const { from, to, channel, sentiment, clusterId, agentId, q, limit = 50, skip = 0 } = req.query;

  const filter = {};
  if (from || to) {
    filter.startedAt = {};
    if (from) filter.startedAt.$gte = new Date(from);
    if (to) filter.startedAt.$lte = new Date(to);
  }
  if (channel) filter.channel = channel;
  if (agentId) filter["agent.agentId"] = agentId;

  // Search by interactionId or transcript keyword in latest ai version
  if (q) {
    filter.$or = [
      { interactionId: { $regex: String(q), $options: "i" } },
      { "aiVersions.ai.transcriptMasked": { $regex: String(q), $options: "i" } },
      { "aiVersions.ai.topicClusterTitle": { $regex: String(q), $options: "i" } },
    ];
  }

  let docs = await Interaction.find(filter)
    .sort({ startedAt: -1 })
    .skip(Number(skip))
    .limit(Math.min(Number(limit), 200))
    .lean();

  // Post-filter latest AI properties (MVP simplicity)
  if (sentiment || clusterId) {
    docs = docs.filter((it) => {
      const latest = (it.aiVersions || []).slice(-1)[0]?.ai;
      if (!latest) return false;
      if (sentiment && latest.sentimentLabel !== sentiment) return false;
      if (clusterId && latest.topicClusterId !== clusterId) return false;
      return true;
    });
  }

  // RBAC: agent sees only own interactions
  if (req.user.role === "agent") {
    docs = docs.filter((it) => it.agent?.agentId === req.user.email); // simple mapping: agentId==email in seed
  }

  const list = docs.map((it) => {
    const latest = (it.aiVersions || []).slice(-1)[0]?.ai;
    return {
      interactionId: it.interactionId,
      channel: it.channel,
      direction: it.direction,
      startedAt: it.startedAt,
      durationSec: it.durationSec,
      agent: it.agent,
      customer: it.customer,
      latestAi: latest ? {
        sentimentLabel: latest.sentimentLabel,
        sentimentScore: latest.sentimentScore,
        baseNeedType: latest.baseNeedType,
        topicClusterId: latest.topicClusterId,
        topicClusterTitle: latest.topicClusterTitle,
        status: latest.summary?.status,
        summary: latest.summary,
      } : null,
    };
  });

  res.json({ items: list });
});

router.post(
  "/batch-ingest",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("batch_ingest", "Interaction", () => ""),
  upload.array("files", 40),
  async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded. Use field name 'files'." });

    const out = [];
    for (const file of files) {
      const lower = (file.originalname || "").toLowerCase();
      const textLike = file.mimetype.startsWith("text/") || lower.endsWith(".txt");
      const audioLike = file.mimetype.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".ogg"].some((ext) => lower.endsWith(ext));
      if (!textLike && !audioLike) {
        out.push({ filename: file.originalname, ok: false, error: "Unsupported file type" });
        continue;
      }

      try {
        const now = new Date();
        const startedAt = new Date(now.getTime() - 5 * 60_000);
        const transcriptText = textLike ? await fs.readFile(file.path, "utf-8") : "";
        const ai = textLike
          ? await analyzeTextWithGemini(transcriptText, "email")
          : await analyzeAudioWithGemini(file.path, file.mimetype || "audio/mpeg");

        const doc = await Interaction.create({
          interactionId: `ING_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          channel: textLike ? "email" : "voice",
          direction: "inbound",
          startedAt,
          endedAt: now,
          durationSec: Math.max(30, Math.floor((file.size || 0) / 3200)),
          agent: {
            agentId: req.user.email,
            agentName: req.user.name || req.user.email,
            team: req.user.team || "",
            queue: "Imported",
          },
          customer: { customerId: "", tier: "", segment: "" },
          media: { audioPath: textLike ? "" : `/${uploadDir}/${file.filename}` },
          aiVersions: [{
            version: 1,
            createdBy: req.user.sub,
            reason: "file_ingest",
            ai: {
              ...ai,
              transcriptMasked: maskPII(ai.transcriptMasked || transcriptText || ""),
            },
          }],
          crmSnapshots: [{ disposition: "", outcomeTag: "", updatedAt: now }],
          integrity: { status: "new", updatedAt: now },
        });

        out.push({
          filename: file.originalname,
          ok: true,
          interactionId: doc.interactionId,
          channel: doc.channel,
          sentiment: doc.aiVersions?.[0]?.ai?.sentimentLabel || "neutral",
        });
      } catch (e) {
        out.push({ filename: file.originalname, ok: false, error: e.message || "Failed to ingest" });
      }
    }

    const okCount = out.filter((x) => x.ok).length;
    res.status(okCount ? 201 : 400).json({
      ok: okCount > 0,
      model: geminiConfig().model,
      geminiEnabled: geminiConfig().enabled,
      processed: files.length,
      succeeded: okCount,
      failed: files.length - okCount,
      items: out,
    });
  }
);

router.get("/:interactionId", requireAuth, async (req, res) => {
  const doc = await Interaction.findOne({ interactionId: req.params.interactionId }).lean();
  if (!doc) return res.status(404).json({ error: "Not found" });

  // RBAC for agent
  if (req.user.role === "agent" && doc.agent?.agentId !== req.user.email) {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json(doc);
});

// Create interaction manually (MVP)
router.post(
  "/",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("create", "Interaction", (req) => req.body?.interactionId || ""),
  upload.single("audio"),
  async (req, res) => {
    const schema = z.object({
      interactionId: z.string().min(3),
      channel: z.enum(["voice", "email", "webchat"]),
      direction: z.enum(["inbound", "outbound"]).optional().default("inbound"),
      startedAt: z.string(),
      endedAt: z.string(),
      agentId: z.string().optional().default(""),
      agentName: z.string().optional().default(""),
      team: z.string().optional().default(""),
      queue: z.string().optional().default(""),
      customerId: z.string().optional().default(""),
      tier: z.string().optional().default(""),
      segment: z.string().optional().default(""),
      transcript: z.string().optional().default(""),
      sentimentLabel: z.enum(["positive","neutral","negative"]).optional().default("neutral"),
      sentimentScore: z.coerce.number().optional().default(0),
      baseNeedType: z.string().optional().default("Information Request"),
      topicClusterId: z.string().optional().default("cluster_001"),
      topicClusterTitle: z.string().optional().default("General Inquiry"),
      status: z.enum(["resolved","unresolved","follow_up","escalated"]).optional().default("unresolved"),
      customerRequest: z.string().optional().default(""),
      actionsTaken: z.string().optional().default(""),
      nextBestAction: z.string().optional().default(""),
      crmDisposition: z.string().optional().default(""),
      crmOutcomeTag: z.string().optional().default(""),
      deadAirPercent: z.coerce.number().optional().default(0),
      greeting: z.coerce.boolean().optional().default(true),
      idVerification: z.coerce.boolean().optional().default(true),
      solutionGiven: z.coerce.boolean().optional().default(true),
      closing: z.coerce.boolean().optional().default(true),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const d = parsed.data;
    const durationSec = Math.max(0, (new Date(d.endedAt) - new Date(d.startedAt)) / 1000);

    const audioPath = req.file ? `/${uploadDir}/${req.file.filename}` : "";

    const ai = {
      transcriptMasked: maskPII(d.transcript),
      sentimentLabel: d.sentimentLabel,
      sentimentScore: d.sentimentScore,
      baseNeedType: d.baseNeedType,
      topicClusterId: d.topicClusterId,
      topicClusterTitle: d.topicClusterTitle,
      summary: {
        customerRequest: d.customerRequest,
        actionsTaken: d.actionsTaken,
        status: d.status,
        nextBestAction: d.nextBestAction,
      },
      qaMilestones: {
        greeting: d.greeting,
        idVerification: d.idVerification,
        solutionGiven: d.solutionGiven,
        closing: d.closing,
      },
      deadAirPercent: d.deadAirPercent,
      evidenceSpans: [],
    };

    const doc = await Interaction.create({
      interactionId: d.interactionId,
      channel: d.channel,
      direction: d.direction,
      startedAt: new Date(d.startedAt),
      endedAt: new Date(d.endedAt),
      durationSec,
      agent: {
        agentId: d.agentId,
        agentName: d.agentName,
        team: d.team,
        queue: d.queue,
      },
      customer: {
        customerId: d.customerId,
        tier: d.tier,
        segment: d.segment,
      },
      media: { audioPath },
      aiVersions: [{ version: 1, createdBy: req.user.sub, reason: "initial", ai }],
      crmSnapshots: d.crmDisposition || d.crmOutcomeTag ? [{ disposition: d.crmDisposition, outcomeTag: d.crmOutcomeTag }] : [],
    });

    res.status(201).json({ ok: true, interactionId: doc.interactionId });
  }
);

// Append-only QA correction version (immutability)
router.post(
  "/:interactionId/ai-versions",
  requireAuth,
  requireRole(["qa", "supervisor", "admin"]),
  audit("append_version", "Interaction", (req) => req.params.interactionId),
  async (req, res) => {
    const schema = z.object({
      reason: z.string().min(2),
      transcript: z.string().optional(),
      sentimentLabel: z.enum(["positive","neutral","negative"]).optional(),
      sentimentScore: z.coerce.number().optional(),
      baseNeedType: z.string().optional(),
      topicClusterId: z.string().optional(),
      topicClusterTitle: z.string().optional(),
      status: z.enum(["resolved","unresolved","follow_up","escalated"]).optional(),
      customerRequest: z.string().optional(),
      actionsTaken: z.string().optional(),
      nextBestAction: z.string().optional(),
      qaMilestones: z.object({
        greeting: z.coerce.boolean().optional(),
        idVerification: z.coerce.boolean().optional(),
        solutionGiven: z.coerce.boolean().optional(),
        closing: z.coerce.boolean().optional(),
      }).optional(),
      deadAirPercent: z.coerce.number().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const doc = await Interaction.findOne({ interactionId: req.params.interactionId });
    if (!doc) return res.status(404).json({ error: "Not found" });

    const latest = doc.aiVersions.slice(-1)[0]?.ai;
    const nextVersion = (doc.aiVersions.slice(-1)[0]?.version || 0) + 1;

    const ai = {
      ...latest,
      transcriptMasked: parsed.data.transcript ? maskPII(parsed.data.transcript) : latest.transcriptMasked,
      sentimentLabel: parsed.data.sentimentLabel ?? latest.sentimentLabel,
      sentimentScore: parsed.data.sentimentScore ?? latest.sentimentScore,
      baseNeedType: parsed.data.baseNeedType ?? latest.baseNeedType,
      topicClusterId: parsed.data.topicClusterId ?? latest.topicClusterId,
      topicClusterTitle: parsed.data.topicClusterTitle ?? latest.topicClusterTitle,
      summary: {
        ...latest.summary,
        status: parsed.data.status ?? latest.summary?.status,
        customerRequest: parsed.data.customerRequest ?? latest.summary?.customerRequest,
        actionsTaken: parsed.data.actionsTaken ?? latest.summary?.actionsTaken,
        nextBestAction: parsed.data.nextBestAction ?? latest.summary?.nextBestAction,
      },
      qaMilestones: {
        ...latest.qaMilestones,
        ...(parsed.data.qaMilestones || {}),
      },
      deadAirPercent: parsed.data.deadAirPercent ?? latest.deadAirPercent,
    };

    doc.aiVersions.push({ version: nextVersion, createdBy: req.user.sub, reason: parsed.data.reason, ai });
    await doc.save();

    res.json({ ok: true, version: nextVersion });
  }
);

// Append-only CRM snapshot (to support integrity engine)
router.post(
  "/:interactionId/crm-snapshots",
  requireAuth,
  requireRole(["admin", "supervisor", "qa"]),
  audit("append_crm_snapshot", "Interaction", (req) => req.params.interactionId),
  async (req, res) => {
    const schema = z.object({
      disposition: z.string().optional().default(""),
      outcomeTag: z.string().optional().default(""),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const doc = await Interaction.findOne({ interactionId: req.params.interactionId });
    if (!doc) return res.status(404).json({ error: "Not found" });

    doc.crmSnapshots.push({ disposition: parsed.data.disposition, outcomeTag: parsed.data.outcomeTag, updatedAt: new Date() });
    await doc.save();

    res.json({ ok: true });
  }
);

export default router;
