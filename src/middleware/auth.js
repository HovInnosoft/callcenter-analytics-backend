import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { sub, role, email, name, team }
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid/expired token" });
  }
}

export function requireRole(roles = []) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role === "superadmin") return next();
    if (roles.length === 0 || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: "Forbidden" });
  };
}

export function scopedClientId(req) {
  return req.user?.clientId || "default_client";
}

export function applyClientScope(req, filter = {}, field = "clientId") {
  if (req.user?.role === "superadmin") return { ...filter };
  return { ...filter, [field]: scopedClientId(req) };
}
