import { scanOwnerMailInbox } from "./nyra-owner-mail-inbox.ts";

function parseIntervalMs(): number {
  const raw = process.env.NYRA_OWNER_MAIL_INBOX_INTERVAL_MS ?? "30000";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 10000) return 30000;
  return Math.round(parsed);
}

async function tick(): Promise<void> {
  const result = await scanOwnerMailInbox({ autoReply: true, limit: 10 });
  if (result.new_messages > 0) {
    console.log(JSON.stringify({
      event: "nyra_owner_mail_inbox_tick",
      scanned: result.scanned,
      new_messages: result.new_messages,
      auto_replies_queued: result.auto_replies_queued,
      at: new Date().toISOString(),
    }));
  }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({
    event: "nyra_owner_mail_inbox_worker_started",
    auto_reply: true,
    at: new Date().toISOString(),
  }));

  await tick();
  if (process.argv.includes("--once")) return;

  setInterval(() => {
    tick().catch((error) => {
      console.error(JSON.stringify({
        event: "nyra_owner_mail_inbox_worker_error",
        message: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      }));
    });
  }, parseIntervalMs());
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "nyra_owner_mail_inbox_worker_fatal",
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  }));
  process.exitCode = 1;
});

