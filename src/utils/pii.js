/**
 * Very small MVP PII masking.
 * Replace phone numbers and email-like strings. Extend via config in Phase 2.
 */
export function maskPII(text = "") {
  let t = String(text);
  // emails
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]");
  // phone-ish sequences
  t = t.replace(/\+?\d[\d\s\-()]{7,}\d/g, "[PHONE]");
  // card-like 13-19 digits
  t = t.replace(/\b\d{13,19}\b/g, "[NUMBER]");
  return t;
}
