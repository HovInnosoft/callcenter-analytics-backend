import mongoose from "mongoose";

const CallCenterSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true, default: "default_client" },
    callCenterId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    sipLogin: { type: String, required: true, unique: true, index: true },
    sipPasswordHash: { type: String, required: true },
    apiKeyHash: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: true, index: true },
    createdByEmail: { type: String, default: "" },
  },
  { timestamps: true }
);

export const CallCenter = mongoose.model("CallCenter", CallCenterSchema);
