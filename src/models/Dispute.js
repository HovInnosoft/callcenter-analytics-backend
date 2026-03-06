import mongoose from "mongoose";

const DisputeSchema = new mongoose.Schema(
  {
    interactionId: { type: String, required: true, index: true },
    agentId: { type: String, required: true, index: true },
    agentName: { type: String, default: "" },
    reason: { type: String, required: true },
    status: { type: String, enum: ["new", "under_review", "resolved", "rejected"], default: "new", index: true },
    resolutionNote: { type: String, default: "" },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

export const Dispute = mongoose.model("Dispute", DisputeSchema);
