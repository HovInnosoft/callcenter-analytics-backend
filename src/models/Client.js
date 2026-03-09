import mongoose from "mongoose";

const ClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    createdByEmail: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Client = mongoose.model("Client", ClientSchema);

