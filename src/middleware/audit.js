import { AuditLog } from "../models/AuditLog.js";

export function audit(action, entityType, entityIdFn = () => "") {
  return async (req, res, next) => {
    res.on("finish", async () => {
      try {
        if (res.statusCode >= 400) return;
        const entityId = typeof entityIdFn === "function" ? entityIdFn(req, res) : "";
        await AuditLog.create({
          actorUserId: req.user?.sub,
          actorEmail: req.user?.email || "",
          action,
          entityType,
          entityId,
          meta: {
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
          },
          ip: req.ip,
          userAgent: req.headers["user-agent"] || "",
        });
      } catch {
        // best-effort logging
      }
    });
    next();
  };
}
