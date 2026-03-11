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

const client = {
  clientId: "demo_client_01",
  name: "Northstar Demo Client",
  active: true,
  createdByEmail: "seed-demo-client-script",
};

const users = [
  { email: "northstar.admin@example.com", name: "Northstar Admin", role: "admin", team: "Management", password: "demo1234", clientId: client.clientId },
  { email: "northstar.exec@example.com", name: "Northstar Executive", role: "executive", team: "Management", password: "demo1234", clientId: client.clientId },
  { email: "northstar.sup@example.com", name: "Northstar Supervisor", role: "supervisor", team: "Operations", password: "demo1234", clientId: client.clientId },
  { email: "northstar.qa@example.com", name: "Northstar QA", role: "qa", team: "Quality", password: "demo1234", clientId: client.clientId },
  { email: "northstar.agent1@example.com", name: "Northstar Agent 1", role: "agent", team: "Alpha", password: "demo1234", clientId: client.clientId },
  { email: "northstar.agent2@example.com", name: "Northstar Agent 2", role: "agent", team: "Beta", password: "demo1234", clientId: client.clientId },
];

const sentimentPlan = [
  "positive", "positive", "positive", "positive", "positive",
  "positive", "positive", "positive", "positive", "positive",
  "neutral", "neutral", "neutral", "neutral", "neutral", "neutral",
  "negative", "negative", "negative", "negative",
];

const topicCatalog = {
  positive: [
    {
      id: "cluster_101",
      title: "Billing Clarification",
      need: "Information Request",
      request: "Understand a charge on the latest bill",
      action: "Agent explained the billing line items and confirmed no issue.",
      transcript: "Customer contacted support to understand a charge on the latest bill. The agent verified the account, explained the invoice line by line, and confirmed that the charge matched the customer plan. The customer asked whether the amount would repeat next month, and the agent clarified the billing cycle and discount terms. By the end of the conversation, the customer confirmed the explanation was clear and no further action was required.",
    },
    {
      id: "cluster_102",
      title: "Plan Upgrade Question",
      need: "Sales Interest",
      request: "Ask about premium package features",
      action: "Agent explained upgrade options and pricing clearly.",
      transcript: "Customer called to learn more about premium package features and pricing. The agent compared the current plan with the premium option, highlighted the extra services, and answered questions about monthly costs. The customer asked about contract length and upgrade timing, and the agent described both the immediate activation path and the renewal option. The discussion ended positively, with the customer indicating interest in upgrading after an internal review.",
    },
  ],
  neutral: [
    {
      id: "cluster_201",
      title: "General Account Question",
      need: "Information Request",
      request: "Check account settings and service details",
      action: "Agent verified the account and provided the requested information.",
      transcript: "Customer reached out to review account settings and confirm service details. The agent verified identity, walked through the active configuration, and clarified which preferences could be changed immediately. The customer asked several routine follow-up questions about notifications, profile settings, and service coverage. The conversation remained calm and informational, and the customer left with the requested details and no escalation.",
    },
    {
      id: "cluster_202",
      title: "Delivery Timing Follow-up",
      need: "Action Request",
      request: "Ask for an update on service activation timing",
      action: "Agent reviewed the order and shared the latest ETA.",
      transcript: "Customer asked for an update on service activation timing after waiting longer than expected. The agent reviewed the order history, checked the provisioning notes, and shared the most recent estimated completion window. The customer wanted to know whether any documents were missing and whether the activation could be accelerated. The agent confirmed all required information was present, explained the remaining internal steps, and set expectations for the next update.",
    },
  ],
  negative: [
    {
      id: "cluster_301",
      title: "Repeated Connectivity Issue",
      need: "Problem/Issue",
      request: "Report recurring connection drops",
      action: "Agent created a technical case and escalated the issue.",
      transcript: "Customer reported repeated connection drops and expressed frustration that the issue had returned several times. The agent verified the account, reviewed prior incidents, and collected examples of when the service interruptions were happening. As the conversation continued, the customer emphasized the business impact and asked for a permanent fix rather than another temporary workaround. The agent opened a technical case, escalated the matter, and advised the customer on the next response window from the specialist team.",
    },
    {
      id: "cluster_302",
      title: "Cancellation Request",
      need: "Retention/Churn Risk",
      request: "Request cancellation after a poor recent experience",
      action: "Agent documented the complaint and offered retention options.",
      transcript: "Customer requested cancellation following a poor recent experience and declining confidence in the service. The agent listened to the complaint, documented the main concerns, and explored whether a retention offer could address the dissatisfaction. The customer explained that service reliability and previous delays had already affected internal planning, so patience was limited. The agent outlined the cancellation process, presented available alternatives, and left the case open for final confirmation after a supervisor review.",
    },
  ],
};

function pick(list, idx) {
  return list[idx % list.length];
}

function scoreForSentiment(label) {
  if (label === "positive") return 0.82;
  if (label === "negative") return -0.71;
  return 0.03;
}

