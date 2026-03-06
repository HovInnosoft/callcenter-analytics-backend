import mongoose from "mongoose";

const CoachingItemSchema = new mongoose.Schema(
  {
    interactionId: { type: String, required: true, index: true },
    assignedToAgentId: { type: String, required: true, index: true },
    assignedToAgentName: { type: String, default: "" },
    dueDate: { type: Date, required: true },
    note: { type: String, default: "" },
    status: { type: String, enum: ["new", "acknowledged", "completed", "disputed"], default: "new", index: true },
    disputeReason: { type: String, default: "" },
    acknowledgedAt: { type: Date },
    completedAt: { type: Date },
    disputedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const CoachingItem = mongoose.model("CoachingItem", CoachingItemSchema);
