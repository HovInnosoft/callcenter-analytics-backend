import express from "express";
import { applyClientScope, requireAuth } from "../middleware/auth.js";
import { Interaction } from "../models/Interaction.js";

const router = express.Router();

function latestAi(doc) {
  return (doc.aiVersions || []).slice(-1)[0]?.ai || null;
}

function extractTurns(transcript = "") {
  const lines = String(transcript || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const cleaned = line.replace(/^\d{1,2}:\d{2}\s+/, "");
    const match = cleaned.match(/^([^:-]+)\s*[-:]\s*(.+)$/);
    if (!match) return { speaker: "unknown", text: cleaned };
    return {
      speaker: match[1].trim().toLowerCase(),
      text: match[2].trim(),
    };
  });
}

function speakerTexts(ai) {
  const turns = extractTurns(ai?.transcriptMasked);
  const customerAliases = ["client", "customer", "user", "caller", "հաճախորդ"];
  const operatorAliases = ["operator", "agent", "advisor", "representative", "օպերատոր"];

  const pickText = (aliases) =>
    turns
      .filter((turn) => aliases.some((alias) => turn.speaker.includes(alias)))
      .map((turn) => turn.text);

  return {
    customer: pickText(customerAliases),
    operator: pickText(operatorAliases),
  };
}

function normalizeKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0531-\u0587\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clipPhrase(value = "", fallback = "Unknown") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  const compact = text.replace(/\s+/g, " ");
  return compact.length > 72 ? `${compact.slice(0, 72).trim()}...` : compact;
}

function upsertDriver(map, rawTitle, sampleQuote, sentimentScore) {
  const title = clipPhrase(rawTitle, "Unknown");
  const key = normalizeKey(title) || "unknown";
  const prev = map.get(key) || { title, volume: 0, sentimentSum: 0, sampleQuote: "" };
  prev.volume += 1;
  prev.sentimentSum += sentimentScore || 0;
  if (!prev.sampleQuote && sampleQuote) prev.sampleQuote = clipPhrase(sampleQuote, "");
  map.set(key, prev);
}

