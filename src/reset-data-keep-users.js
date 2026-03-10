import "dotenv/config";
import mongoose from "mongoose";
import { User } from "./models/User.js";
import { Client } from "./models/Client.js";
import { Interaction } from "./models/Interaction.js";
import { Alert } from "./models/Alert.js";
import { CoachingItem } from "./models/CoachingItem.js";
import { Dispute } from "./models/Dispute.js";
import { AuditLog } from "./models/AuditLog.js";
import { CallCenter } from "./models/CallCenter.js";

async function ensureClientRecords() {
  const users = await User.find({}, { clientId: 1, email: 1 }).lean();
  const clientIds = [...new Set(users.map((u) => String(u.clientId || "default_client")).filter(Boolean))];

  for (const clientId of clientIds) {
    await Client.updateOne(
      { clientId },
      {
        $setOnInsert: {
          clientId,
          name: clientId === "default_client" ? "Default Client" : clientId,
          active: true,
          createdByEmail: "reset-data-keep-users-script",
        },
      },
      { upsert: true }
    );
  }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/omnichannel_mvp");

  const [userCountBefore] = await Promise.all([
    User.countDocuments({}),
    Client.deleteMany({}),
    Interaction.deleteMany({}),
    Alert.deleteMany({}),
    CoachingItem.deleteMany({}),
    Dispute.deleteMany({}),
    AuditLog.deleteMany({}),
    CallCenter.deleteMany({}),
  ]);

  await ensureClientRecords();

  const clientCountAfter = await Client.countDocuments({});

  console.log(`Users preserved: ${userCountBefore}`);
  console.log(`Clients restored: ${clientCountAfter}`);
  console.log("Deleted collections: clients, interactions, alerts, coaching items, disputes, audit logs, call centers");
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
