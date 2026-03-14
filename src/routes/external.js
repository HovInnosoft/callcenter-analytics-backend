import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
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

function isAudioFile(file) {
  const lower = (file.originalname || "").toLowerCase();
  return file.mimetype.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".ogg"].some((ext) => lower.endsWith(ext));
}

function audioExtFromSource(sourceUrl = "", contentType = "") {
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (ct.includes("wav")) return ".wav";
  if (ct.includes("ogg")) return ".ogg";
  if (ct.includes("mp4") || ct.includes("m4a")) return ".m4a";
  if (ct.includes("mpeg") || ct.includes("mp3")) return ".mp3";

  const lower = String(sourceUrl || "").toLowerCase();
  if (lower.endsWith(".wav")) return ".wav";
  if (lower.endsWith(".ogg")) return ".ogg";
  if (lower.endsWith(".m4a")) return ".m4a";
  return ".mp3";
}

async function downloadAudioToUploads(fileUrl) {
  let parsed;
  try {
    parsed = new URL(fileUrl);
  } catch {
    throw new Error("Invalid fileUrl");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https fileUrl values are allowed");
  }

  const res = await fetch(parsed.toString());
  if (!res.ok) {
    throw new Error(`Failed to download fileUrl (${res.status})`);
  }

  const arr = await res.arrayBuffer();
  const buf = Buffer.from(arr);
  const ext = audioExtFromSource(parsed.toString(), res.headers.get("content-type") || "");
  const base = path.basename(parsed.pathname || `recording${ext}`, path.extname(parsed.pathname || ""));
  const safe = String(base || "recording").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${Date.now()}_${safe}${ext}`;
  const filePath = path.join(uploadDir, filename);

  await fs.writeFile(filePath, buf);

  return {
    originalname: `${safe}${ext}`,
    filename,
    path: filePath,
    size: buf.length,
    mimetype: res.headers.get("content-type") || "audio/mpeg",
  };
}

function mapDirection(input) {
  const normalized = String(input || "").trim().toLowerCase();
  if (String(input) === "1") return "outbound";
  if (String(input) === "0") return "inbound";
  if (normalized === "incoming call") return "inbound";
  if (normalized === "outgoing call") return "outbound";
  return ["inbound", "outbound"].includes(normalized) ? normalized : "inbound";
}

function decodeUrlValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function validateExternalUploadBody(body = {}) {
  const requiredFields = ["callerId", "gateway", "caller", "callee", "direction", "disposition", "operator", "fileUrl"];
  const missing = requiredFields.filter((field) => !String(body[field] ?? "").trim());
  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }

  return {
    callerId: String(body.callerId).trim(),
    gateway: String(body.gateway).trim(),
    caller: String(body.caller).trim(),
    callee: String(body.callee).trim(),
    direction: String(body.direction).trim(),
    disposition: String(body.disposition).trim(),
    operator: String(body.operator).trim(),
    fileUrl: decodeUrlValue(body.fileUrl),
  };
}

function buildExternalInteractionPayload({ callCenter, body, file, recordingUrl = "", ai = null }) {
  const now = new Date();
  const endedAt = body.endedAt ? new Date(body.endedAt) : now;
  const startedAt = body.startedAt
    ? new Date(body.startedAt)
    : new Date(endedAt.getTime() - 5 * 60_000);

  return {
    clientId: callCenter.clientId || "default_client",
    interactionId: externalInteractionId(),
    channel: "voice",
    direction: mapDirection(body.direction),
    startedAt: Number.isNaN(startedAt.getTime()) ? new Date(now.getTime() - 5 * 60_000) : startedAt,
    endedAt: Number.isNaN(endedAt.getTime()) ? now : endedAt,
    durationSec: Math.max(30, Math.floor((file.size || 0) / 3200)),
    agent: {
      agentId: body.operator || `${callCenter.id}_agent`,
      agentName: body.operator || "External Agent",
      supervisor: "",
      team: callCenter.name,
      queue: body.callee || "External Ingest",
    },
    customer: {
      customerId: body.callerId || body.caller || "",
      tier: "",
      segment: body.gateway || "",
    },
    media: {
      audioPath: `/${uploadDir}/${file.filename}`,
      recordingUrl,
    },
    aiVersions: ai
      ? [
          {
            version: 1,
            reason: "external_audio_upload",
            ai: {
              ...ai,
              transcriptMasked: maskPII(ai.transcriptMasked || ""),
            },
          },
        ]
      : [],
    crmSnapshots: [{ disposition: body.disposition || "", outcomeTag: callCenter.id, updatedAt: Number.isNaN(endedAt.getTime()) ? now : endedAt }],
    integrity: { status: "new", updatedAt: Number.isNaN(endedAt.getTime()) ? now : endedAt },
  };
}

function normalizeUrlInput(body) {
  const single = String(body.audioUrl || "").trim();
  const list = Array.isArray(body.audioUrls) ? body.audioUrls : [];
  const out = [
    ...list.map((u) => String(u || "").trim()).filter(Boolean),
    ...(single ? [single] : []),
  ];
  return out.slice(0, 40);
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
        clientId: callCenter.clientId || "default_client",
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

router.post("/audio-url-ingest", requireExternalAuth, async (req, res) => {
  const callCenter = req.externalCallCenter;
  const requestedCallCenterId = String(req.body.callCenterId || "").trim();
  if (requestedCallCenterId && requestedCallCenterId !== callCenter.id) {
    return res.status(403).json({ error: "callCenterId does not match API key owner" });
  }

  const urls = normalizeUrlInput(req.body || {});
  if (!urls.length) {
    return res.status(400).json({
      error: "No audio URLs. Use JSON body with 'audioUrl' or 'audioUrls'.",
    });
  }

  const startedAtInput = req.body.startedAt ? new Date(req.body.startedAt) : null;
  const endedAtInput = req.body.endedAt ? new Date(req.body.endedAt) : null;
  const channel = ["voice", "email", "webchat"].includes(req.body.channel) ? req.body.channel : "voice";
  const direction = ["inbound", "outbound"].includes(req.body.direction) ? req.body.direction : "inbound";

  const out = [];
  for (const url of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      out.push({ url, ok: false, error: "Invalid URL" });
      continue;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      out.push({ url, ok: false, error: "Only http/https URLs are allowed" });
      continue;
    }

    try {
      const now = new Date();
      const startedAt = startedAtInput && !Number.isNaN(startedAtInput.getTime()) ? startedAtInput : new Date(now.getTime() - 5 * 60_000);
      const endedAt = endedAtInput && !Number.isNaN(endedAtInput.getTime()) ? endedAtInput : now;

      const doc = await Interaction.create({
        clientId: callCenter.clientId || "default_client",
        interactionId: externalInteractionId(),
        channel,
        direction,
        startedAt,
        endedAt,
        durationSec: 0,
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
          audioPath: "",
          recordingUrl: url,
        },
        aiVersions: [],
        crmSnapshots: [{ disposition: "", outcomeTag: callCenter.id, updatedAt: endedAt }],
        integrity: { status: "new", updatedAt: endedAt },
      });

      out.push({
        url,
        ok: true,
        interactionId: doc.interactionId,
        state: "uploaded",
      });
    } catch (e) {
      out.push({ url, ok: false, error: e.message || "Failed to queue URL" });
    }
  }

  const okCount = out.filter((x) => x.ok).length;
  return res.status(okCount ? 201 : 400).json({
    ok: okCount > 0,
    queued: okCount,
    failed: out.length - okCount,
    items: out,
  });
});

router.post("/audio-upload", requireExternalAuth, upload.array("files", 40), async (req, res) => {
  const callCenter = req.externalCallCenter;
  const requestedCallCenterId = String(req.body.callCenterId || "").trim();
  if (requestedCallCenterId && requestedCallCenterId !== callCenter.id) {
    return res.status(403).json({ error: "callCenterId does not match API key owner" });
  }

  let validatedBody;
  try {
    validatedBody = validateExternalUploadBody(req.body || {});
  } catch (e) {
    return res.status(400).json({ error: e.message || "Invalid request body" });
  }

  let files = req.files || [];
  if (!files.length && validatedBody.fileUrl) {
    try {
      files = [await downloadAudioToUploads(validatedBody.fileUrl)];
    } catch (e) {
      return res.status(400).json({ error: e.message || "Failed to download fileUrl" });
    }
  }
  if (!files.length) {
    return res.status(400).json({ error: "No files uploaded. Provide a valid fileUrl in the request body." });
  }

  const out = [];
  for (const file of files) {
    if (!isAudioFile(file)) {
      out.push({ filename: file.originalname, ok: false, error: "Unsupported file type (audio only)" });
      continue;
    }

    try {
      const ai = await analyzeAudioWithGemini(file.path, file.mimetype || "audio/mpeg");
      const doc = await Interaction.create(
        buildExternalInteractionPayload({
          callCenter,
          body: { ...(req.body || {}), ...validatedBody },
          file,
          recordingUrl: validatedBody.fileUrl,
          ai,
        })
      );

      out.push({
        filename: file.originalname,
        ok: true,
        interactionId: doc.interactionId,
        state: "analyzed",
        source: "fileUrl",
        sentiment: doc.aiVersions?.[0]?.ai?.sentimentLabel || "neutral",
      });
    } catch (e) {
      out.push({ filename: file.originalname, ok: false, error: e.message || "Failed to analyze file" });
    }
  }

  const okCount = out.filter((x) => x.ok).length;
  return res.status(okCount ? 201 : 400).json({
    ok: okCount > 0,
    model: geminiConfig().model,
    geminiEnabled: geminiConfig().enabled,
    analyzed: okCount,
    failed: out.length - okCount,
    items: out,
  });
});

router.get("/health", requireExternalAuth, (req, res) => {
  res.json({ ok: true, externalApi: "audio-ingest", callCenterId: req.externalCallCenter?.id || "" });
});

export default router;
