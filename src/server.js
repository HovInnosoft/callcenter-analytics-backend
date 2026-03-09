import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";

import authRoutes from "./routes/auth.js";
import interactionRoutes from "./routes/interactions.js";
import alertRoutes from "./routes/alerts.js";
import statsRoutes from "./routes/stats.js";
import integrityRoutes from "./routes/integrity.js";
import auditRoutes from "./routes/auditlogs.js";
import coachingRoutes from "./routes/coaching.js";
import disputeRoutes from "./routes/disputes.js";
import externalRoutes from "./routes/external.js";
import callCenterRoutes from "./routes/callCenters.js";
import superadminRoutes from "./routes/superadmin.js";

const app = express();

const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/omnichannel_mvp";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(
  helmet({
    // Frontend runs on a different origin (:5173) and loads audio from backend (:8080).
    // Allow cross-origin resource loading for static media like /uploads/*.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/+$/, "");
}

const allowedOrigins = CORS_ORIGIN.split(",").map((o) => normalizeOrigin(o)).filter(Boolean);
function isAllowedOrigin(origin) {
  if (allowedOrigins.includes("*")) return true;
  if (allowedOrigins.includes(origin)) return true;
  return allowedOrigins.some((entry) => {
    const starIdx = entry.indexOf("*.");
    if (starIdx === -1) return false;
    const suffix = entry.slice(starIdx + 1); // ".netlify.app"
    return origin.endsWith(suffix);
  });
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      if (isAllowedOrigin(normalizedOrigin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

app.use(`/${UPLOAD_DIR}`, express.static(path.resolve(UPLOAD_DIR)));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/interactions", interactionRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/integrity", integrityRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/coaching", coachingRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/external", externalRoutes);
app.use("/api/call-centers", callCenterRoutes);
app.use("/api/superadmin", superadminRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal error" });
});

async function main() {
  if (!process.env.JWT_SECRET) {
    console.warn("JWT_SECRET missing. Set it in .env");
  }
  await mongoose.connect(MONGO_URI);
  console.log("Mongo connected");
  app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error("Failed to start server", e);
  process.exit(1);
});
