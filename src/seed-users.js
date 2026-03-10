import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "./models/User.js";
import { Client } from "./models/Client.js";

const defaultClient = {
  clientId: "default_client",
  name: "Default Client",
  active: true,
  createdByEmail: "seed-users-script",
};

const users = [
  { email: "superadmin@example.com", name: "Super Admin", role: "superadmin", team: "Platform", password: "super1234", clientId: "default_client" },
  { email: "admin@example.com", name: "Admin", role: "admin", team: "General", password: "admin1234", clientId: "default_client" },
  { email: "exec@example.com", name: "Executive", role: "executive", team: "General", password: "exec1234", clientId: "default_client" },
  { email: "sup@example.com", name: "Supervisor", role: "supervisor", team: "Team A", password: "sup1234", clientId: "default_client" },
  { email: "qa@example.com", name: "QA Analyst", role: "qa", team: "Team A", password: "qa1234", clientId: "default_client" },
  { email: "agent1@example.com", name: "Agent 1", role: "agent", team: "Team A", password: "agent1234", clientId: "default_client" },
  { email: "agent2@example.com", name: "Agent 2", role: "agent", team: "Team B", password: "agent1234", clientId: "default_client" },
  { email: "agent3@example.com", name: "Agent 3", role: "agent", team: "Team A", password: "agent1234", clientId: "default_client" },
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/omnichannel_mvp");

  await Client.updateOne(
    { clientId: defaultClient.clientId },
    { $setOnInsert: defaultClient },
    { upsert: true }
  );

  let created = 0;
  let existing = 0;

  for (const user of users) {
    const found = await User.findOne({ email: user.email });

    if (found) {
      existing += 1;
      continue;
    }

    const passwordHash = await bcrypt.hash(user.password, 10);

    await User.create({
      email: user.email,
      name: user.name,
      role: user.role,
      team: user.team,
      clientId: user.clientId,
      passwordHash,
    });

    created += 1;
  }

  console.log(`Users created: ${created}`);
  console.log(`Users already present: ${existing}`);
  console.log("Available logins:");
  for (const user of users) {
    console.log(`${user.email} / ${user.password}`);
  }
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
