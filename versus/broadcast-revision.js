import { createHash } from "node:crypto";

// Revision covers only the already-authorized public view, never hidden tactics
// or viewer tokens. A heartbeat countdown alone does not invalidate the screen.
export function withBroadcastRevision(broadcast) {
  const { remainingMs, ...match } = broadcast.match;
  const revision = createHash("sha256").update(JSON.stringify({ ...broadcast, match })).digest("hex");
  return { ...broadcast, revision };
}
