import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true, default: "default_client" },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorEmail: { type: String, default: "" },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: "" },
    meta: { type: Object, default: {} },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model("AuditLog", AuditLogSchema);
