import Redis from "ioredis";
import { createWriteStream } from "fs";

const redisUrl   = process.env.REDIS_URL ?? "redis://localhost:6379";
const pattern    = process.env.REDIS_PATTERN ?? "ggbot:*";
const outPath    = process.env.LOG_FILE; // si unset: stdout only
const redis = new Redis(redisUrl);
const file  = outPath ? createWriteStream(outPath, { flags: "a" }) : null;

redis.psubscribe(pattern, (err) => {
  if (err) { console.error("PSUBSCRIBE error:", err); process.exit(1); }
  console.log(`[log-drain] listening "${pattern}" on ${redisUrl}`);
});

redis.on("pmessage", (_p, channel, message) => {
  const line = JSON.stringify({ ts: Date.now(), channel, msg: safeParse(message) }) + "\n";
  if (file) file.write(line);
  process.stdout.write(line);
});

function safeParse(s: string) { try { return JSON.parse(s); } catch { return s; } }
