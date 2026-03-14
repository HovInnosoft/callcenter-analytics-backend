import fs from "fs/promises";
import { inferEffectiveSummary } from "./effective-resolution.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-pro-preview";
const GEMINI_API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseJsonBlock(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : raw;
  return JSON.parse(candidate);
}

function detectIdVerification(transcript) {
  const t = String(transcript || "").toLowerCase();
  if (!t.trim()) return false;

  const hasName = /\b(name|full name)\b/.test(t);
  const strongChecks = [
    /\b(date of birth|dob|birth)\b/,
    /\b(account( number)?|customer id|policy number)\b/,
    /\b(last\s*4|last four)\b/,
    /\b(phone|email|address)\b/,
    /\b(pin|otp|verification code|security question)\b/,
  ];
  const hasStrongCheck = strongChecks.some((r) => r.test(t));

  // Asking only name is not enough for identity verification.
  return hasName && hasStrongCheck;
}

function isSilenceLikeTranscript(transcript) {
  const text = String(transcript || "").trim().toLowerCase();
  if (!text) return true;

  const normalized = text.replace(/\s+/g, " ");
  return [
    "uploaded audio interaction",
    "[silence]",
    "silence",
    "no speech detected",
    "empty audio",
  ].includes(normalized);
}

function applySilenceHeuristic(out) {
  const transcriptLooksSilent = isSilenceLikeTranscript(out?.transcriptMasked);
  const hasNoSignals =
    !out?.qaMilestones?.greeting &&
    !out?.qaMilestones?.idVerification &&
    !out?.qaMilestones?.solutionGiven &&
    !out?.qaMilestones?.closing;

  if (!transcriptLooksSilent && !hasNoSignals) return out;

  return {
    ...out,
    transcriptMasked: transcriptLooksSilent ? "" : out.transcriptMasked,
    sentimentLabel: "neutral",
    sentimentScore: 0,
    baseNeedType: "Other",
    topicClusterId: "cluster_000",
    topicClusterTitle: "Silence / No Speech",
    summary: {
      customerRequest: "No speech detected in uploaded audio.",
      actionsTaken: "No interaction content available for analysis.",
      status: "unresolved",
      nextBestAction: "Review the recording source or upload a valid call.",
    },
    qaMilestones: {
      greeting: false,
      idVerification: false,
      solutionGiven: false,
      closing: false,
    },
    deadAirPercent: 100,
    evidenceSpans: [],
  };
}

function fallbackFromText(transcript, channel = "voice") {
  const t = String(transcript || "").toLowerCase();

  const positiveHints = ["thanks", "great", "resolved", "happy", "perfect", "awesome"];
  const negativeHints = ["angry", "upset", "cancel", "not working", "broken", "frustrated", "legal"];

  let sentimentLabel = "neutral";
  let sentimentScore = 0;
  if (negativeHints.some((k) => t.includes(k))) {
    sentimentLabel = "negative";
    sentimentScore = -0.55;
  } else if (positiveHints.some((k) => t.includes(k))) {
    sentimentLabel = "positive";
    sentimentScore = 0.45;
  }

  const baseNeedType = t.includes("cancel")
    ? "Retention/Churn Risk"
    : t.includes("buy") || t.includes("upgrade")
    ? "Sales Interest"
    : t.includes("issue") || t.includes("problem") || t.includes("error")
    ? "Problem/Issue"
    : t.includes("complaint")
    ? "Complaint"
    : t.includes("update") || t.includes("change")
    ? "Action Request"
    : "Information Request";

  const status = t.includes("resolved") || t.includes("fixed") ? "resolved" : "unresolved";
  const cluster = t.includes("billing")
    ? { id: "cluster_003", title: "Payment / Billing Question" }
    : t.includes("login") || t.includes("password")
    ? { id: "cluster_002", title: "Account Access / Login Issues" }
    : t.includes("cancel")
    ? { id: "cluster_005", title: "Cancellation Request" }
    : t.includes("delivery")
    ? { id: "cluster_004", title: "Delivery / Timing Complaint" }
    : { id: "cluster_001", title: channel === "email" ? "Email Inquiry" : "General Inquiry" };

  const out = {
    transcriptMasked: String(transcript || "").trim().slice(0, 12000),
    sentimentLabel,
    sentimentScore,
    baseNeedType,
    topicClusterId: cluster.id,
    topicClusterTitle: cluster.title,
    summary: {
      customerRequest: "Customer inquiry captured from uploaded file.",
      actionsTaken: "Pending agent follow-up.",
      status,
      nextBestAction: status === "resolved" ? "No action" : "Review and follow-up",
    },
    qaMilestones: {
      greeting: /\b(hello|hi|good morning|good afternoon|good evening)\b/.test(t),
      idVerification: detectIdVerification(transcript),
      solutionGiven: status === "resolved",
      closing: /\b(thank you|thanks|have a (nice|good) day|bye|goodbye)\b/.test(t),
    },
    deadAirPercent: 0,
    evidenceSpans: [],
  };

  return applySilenceHeuristic(out);
}

