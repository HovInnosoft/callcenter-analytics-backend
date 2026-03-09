import mongoose from "mongoose";

const CallCenterSchema = new mongoose.Schema(
  {
    callCenterId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
    createdByEmail: { type: String, default: "" },
  },
  { timestamps: true }
);

export const CallCenter = mongoose.model("CallCenter", CallCenterSchema);

