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
      transcript: "0:01 Operator - Hello, thank you for calling Northstar support.\n0:03 Client - Hi, I have a question about a charge on my latest bill.\n0:07 Operator - Sure, can you tell me which charge looks unclear to you?\n0:11 Client - There is an extra amount on the invoice and I do not remember adding anything.\n0:18 Operator - Let me open the account and check the line items.\n0:24 Operator - I can see the monthly package fee, the tax amount, and a pro-rated service adjustment from the middle of last month.\n0:33 Client - So this is not a penalty or something overdue?\n0:37 Operator - No, this is not a penalty. It is the adjustment that happened when the package changed on the fifteenth.\n0:45 Client - Will the same amount repeat next month?\n0:49 Operator - No, next month the bill should return to the normal recurring amount without the partial adjustment.\n0:57 Client - Okay, that makes more sense now.\n1:00 Operator - I can also send the invoice breakdown to your email if that helps.\n1:05 Client - No, that is fine, thank you.\n1:08 Operator - You're welcome, and thank you for calling Northstar.",
    },
    {
      id: "cluster_102",
      title: "Plan Upgrade Question",
      need: "Sales Interest",
      request: "Ask about premium package features",
      action: "Agent explained upgrade options and pricing clearly.",
      transcript: "0:01 Operator - Hi, this is Northstar company, how can I help you today?\n0:04 Client - Hi, I wanted to ask about your premium package.\n0:08 Operator - Of course. Are you calling about features, pricing, or upgrade timing?\n0:13 Client - Mainly all three. I want to know what extra services it includes compared to my current plan.\n0:21 Operator - The premium package includes priority support, expanded reporting, and a higher monthly usage limit.\n0:29 Client - And how much more would it cost per month?\n0:33 Operator - Based on your current package, the upgrade would add around twenty percent to the monthly fee.\n0:41 Client - Is there a contract extension if I upgrade now?\n0:45 Operator - You can upgrade immediately under the current term, or wait until renewal and switch then.\n0:52 Client - If I do it now, does it activate right away?\n0:55 Operator - Usually within the same business day after confirmation.\n1:00 Client - Okay, I need to discuss it internally first.\n1:04 Operator - No problem, I can note your interest and we can follow up later this week.\n1:09 Client - That would be good, thank you.\n1:12 Operator - Thank you for calling Northstar.",
    },
  ],
  neutral: [
    {
      id: "cluster_201",
      title: "General Account Question",
      need: "Information Request",
      request: "Check account settings and service details",
      action: "Agent verified the account and provided the requested information.",
      transcript: "0:01 Operator - Good afternoon, Northstar support speaking.\n0:03 Client - Hi, I want to check some settings on my account and make sure everything is active.\n0:10 Operator - Sure, I will verify the account first.\n0:14 Client - Okay.\n0:17 Operator - Thank you, I have the profile open now. Your main service is active and notifications are enabled by email.\n0:26 Client - Can I change notifications to phone as well?\n0:30 Operator - Yes, that can be enabled from the profile settings and I can add it for you now.\n0:37 Client - Also, does my current plan include service outside the city area?\n0:42 Operator - It includes standard regional coverage, but not the extended area option.\n0:48 Client - Alright, and the billing contact is still my company email, right?\n0:53 Operator - Yes, that is still the billing contact on file.\n0:57 Client - Perfect, that was all I needed.\n1:00 Operator - Great, thank you for calling Northstar.",
    },
    {
      id: "cluster_202",
      title: "Delivery Timing Follow-up",
      need: "Action Request",
      request: "Ask for an update on service activation timing",
      action: "Agent reviewed the order and shared the latest ETA.",
      transcript: "0:01 Operator - Hello, Northstar support.\n0:03 Client - Hi, I am calling to check when my service will be activated.\n0:08 Operator - Let me review the order, one moment please.\n0:14 Operator - I can see the request in progress and the latest note says activation is pending final provisioning.\n0:22 Client - We submitted everything three days ago. Is anything missing from our side?\n0:28 Operator - I do not see any missing documents. The delay appears to be on the internal setup step.\n0:35 Client - Can this be accelerated? We were expecting it to be ready already.\n0:40 Operator - I understand. I can add an urgency note, but the current estimated completion window is still tomorrow afternoon.\n0:49 Client - So there is nothing else I need to send?\n0:52 Operator - Correct, all required information is already in the order.\n0:57 Client - Alright, then I will wait for the next update.\n1:01 Operator - We will notify you as soon as provisioning is completed.\n1:05 Client - Thank you.\n1:07 Operator - Thank you for calling.",
    },
  ],
  negative: [
    {
      id: "cluster_301",
      title: "Repeated Connectivity Issue",
      need: "Problem/Issue",
      request: "Report recurring connection drops",
      action: "Agent created a technical case and escalated the issue.",
      transcript: "0:01 Operator - Northstar support, how can I help?\n0:03 Client - Hi, the connection keeps dropping again and this is the third time this week.\n0:09 Operator - I am sorry to hear that. Let me check the account.\n0:14 Client - We already called before and the issue came back.\n0:19 Operator - I can see previous incidents here. Can you tell me when the last interruption happened?\n0:25 Client - About twenty minutes ago, and yesterday it happened twice during working hours.\n0:32 Operator - Understood. Are all users affected or only one location?\n0:36 Client - It is affecting the whole office, and it is disrupting customer calls.\n0:42 Operator - I understand the impact. I will open a technical case and escalate this to the specialist team.\n0:49 Client - I do not want another temporary fix. We need this solved permanently.\n0:55 Operator - I am adding that note to the case and marking it as urgent.\n1:00 Client - When should we expect an answer?\n1:03 Operator - The specialist team should respond within the next twenty-four hours.\n1:08 Client - Fine, please make sure someone actually follows up.\n1:12 Operator - I have documented that and escalated it now.",
    },
    {
      id: "cluster_302",
      title: "Cancellation Request",
      need: "Retention/Churn Risk",
      request: "Request cancellation after a poor recent experience",
      action: "Agent documented the complaint and offered retention options.",
      transcript: "0:01 Operator - Hello, thank you for calling Northstar.\n0:03 Client - Hi, I want to cancel the service.\n0:06 Operator - I am sorry to hear that. Can you tell me what led to this decision?\n0:12 Client - We had repeated delays, unstable service, and no clear resolution the last few times we contacted support.\n0:20 Operator - I understand. Let me document the complaint before we proceed.\n0:25 Client - Honestly, confidence is low at this point and we are considering another provider.\n0:31 Operator - I can check whether there is a retention option or service adjustment available before cancellation.\n0:38 Client - You can mention it, but I cannot promise we will stay.\n0:43 Operator - Understood. I can offer a supervisor review and a revised package option with priority support.\n0:51 Client - Please send the details, but I still want the cancellation process explained.\n0:57 Operator - I will note the request, outline the cancellation steps, and leave the case open until you confirm the final decision.\n1:05 Client - Alright, send the information today.\n1:08 Operator - I will do that right away.",
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