function normalizeOutput(raw, transcript, channel) {
  const allowedSentiment = ["positive", "neutral", "negative"];
  const allowedStatus = ["resolved", "unresolved", "follow_up", "escalated"];

  const out = {
    transcriptMasked: String(raw?.transcriptMasked || transcript || "").slice(0, 12000),
    sentimentLabel: allowedSentiment.includes(raw?.sentimentLabel) ? raw.sentimentLabel : "neutral",
    sentimentScore: clamp(Number(raw?.sentimentScore || 0), -1, 1),
    baseNeedType: String(raw?.baseNeedType || "Information Request"),
    topicClusterId: String(raw?.topicClusterId || "cluster_001"),
    topicClusterTitle: String(raw?.topicClusterTitle || "General Inquiry"),
    summary: {
      customerRequest: String(raw?.summary?.customerRequest || ""),
      actionsTaken: String(raw?.summary?.actionsTaken || ""),
      status: allowedStatus.includes(raw?.summary?.status) ? raw.summary.status : "unresolved",
      nextBestAction: String(raw?.summary?.nextBestAction || ""),
    },
    qaMilestones: {
      greeting: !!raw?.qaMilestones?.greeting,
      idVerification: !!raw?.qaMilestones?.idVerification,
      solutionGiven: !!raw?.qaMilestones?.solutionGiven,
      closing: !!raw?.qaMilestones?.closing,
    },
    deadAirPercent: clamp(Number(raw?.deadAirPercent || 0), 0, 100),
    evidenceSpans: Array.isArray(raw?.evidenceSpans)
      ? raw.evidenceSpans.slice(0, 10).map((e) => ({
          label: String(e?.label || "evidence"),
          startSec: Number(e?.startSec || 0),
          endSec: Number(e?.endSec || 0),
          snippet: String(e?.snippet || "").slice(0, 400),
        }))
      : [],
  };

  if (!out.topicClusterId || out.topicClusterId === "cluster_001") {
    out.topicClusterId = channel === "email" ? "cluster_email_001" : out.topicClusterId;
  }

  // Guardrail: avoid false positives when transcript has only weak identity checks.
  if (out.qaMilestones.idVerification && !detectIdVerification(out.transcriptMasked)) {
    out.qaMilestones.idVerification = false;
  }

  out.summary = inferEffectiveSummary(out);

  return applySilenceHeuristic(out);
}

async function callGemini(parts) {
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";
  if (!text.trim()) throw new Error("Gemini returned empty response");

  return parseJsonBlock(text);
}

const BASE_PROMPT = `You are a contact center AI analyst.

CRITICAL LANGUAGE RULE: The "transcriptMasked" field MUST be written in the EXACT language spoken or written in the interaction. If the speaker uses Armenian, write the transcript in Armenian script. If English, write in English. If Russian, write in Russian. NEVER translate or convert the transcript to any other language.

Analyze the customer interaction and return STRICT JSON with this exact shape:
{
  "transcriptMasked": "verbatim transcript in the ORIGINAL language of the audio/text, with PII replaced by placeholders like [NAME] [PHONE] [EMAIL] [ACCOUNT]",
  "sentimentLabel": "positive|neutral|negative",
  "sentimentScore": -1.0,
  "baseNeedType": "Information Request|Action Request|Problem/Issue|Complaint|Sales Interest|Retention/Churn Risk|Other",
  "topicClusterId": "cluster_xxx",
  "topicClusterTitle": "short title in English",
  "summary": {
    "customerRequest": "in English",
    "actionsTaken": "in English",
    "status": "resolved|unresolved|follow_up|escalated",
    "nextBestAction": "in English"
  },
  "qaMilestones": {
    "greeting": true,
    "idVerification": true,
    "solutionGiven": true,
    "closing": true
  },
  "deadAirPercent": 0,
  "evidenceSpans": [
    { "label": "English label", "startSec": 0, "endSec": 0, "snippet": "snippet in original language" }
  ]
}
Return JSON only. No markdown fences, no explanation.`;

export async function analyzeTextWithGemini(text, channel = "voice") {
  if (!GEMINI_API_KEY) return fallbackFromText(text, channel);

  try {
    const raw = await callGemini([
      { text: `${BASE_PROMPT}\n\nChannel: ${channel}\n\nText input:\n${String(text || "").slice(0, 20000)}` },
    ]);
    return normalizeOutput(raw, text, channel);
  } catch (e) {
    console.warn("Gemini text analysis failed; using fallback:", e.message);
    return fallbackFromText(text, channel);
  }
}

export async function analyzeAudioWithGemini(filePath, mimeType = "audio/mpeg") {
  if (!GEMINI_API_KEY) return fallbackFromText("Uploaded audio interaction", "voice");

  try {
    const bytes = await fs.readFile(filePath);
    const raw = await callGemini([
      { text: `${BASE_PROMPT}\n\nAnalyze this uploaded call recording.` },
      { inlineData: { mimeType, data: bytes.toString("base64") } },
    ]);
    return normalizeOutput(raw, raw?.transcriptMasked || "", "voice");
  } catch (e) {
    console.warn("Gemini audio analysis failed; using fallback:", e.message);
    return fallbackFromText("Uploaded audio interaction", "voice");
  }
}

export function geminiConfig() {
  return {
    enabled: !!GEMINI_API_KEY,
    model: GEMINI_MODEL,
  };
}
