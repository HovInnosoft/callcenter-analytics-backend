import mongoose from "mongoose";

const EvidenceSpanSchema = new mongoose.Schema(
  {
    label: { type: String, required: true }, // e.g., "sentiment_driver", "cluster_evidence"
    startSec: { type: Number, default: 0 },
    endSec: { type: Number, default: 0 },
    snippet: { type: String, default: "" },
  },
  { _id: false }
);

const AiOutputSchema = new mongoose.Schema(
  {
    transcriptMasked: { type: String, default: "" },
    sentimentLabel: { type: String, enum: ["positive", "neutral", "negative"], default: "neutral" },
    sentimentScore: { type: Number, default: 0 }, // -1..1
    baseNeedType: { type: String, default: "Information Request" },
    topicClusterId: { type: String, default: "cluster_001" },
    topicClusterTitle: { type: String, default: "General Inquiry" },
    summary: {
      customerRequest: { type: String, default: "" },
      actionsTaken: { type: String, default: "" },
      status: { type: String, enum: ["resolved","unresolved","follow_up","escalated"], default: "unresolved" },
      nextBestAction: { type: String, default: "" },
    },
    qaMilestones: {
      greeting: { type: Boolean, default: true },
      idVerification: { type: Boolean, default: true },
      solutionGiven: { type: Boolean, default: true },
      closing: { type: Boolean, default: true },
    },
    deadAirPercent: { type: Number, default: 0 },
    evidenceSpans: { type: [EvidenceSpanSchema], default: [] },
    // Truth layer immutability: once created, this object is not updated; new versions appended below.
  },
  { _id: false }
);

const AiVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
    reason: { type: String, default: "" }, // QA correction reason
    ai: { type: AiOutputSchema, required: true },
  },
  { _id: false }
);

const CrmSnapshotSchema = new mongoose.Schema(
  {
    disposition: { type: String, default: "" },
    outcomeTag: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const InteractionSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true, default: "default_client" },
    interactionId: { type: String, required: true, unique: true, index: true },
    channel: { type: String, enum: ["voice", "email", "webchat"], required: true, index: true },
    direction: { type: String, enum: ["inbound", "outbound"], default: "inbound" },
    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, required: true },
    durationSec: { type: Number, default: 0 },
    agent: {
      agentId: { type: String, default: "" },
      agentName: { type: String, default: "" },
      supervisor: { type: String, default: "" },
      team: { type: String, default: "" },
      queue: { type: String, default: "" },
    },
    customer: {
      customerId: { type: String, default: "" },
      segment: { type: String, default: "" },
      tier: { type: String, default: "" },
    },
    media: {
      audioPath: { type: String, default: "" }, // server relative path
      recordingUrl: { type: String, default: "" }, // optional external
    },
    aiVersions: { type: [AiVersionSchema], default: [] }, // append-only
    crmSnapshots: { type: [CrmSnapshotSchema], default: [] }, // append-only
    integrity: {
      status: { type: String, enum: ["new", "under_review", "resolved"], default: "new", index: true },
      assignedQa: { type: String, default: "" },
      resolvedReason: { type: String, default: "" },
      resolvedAt: { type: Date },
      updatedAt: { type: Date },
    },
  },
  { timestamps: true }
);

export const Interaction = mongoose.model("Interaction", InteractionSchema);
