import crypto from "crypto";
import { CallCenter } from "../models/CallCenter.js";

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(String(apiKey)).digest("hex");
}

function parseBearerToken(header) {
  if (!header || !header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

export async function requireExternalAuth(req, res, next) {
  const headerToken = parseBearerToken(req.headers.authorization || "");
  const apiKey = (headerToken || req.headers["x-api-key"] || "").toString().trim();

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const callCenter = await CallCenter.findOne({
    apiKeyHash: hashApiKey(apiKey),
    active: true,
  }).lean();

  if (!callCenter) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  req.externalCallCenter = {
    id: callCenter.callCenterId,
    name: callCenter.name,
    sipLogin: callCenter.sipLogin,
  };
  return next();
}

