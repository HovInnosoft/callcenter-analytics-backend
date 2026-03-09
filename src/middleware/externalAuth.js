import crypto from "crypto";

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ""));
  const bBuf = Buffer.from(String(b || ""));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const encoded = header.slice(6).trim();
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx === -1) return null;
    return {
      login: decoded.slice(0, idx),
      password: decoded.slice(idx + 1),
    };
  } catch {
    return null;
  }
}

export function requireExternalAuth(req, res, next) {
  const expectedLogin = process.env.SIP_LOGIN || "";
  const expectedPassword = process.env.SIP_PASSWORD || "";

  if (!expectedLogin || !expectedPassword) {
    return res.status(500).json({ error: "External API auth is not configured" });
  }

  const basic = parseBasicAuth(req.headers.authorization || "");
  const login = basic?.login || req.headers["x-sip-login"] || "";
  const password = basic?.password || req.headers["x-sip-password"] || "";

  if (safeEqual(login, expectedLogin) && safeEqual(password, expectedPassword)) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="external-audio-api"');
  return res.status(401).json({ error: "Invalid SIP credentials" });
}

