import express from "express";
import multer from "multer";
import path from "path";
import { Interaction } from "../models/Interaction.js";
import { maskPII } from "../utils/pii.js";
import { analyzeAudioWithGemini, geminiConfig } from "../utils/gemini.js";
import { requireExternalAuth } from "../middleware/externalAuth.js";

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

function externalInteractionId() {
  return `EXT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

router.post("/audio-ingest", requireExternalAuth, upload.array("files", 40), async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: "No files uploaded. Use multipart/form-data with field name 'files'." });
  }

  const callCenter = req.externalCallCenter;
  const requestedCallCenterId = String(req.body.callCenterId || "").trim();
  if (requestedCallCenterId && requestedCallCenterId !== callCenter.id) {
    return res.status(403).json({ error: "callCenterId does not match API key owner" });
  }

  const startedAtInput = req.body.startedAt ? new Date(req.body.startedAt) : null;
  const endedAtInput = req.body.endedAt ? new Date(req.body.endedAt) : null;

  const channel = ["voice", "email", "webchat"].includes(req.body.channel) ? req.body.channel : "voice";
  const direction = ["inbound", "outbound"].includes(req.body.direction) ? req.body.direction : "inbound";

  const out = [];

  for (const file of files) {
    const lower = (file.originalname || "").toLowerCase();
    const audioLike = file.mimetype.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".ogg"].some((ext) => lower.endsWith(ext));
    if (!audioLike) {
      out.push({ filename: file.originalname, ok: false, error: "Unsupported file type (audio only)" });
      continue;
    }

    try {
      const now = new Date();
      const startedAt = startedAtInput && !Number.isNaN(startedAtInput.getTime()) ? startedAtInput : new Date(now.getTime() - 5 * 60_000);
      const endedAt = endedAtInput && !Number.isNaN(endedAtInput.getTime()) ? endedAtInput : now;
      const durationSec = Math.max(30, Math.floor((file.size || 0) / 3200));
      const ai = await analyzeAudioWithGemini(file.path, file.mimetype || "audio/mpeg");

      const doc = await Interaction.create({
        interactionId: externalInteractionId(),
        channel,
        direction,
        startedAt,
        endedAt,
        durationSec,
        agent: {
          agentId: req.body.agentId || `${callCenter.id}_agent`,
          agentName: req.body.agentName || "External Agent",
          supervisor: "",
          team: req.body.team || callCenter.name,
          queue: req.body.queue || "External Ingest",
        },
        customer: {
          customerId: req.body.customerId || "",
          tier: req.body.tier || "",
          segment: req.body.segment || "",
        },
        media: {
          audioPath: `/${uploadDir}/${file.filename}`,
          recordingUrl: req.body.recordingUrl || "",
        },
        aiVersions: [
          {
            version: 1,
            reason: "external_audio_ingest",
            ai: {
              ...ai,
              transcriptMasked: maskPII(ai.transcriptMasked || ""),
            },
          },
        ],
        crmSnapshots: [{ disposition: "", outcomeTag: callCenter.id, updatedAt: endedAt }],
        integrity: { status: "new", updatedAt: endedAt },
      });

      out.push({
        filename: file.originalname,
        ok: true,
        interactionId: doc.interactionId,
        channel: doc.channel,
        sentiment: doc.aiVersions?.[0]?.ai?.sentimentLabel || "neutral",
      });
    } catch (e) {
      out.push({ filename: file.originalname, ok: false, error: e.message || "Failed to ingest audio" });
    }
  }

  const okCount = out.filter((x) => x.ok).length;
  return res.status(okCount ? 201 : 400).json({
    ok: okCount > 0,
    model: geminiConfig().model,
    geminiEnabled: geminiConfig().enabled,
    processed: files.length,
    succeeded: okCount,
    failed: files.length - okCount,
    items: out,
  });
});

router.get("/health", requireExternalAuth, (req, res) => {
  res.json({ ok: true, externalApi: "audio-ingest", callCenterId: req.externalCallCenter?.id || "" });
});

export default router;
