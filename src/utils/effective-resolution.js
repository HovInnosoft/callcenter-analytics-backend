function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function inferEffectiveSummary(ai = {}, crm = {}) {
  const summary = ai?.summary || {};
  const originalStatus = summary.status || "unresolved";
  const transcript = String(ai?.transcriptMasked || "").toLowerCase();
  const customerRequest = String(summary.customerRequest || "").toLowerCase();
  const actionsTaken = String(summary.actionsTaken || "").toLowerCase();
  const nextBestAction = String(summary.nextBestAction || "").toLowerCase();
  const topic = String(ai?.topicClusterTitle || "").toLowerCase();
  const disposition = String(crm?.disposition || "").toLowerCase();

  const alreadyResolved =
    originalStatus === "resolved" ||
    disposition.includes("resolved") ||
    disposition.includes("positive") ||
    disposition.includes("satisfied");
  if (alreadyResolved) {
    return {
      ...summary,
      status: "resolved",
      nextBestAction: summary.nextBestAction || "No further action required",
    };
  }

  const customerConfirmedResolution = includesAny(transcript, [
    /\bthat makes more sense\b/,
    /\bi understand now\b/,
    /\bokay[, ]+that (helps|makes sense)\b/,
    /\bthat is fine[, ]+thank you\b/,
    /\bthanks[, ]+that helps\b/,
    /\bgot it\b/,
    /\bunderstood\b/,
    /հիմա արդեն ավելի հասկանալի է/,
    /լավ[, ]+հասկանալի է/,
    /շնորհակալություն[, ]+դա բավարար է/,
  ]);

  const clarificationCase =
    topic.includes("clarification") ||
    topic.includes("question") ||
    topic.includes("information request") ||
    customerRequest.includes("understand a charge") ||
    customerRequest.includes("question about");

  const hardFollowUpSignal = includesAny(`${nextBestAction} ${actionsTaken} ${transcript}`, [
    /\bcall back\b/,
    /\bescalat/,
    /\bspecialist team\b/,
    /\bsend the details\b/,
    /\bcase open\b/,
  ]);

  const softFollowUpSignal = includesAny(`${nextBestAction} ${actionsTaken}`, [
    /\bsupervisor review\b/,
    /\bfollow[- ]?up\b/,
    /\bwithin 24 hours\b/,
  ]);

  const operatorExplained = includesAny(actionsTaken, [
    /\bexplained\b/,
    /\bclarified\b/,
    /\bconfirmed no issue\b/,
    /\bprovided the requested information\b/,
    /\bshared the latest eta\b/,
  ]);

  const hasDeliveredAnswer = !!ai?.qaMilestones?.solutionGiven || operatorExplained;

  const canAutoResolveClarification =
    customerConfirmedResolution &&
    hasDeliveredAnswer &&
    clarificationCase &&
    !hardFollowUpSignal;

  if ((originalStatus === "follow_up" || originalStatus === "unresolved") && (canAutoResolveClarification || (!softFollowUpSignal && !hardFollowUpSignal && customerConfirmedResolution && hasDeliveredAnswer))) {
    return {
      ...summary,
      status: "resolved",
      nextBestAction: "No further action required",
    };
  }

  return summary;
}
