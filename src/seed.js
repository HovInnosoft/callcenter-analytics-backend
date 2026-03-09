import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "./models/User.js";
import { Client } from "./models/Client.js";
import { Interaction } from "./models/Interaction.js";
import { Alert } from "./models/Alert.js";
import { CoachingItem } from "./models/CoachingItem.js";
import { Dispute } from "./models/Dispute.js";
import { AuditLog } from "./models/AuditLog.js";
import { CallCenter } from "./models/CallCenter.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randId(prefix = "I") {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sample(arr, count) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < count) {
    out.push(copy.splice(randInt(0, copy.length - 1), 1)[0]);
  }
  return out;
}

function mismatchScore(ai, crm) {
  let score = 0;
  const aiStatus = ai?.summary?.status || "unresolved";
  const crmDisp = (crm?.disposition || "").toLowerCase();

  const crmResolved = crmDisp.includes("resolved") || crmDisp.includes("done") || crmDisp.includes("closed");
  const aiResolved = aiStatus === "resolved";
  if (crmResolved && !aiResolved) score += 60;
  if (!crmResolved && aiResolved) score += 30;

  const crmPositive = crmDisp.includes("positive") || crmDisp.includes("satisfied");
  if (crmPositive && ai?.sentimentLabel === "negative") score += 30;

  return Math.min(100, score);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/omnichannel_mvp");

  await Promise.all([
    Client.deleteMany({}),
    User.deleteMany({}),
    Interaction.deleteMany({}),
    Alert.deleteMany({}),
    CoachingItem.deleteMany({}),
    Dispute.deleteMany({}),
    AuditLog.deleteMany({}),
    CallCenter.deleteMany({}),
  ]);

  await Client.create({
    clientId: "default_client",
    name: "Default Client",
    active: true,
    createdByEmail: "seed-script",
  });

  const users = [
    { email: "superadmin@example.com", name: "Super Admin", role: "superadmin", team: "Platform", password: "super1234", clientId: "default_client" },
    { email: "admin@example.com", name: "Admin", role: "admin", team: "General", password: "admin1234", clientId: "default_client" },
    { email: "exec@example.com", name: "Executive", role: "executive", team: "General", password: "exec1234", clientId: "default_client" },
    { email: "sup@example.com", name: "Supervisor", role: "supervisor", team: "Team A", password: "sup1234", clientId: "default_client" },
    { email: "qa@example.com", name: "QA Analyst", role: "qa", team: "Team A", password: "qa1234", clientId: "default_client" },
    { email: "agent1@example.com", name: "Agent 1", role: "agent", team: "Team A", password: "agent1234", clientId: "default_client" },
    { email: "agent2@example.com", name: "Agent 2", role: "agent", team: "Team B", password: "agent1234", clientId: "default_client" },
    { email: "agent3@example.com", name: "Agent 3", role: "agent", team: "Team A", password: "agent1234", clientId: "default_client" },
  ];

  const createdUsers = [];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const doc = await User.create({
      email: u.email,
      name: u.name,
      role: u.role,
      team: u.team,
      clientId: u.clientId || "default_client",
      passwordHash,
    });
    createdUsers.push(doc);
  }

  const admin = createdUsers.find((u) => u.email === "admin@example.com");
  const supervisor = createdUsers.find((u) => u.email === "sup@example.com");
  const qa = createdUsers.find((u) => u.email === "qa@example.com");
  const agents = createdUsers.filter((u) => u.role === "agent");

  const baseNeedTypes = [
    "Information Request",
    "Action Request",
    "Problem/Issue",
    "Complaint",
    "Sales Interest",
    "Retention/Churn Risk",
    "Other",
  ];

  const clusters = [
    { id: "cluster_001", title: "General Inquiry" },
    { id: "cluster_002", title: "Account Access / Login Issues" },
    { id: "cluster_003", title: "Payment / Billing Question" },
    { id: "cluster_004", title: "Delivery / Timing Complaint" },
    { id: "cluster_005", title: "Cancellation Request" },
    { id: "cluster_006", title: "Upgrade / Sales Questions" },
    { id: "cluster_007", title: "Technical Connectivity Issue" },
  ];

  const customerRequests = [
    "Reset my account access",
    "Explain my latest invoice",
    "Report delayed service activation",
    "Cancel my subscription",
    "Ask about premium package",
    "Resolve recurring connection drops",
    "Update profile and billing settings",
  ];

  const actionsTaken = [
    "Agent verified identity and guided through next steps.",
    "Agent explained policy and account timeline.",
    "Agent opened a follow-up ticket and shared ETA.",
    "Agent escalated to specialist queue.",
    "Agent completed plan change in CRM.",
  ];

  const queues = ["Support", "Retention", "Billing", "Sales", "Technical"];

  const now = Date.now();
  const interactions = [];

  for (let i = 0; i < 180; i += 1) {
    const agent = pick(agents);
    const channel = pick(["voice", "voice", "voice", "email", "webchat"]);
    const direction = Math.random() > 0.2 ? "inbound" : "outbound";
    const startedAt = new Date(now - Math.random() * 1000 * 60 * 60 * 24 * 30);
    const durationSec = channel === "voice" ? randInt(120, 1200) : randInt(40, 540);
    const endedAt = new Date(startedAt.getTime() + durationSec * 1000);

    const cluster = pick(clusters);
    const sentimentLabel = pick(["positive", "neutral", "negative", "neutral", "negative"]);
    const sentimentScore = sentimentLabel === "positive"
      ? Number((0.35 + Math.random() * 0.6).toFixed(2))
      : sentimentLabel === "negative"
      ? Number((-0.35 - Math.random() * 0.6).toFixed(2))
      : Number((-0.1 + Math.random() * 0.2).toFixed(2));

    const status = pick(["resolved", "unresolved", "follow_up", "escalated", "unresolved"]);

    const ai = {
      transcriptMasked: `Agent: Hello. Customer: ${pick(customerRequests)}. Contact [PHONE].`,
      sentimentLabel,
      sentimentScore,
      baseNeedType: pick(baseNeedTypes),
      topicClusterId: cluster.id,
      topicClusterTitle: cluster.title,
      summary: {
        customerRequest: pick(customerRequests),
        actionsTaken: pick(actionsTaken),
        status,
        nextBestAction: status === "resolved" ? "No action" : "Supervisor follow-up within 24 hours",
      },
      qaMilestones: {
        greeting: Math.random() > 0.12,
        idVerification: Math.random() > 0.18,
        solutionGiven: Math.random() > 0.2,
        closing: Math.random() > 0.15,
      },
      deadAirPercent: Number((Math.random() * 16).toFixed(1)),
      evidenceSpans: [
        { label: "cluster_evidence", startSec: 12, endSec: 20, snippet: `...${cluster.title}...` },
        { label: "sentiment_driver", startSec: 45, endSec: 60, snippet: "...customer frustrated about repeated issues..." },
      ],
    };

    const forceMismatch = i % 4 === 0;
    let disposition = status === "resolved" ? "Resolved" : "Pending";
    if (forceMismatch && status !== "resolved") disposition = "Resolved";
    if ((i % 9 === 0) && sentimentLabel === "negative") disposition = "Resolved Positive";

    const crmSnapshots = [
      {
        disposition,
        outcomeTag: pick(["", "billing", "retention", "technical", "sales"]),
        updatedAt: endedAt,
      },
    ];

    const score = mismatchScore(ai, crmSnapshots[0]);
    let integrity = { status: "new", assignedQa: "", resolvedReason: "", updatedAt: endedAt };

    if (score >= 40 && i % 3 === 0) {
      integrity = {
        status: "under_review",
        assignedQa: qa.email,
        resolvedReason: "",
        updatedAt: new Date(endedAt.getTime() + randInt(5, 180) * 60 * 1000),
      };
    }

    if (score >= 40 && i % 7 === 0) {
      integrity = {
        status: "resolved",
        assignedQa: qa.email,
        resolvedReason: "Reviewed call and corrected CRM disposition.",
        resolvedAt: new Date(endedAt.getTime() + randInt(2, 36) * 60 * 60 * 1000),
        updatedAt: new Date(endedAt.getTime() + randInt(2, 36) * 60 * 60 * 1000),
      };
    }

    const interaction = {
      clientId: "default_client",
      interactionId: randId("INT"),
      channel,
      direction,
      startedAt,
      endedAt,
      durationSec,
      agent: {
        agentId: agent.email,
        agentName: agent.name,
        supervisor: supervisor.email,
        team: agent.team,
        queue: pick(queues),
      },
      customer: {
        customerId: randId("CUST"),
        tier: pick(["standard", "premium", "vip"]),
        segment: pick(["retail", "smb", "enterprise"]),
      },
      media: { audioPath: "" },
      aiVersions: [{ version: 1, createdBy: qa._id, reason: "initial", ai }],
      crmSnapshots,
      integrity,
    };

    if (Math.random() > 0.82) {
      const revised = {
        ...ai,
        summary: {
          ...ai.summary,
          status: pick(["resolved", "follow_up", "unresolved"]),
        },
      };
      interaction.aiVersions.push({
        version: 2,
        createdBy: qa._id,
        reason: "qa_correction",
        createdAt: new Date(endedAt.getTime() + 4 * 60 * 60 * 1000),
        ai: revised,
      });
    }

    interactions.push(interaction);
  }

  const insertedInteractions = await Interaction.insertMany(interactions);

  const alerts = [];
  const highMismatchInteractions = insertedInteractions.filter((it) => {
    const ai = it.aiVersions.slice(-1)[0]?.ai;
    const crm = it.crmSnapshots.slice(-1)[0];
    return mismatchScore(ai, crm) >= 40;
  });

  for (const it of sample(highMismatchInteractions, 10)) {
    alerts.push({
      clientId: "default_client",
      type: "integrity_mismatch",
      severity: pick(["medium", "high", "critical"]),
      title: `Integrity mismatch detected for ${it.interactionId}`,
      description: "AI outcome differs from CRM disposition and requires review.",
      interactionId: it.interactionId,
      status: pick(["new", "reviewed"]),
      createdBy: supervisor._id,
      evidence: { source: "seed", mismatchScore: mismatchScore(it.aiVersions.slice(-1)[0]?.ai, it.crmSnapshots.slice(-1)[0]) },
    });
  }

  for (const it of sample(insertedInteractions, 8)) {
    alerts.push({
      clientId: "default_client",
      type: "compliance_fail",
      severity: pick(["medium", "high"]),
      title: `ID verification failed in ${it.interactionId}`,
      description: "One or more compliance milestones failed and need supervisor review.",
      interactionId: it.interactionId,
      status: pick(["new", "reviewed", "resolved"]),
      createdBy: qa._id,
      evidence: { milestone: "idVerification" },
    });
  }

  for (const c of clusters.slice(0, 4)) {
    alerts.push({
      clientId: "default_client",
      type: "crisis_spike",
      severity: pick(["high", "critical"]),
      title: `Cluster spike: ${c.title}`,
      description: "Volume increase + negative sentiment trend in the last 24h.",
      clusterId: c.id,
      status: pick(["new", "reviewed"]),
      createdBy: supervisor._id,
      evidence: { windowHours: 24, trend: "volume_up_sentiment_down" },
    });
  }

  await Alert.insertMany(alerts);

  const coachingItems = [];
  const coachingPool = sample(insertedInteractions, 32);
  for (const it of coachingPool) {
    const assignedAgentId = it.agent?.agentId || pick(agents).email;
    const assignedAgentName = it.agent?.agentName || "Agent";
    const dueDate = new Date(Date.now() + randInt(1, 14) * 24 * 60 * 60 * 1000);
    const status = pick(["new", "acknowledged", "completed", "disputed", "new"]);

    const doc = {
      clientId: "default_client",
      interactionId: it.interactionId,
      assignedToAgentId: assignedAgentId,
      assignedToAgentName: assignedAgentName,
      dueDate,
      note: pick([
        "Improve greeting consistency and close-loop confirmation.",
        "Reduce dead air and summarize next steps more clearly.",
        "Reinforce compliance script during verification phase.",
        "Use empathy language before escalation.",
      ]),
      status,
      createdBy: pick([supervisor._id, qa._id, admin._id]),
    };

    if (status === "acknowledged") doc.acknowledgedAt = new Date(Date.now() - randInt(1, 4) * 24 * 60 * 60 * 1000);
    if (status === "completed") doc.completedAt = new Date(Date.now() - randInt(1, 3) * 24 * 60 * 60 * 1000);
    if (status === "disputed") {
      doc.disputedAt = new Date(Date.now() - randInt(1, 2) * 24 * 60 * 60 * 1000);
      doc.disputeReason = "Context not considered; customer issue was system outage related.";
    }

    coachingItems.push(doc);
  }
  await CoachingItem.insertMany(coachingItems);

  const disputes = [];
  const disputesPool = sample(insertedInteractions.filter((it) => agents.some((a) => a.email === it.agent?.agentId)), 18);
  for (const it of disputesPool) {
    const status = pick(["new", "under_review", "resolved", "rejected"]);
    const d = {
      clientId: "default_client",
      interactionId: it.interactionId,
      agentId: it.agent.agentId,
      agentName: it.agent.agentName,
      reason: pick([
        "AI summary missed critical customer constraints.",
        "Sentiment label should be neutral due to final resolution.",
        "CRM disposition was updated after call and mismatch is stale.",
      ]),
      status,
      resolutionNote: "",
    };

    if (status === "resolved" || status === "rejected") {
      d.resolutionNote = pick([
        "Reviewed by QA and corrected in follow-up version.",
        "Dispute rejected after transcript verification.",
      ]);
      d.resolvedBy = pick([qa._id, supervisor._id]);
      d.resolvedAt = new Date(Date.now() - randInt(1, 5) * 24 * 60 * 60 * 1000);
    }

    disputes.push(d);
  }
  await Dispute.insertMany(disputes);

  const auditActions = [
    "login",
    "create",
    "update",
    "append_version",
    "assign_qa",
    "resolve_integrity",
    "create_coaching",
    "acknowledge",
    "dispute",
  ];

  const entityTypes = ["Interaction", "Alert", "CoachingItem", "Dispute", "Auth"];
  const auditLogs = [];
  for (let i = 0; i < 140; i += 1) {
    const actor = pick(createdUsers);
    const entityType = pick(entityTypes);
    auditLogs.push({
      clientId: "default_client",
      actorUserId: actor._id,
      actorEmail: actor.email,
      action: pick(auditActions),
      entityType,
      entityId: entityType === "Interaction" ? pick(insertedInteractions).interactionId : randId("ENT"),
      meta: {
        method: pick(["GET", "POST", "PATCH"]),
        path: pick([
          "/api/interactions",
          "/api/integrity",
          "/api/alerts",
          "/api/coaching",
          "/api/disputes",
          "/api/auth/login",
        ]),
      },
      ip: `10.0.0.${randInt(3, 240)}`,
      userAgent: "seed-script",
      createdAt: new Date(Date.now() - randInt(1, 30) * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    });
  }
  await AuditLog.insertMany(auditLogs);

  const counts = await Promise.all([
    User.countDocuments(),
    Interaction.countDocuments(),
    Alert.countDocuments(),
    CoachingItem.countDocuments(),
    Dispute.countDocuments(),
    AuditLog.countDocuments(),
  ]);

  console.log("Seed complete.");
  console.log(`Users: ${counts[0]}`);
  console.log(`Interactions: ${counts[1]}`);
  console.log(`Alerts: ${counts[2]}`);
  console.log(`Coaching items: ${counts[3]}`);
  console.log(`Disputes: ${counts[4]}`);
  console.log(`Audit logs: ${counts[5]}`);
  console.log("Demo users:");
  console.log("superadmin@example.com / super1234");
  console.log("admin@example.com / admin1234");
  console.log("exec@example.com / exec1234");
  console.log("sup@example.com / sup1234");
  console.log("qa@example.com / qa1234");
  console.log("agent1@example.com / agent1234");
  console.log("agent2@example.com / agent1234");

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