function statusForSentiment(label, idx) {
  if (label === "positive") return idx % 4 === 0 ? "follow_up" : "resolved";
  if (label === "negative") return idx % 2 === 0 ? "escalated" : "unresolved";
  return idx % 3 === 0 ? "follow_up" : "resolved";
}

function crmDispositionForStatus(status) {
  if (status === "resolved") return "Resolved";
  if (status === "follow_up") return "Pending Follow-up";
  if (status === "escalated") return "Escalated";
  return "Pending";
}

async function upsertUsers() {
  const created = [];
  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    await User.updateOne(
      { email: user.email },
      {
        $set: {
          name: user.name,
          role: user.role,
          team: user.team,
          clientId: user.clientId,
          passwordHash,
        },
      },
      { upsert: true }
    );
    created.push(await User.findOne({ email: user.email }));
  }
  return created.filter(Boolean);
}

async function clearClientData() {
  await Promise.all([
    Interaction.deleteMany({ clientId: client.clientId }),
    Alert.deleteMany({ clientId: client.clientId }),
    CoachingItem.deleteMany({ clientId: client.clientId }),
    Dispute.deleteMany({ clientId: client.clientId }),
    AuditLog.deleteMany({ clientId: client.clientId }),
    CallCenter.deleteMany({ clientId: client.clientId }),
  ]);
}

async function seedInteractions(createdUsers) {
  const supervisor = createdUsers.find((u) => u.email === "northstar.sup@example.com");
  const agents = createdUsers.filter((u) => u.role === "agent");
  const channels = ["voice", "voice", "voice", "email", "webchat"];
  const now = Date.now();

  const docs = sentimentPlan.map((sentimentLabel, idx) => {
    const agent = agents[idx % agents.length];
    const topic = pick(topicCatalog[sentimentLabel], idx);
    const status = statusForSentiment(sentimentLabel, idx);
    const startedAt = new Date(now - idx * 6 * 60 * 60 * 1000);
    const durationSec = sentimentLabel === "negative" ? 540 + idx * 7 : sentimentLabel === "neutral" ? 390 + idx * 5 : 300 + idx * 4;
    const endedAt = new Date(startedAt.getTime() + durationSec * 1000);

    return {
      clientId: client.clientId,
      interactionId: `NSD_${String(idx + 1).padStart(3, "0")}`,
      channel: channels[idx % channels.length],
      direction: idx % 5 === 0 ? "outbound" : "inbound",
      startedAt,
      endedAt,
      durationSec,
      agent: {
        agentId: agent.email,
        agentName: agent.name,
        supervisor: supervisor?.email || "",
        team: agent.team,
        queue: idx % 2 === 0 ? "Support" : "Retention",
      },
      customer: {
        customerId: `NST_CUST_${String(idx + 1).padStart(3, "0")}`,
        tier: idx % 4 === 0 ? "gold" : idx % 3 === 0 ? "silver" : "standard",
        segment: idx % 2 === 0 ? "retail" : "smb",
      },
      media: {
        audioPath: "",
        recordingUrl: "",
      },
      aiVersions: [
        {
          version: 1,
          createdBy: supervisor?._id,
          reason: "demo_seed",
          ai: {
            transcriptMasked: topic.transcript,
            sentimentLabel,
            sentimentScore: scoreForSentiment(sentimentLabel),
            baseNeedType: topic.need,
            topicClusterId: topic.id,
            topicClusterTitle: topic.title,
            summary: {
              customerRequest: topic.request,
              actionsTaken: topic.action,
              status,
              nextBestAction: status === "resolved" ? "No further action required" : "Supervisor review within 24 hours",
            },
            qaMilestones: {
              greeting: sentimentLabel !== "negative" || idx % 2 === 1,
              idVerification: idx % 6 !== 0,
              solutionGiven: sentimentLabel !== "negative" || idx % 2 === 1,
              closing: sentimentLabel === "positive" || idx % 3 !== 0,
            },
            deadAirPercent: sentimentLabel === "negative" ? 8 : sentimentLabel === "neutral" ? 4 : 1.5,
            evidenceSpans: [
              { label: "customer_request", startSec: 8, endSec: 18, snippet: topic.request },
              { label: "resolution", startSec: 32, endSec: 48, snippet: topic.action },
            ],
          },
        },
      ],
      crmSnapshots: [
        {
          disposition: crmDispositionForStatus(status),
          outcomeTag: topic.id,
          updatedAt: endedAt,
        },
      ],
      integrity: {
        status: "new",
        assignedQa: "",
        resolvedReason: "",
        updatedAt: endedAt,
      },
    };
  });

  await Interaction.insertMany(docs);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/omnichannel_mvp");

  await Client.updateOne(
    { clientId: client.clientId },
    { $set: client },
    { upsert: true }
  );

  const createdUsers = await upsertUsers();
  await clearClientData();
  await seedInteractions(createdUsers);

  console.log(`Demo client ready: ${client.name} (${client.clientId})`);
  console.log("Sentiment distribution: positive=10, neutral=6, negative=4");
  console.log("Available logins:");
  for (const user of users) {
    console.log(`${user.email} / ${user.password}`);
  }
}

run()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
  });
