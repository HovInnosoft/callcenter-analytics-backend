import mongoose from "mongoose";

const AlertSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true, default: "default_client" },
    type: { type: String, enum: ["crisis_spike","integrity_mismatch","compliance_fail"], required: true, index: true },
    severity: { type: String, enum: ["medium","high","critical"], default: "high" },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    interactionId: { type: String, default: "" }, // linkable
    clusterId: { type: String, default: "" },
    status: { type: String, enum: ["new","reviewed","resolved"], default: "new", index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    evidence: { type: Object, default: {} },
  },
  { timestamps: true }
);

export const Alert = mongoose.model("Alert", AlertSchema);
