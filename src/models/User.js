import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["superadmin", "admin", "executive", "supervisor", "qa", "agent"],
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    team: { type: String, default: "General" },
    clientId: { type: String, default: "default_client", index: true },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", UserSchema);