function topDrivers(map) {
  return Array.from(map.values())
    .map((entry) => ({ ...entry, avgSentiment: entry.volume ? entry.sentimentSum / entry.volume : 0 }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 3);
}

router.get("/executive-overview", requireAuth, async (req, res) => {
  const { from, to, channel, sentiment: sentimentFilter } = req.query;
  let filter = {};
  if (from || to) {
    filter.startedAt = {};
    if (from) filter.startedAt.$gte = new Date(from);
    if (to) filter.startedAt.$lte = new Date(to);
  }
  if (channel) filter.channel = channel;
  filter = applyClientScope(req, filter);

  let docs = await Interaction.find(filter).lean();
  if (sentimentFilter) docs = docs.filter((d) => latestAi(d)?.sentimentLabel === sentimentFilter);

  let total = 0;
  let durationSumSec = 0;
  const byChannel = {};
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  const clusters = new Map();
  const sentimentClusters = {
    positive: new Map(),
    neutral: new Map(),
    negative: new Map(),
  };
  const splitDrivers = {
    positive: { customer: new Map(), operator: new Map() },
    neutral: { customer: new Map(), operator: new Map() },
    negative: { customer: new Map(), operator: new Map() },
  };
  const unresolved = { resolved: 0, unresolved: 0, follow_up: 0, escalated: 0 };

  for (const d of docs) {
    total += 1;
    durationSumSec += d.durationSec || 0;
    byChannel[d.channel] = (byChannel[d.channel] || 0) + 1;
    const ai = latestAi(d);
    if (ai) {
      sentiment[ai.sentimentLabel] = (sentiment[ai.sentimentLabel] || 0) + 1;
      const key = ai.topicClusterId;
      const prev = clusters.get(key) || {
        clusterId: key,
        title: ai.topicClusterTitle,
        volume: 0,
        sentimentSum: 0,
        sampleQuote: "",
      };
      prev.volume += 1;
      prev.sentimentSum += ai.sentimentScore || 0;
      if (!prev.sampleQuote && ai.summary?.customerRequest) {
        prev.sampleQuote = ai.summary.customerRequest;
      }
      clusters.set(key, prev);

      if (sentimentClusters[ai.sentimentLabel]) {
        const sentimentMap = sentimentClusters[ai.sentimentLabel];
        const sentimentKey = ai.topicClusterId || ai.topicClusterTitle || "unknown_topic";
        const prevSentiment = sentimentMap.get(sentimentKey) || {
          clusterId: ai.topicClusterId,
          title: ai.topicClusterTitle || "Unknown topic",
          volume: 0,
          sentimentSum: 0,
          sampleQuote: "",
        };
        prevSentiment.volume += 1;
        prevSentiment.sentimentSum += ai.sentimentScore || 0;
        if (!prevSentiment.sampleQuote && ai.summary?.customerRequest) {
          prevSentiment.sampleQuote = ai.summary.customerRequest;
        }
        sentimentMap.set(sentimentKey, prevSentiment);
      }

      if (splitDrivers[ai.sentimentLabel]) {
        const transcriptBySpeaker = speakerTexts(ai);
        upsertDriver(
          splitDrivers[ai.sentimentLabel].customer,
          ai.summary?.customerRequest || transcriptBySpeaker.customer[0] || ai.topicClusterTitle,
          transcriptBySpeaker.customer[0] || ai.summary?.customerRequest || "",
          ai.sentimentScore
        );
        upsertDriver(
          splitDrivers[ai.sentimentLabel].operator,
          ai.summary?.actionsTaken || ai.summary?.nextBestAction || transcriptBySpeaker.operator[0] || ai.topicClusterTitle,
          transcriptBySpeaker.operator[0] || ai.summary?.actionsTaken || "",
          ai.sentimentScore
        );
      }

      const st = ai.summary?.status || "unresolved";
      unresolved[st] = (unresolved[st] || 0) + 1;
    }
  }

  const topClusters = Array.from(clusters.values())
    .map((c) => ({ ...c, avgSentiment: c.volume ? c.sentimentSum / c.volume : 0 }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  const topSentimentDrivers = Object.fromEntries(
    Object.entries(sentimentClusters).map(([label, map]) => [
      label,
      {
        overall: topDrivers(map),
        customer: topDrivers(splitDrivers[label].customer),
        operator: topDrivers(splitDrivers[label].operator),
      },
    ])
  );

  const avgDurationSec = total ? durationSumSec / total : 0;
  res.json({ total, byChannel, sentiment, unresolved, topClusters, topSentimentDrivers, avgDurationSec });
});

router.get("/team-quality", requireAuth, async (req, res) => {
  const { from, to, channel, sentiment: sentimentFilter } = req.query;
  let filter = {};
  if (from || to) {
    filter.startedAt = {};
    if (from) filter.startedAt.$gte = new Date(from);
    if (to) filter.startedAt.$lte = new Date(to);
  }
  if (channel) filter.channel = channel;
  filter = applyClientScope(req, filter);

  let docs = await Interaction.find(filter).lean();
  if (sentimentFilter) docs = docs.filter((d) => latestAi(d)?.sentimentLabel === sentimentFilter);

  // Aggregate per agent
  const agents = new Map();

  for (const d of docs) {
    const ai = latestAi(d);
    if (!ai) continue;
    const agentId = d.agent?.agentId || "unknown";
    const prev = agents.get(agentId) || {
      agentId,
      agentName: d.agent?.agentName || agentId,
      team: d.agent?.team || "",
      interactions: 0,
      qaPass: 0,
      compliancePass: 0,
      negative: 0,
      ahtSum: 0,
      milestones: { greeting: { pass: 0, total: 0 }, idVerification: { pass: 0, total: 0 }, solutionGiven: { pass: 0, total: 0 }, closing: { pass: 0, total: 0 } },
    };

    prev.interactions += 1;
    const m = ai.qaMilestones || {};
    // Basic scoring: % milestones passed
    const keys = ["greeting","idVerification","solutionGiven","closing"];
    let passed = 0;
    for (const k of keys) {
      const ok = !!m[k];
      prev.milestones[k].total += 1;
      prev.milestones[k].pass += ok ? 1 : 0;
      if (ok) passed += 1;
    }
    const qaScore = (passed / keys.length) * 100;
    prev.qaPass += qaScore;

    // Compliance = ID verification
    prev.compliancePass += m.idVerification ? 1 : 0;

    prev.negative += ai.sentimentLabel === "negative" ? 1 : 0;
    prev.ahtSum += d.durationSec || 0;

    agents.set(agentId, prev);
  }

  const rows = Array.from(agents.values()).map((a) => ({
    ...a,
    avgQaScore: a.interactions ? a.qaPass / a.interactions : 0,
    compliancePassRate: a.interactions ? (a.compliancePass / a.interactions) * 100 : 0,
    negativeRate: a.interactions ? (a.negative / a.interactions) * 100 : 0,
    avgAHT: a.interactions ? a.ahtSum / a.interactions : 0,
    milestones: Object.fromEntries(Object.entries(a.milestones).map(([k,v]) => [k, v.total ? (v.pass/v.total)*100 : 0])),
  }));

  res.json({ agents: rows });
});

export default router;
