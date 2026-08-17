import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
const passwordPath = resolve(root, ".dev-access-password");
const password = randomBytes(32).toString("base64url");
const sessionSecret = randomBytes(48).toString("base64url");
const salt = randomBytes(16);
const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
const passwordHash = [
  "scrypt",
  "16384",
  "8",
  "1",
  salt.toString("base64url"),
  Buffer.from(derived).toString("base64url"),
].join("$");

const env = [
  `REMOTE_PASSWORD_HASH=${passwordHash}`,
  `SESSION_SECRET=${sessionSecret}`,
  "BIND_HOST=127.0.0.1",
  "PORT=8787",
  "ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:8787",
  "WORKSPACE_ROOT=/home/epean/code",
  "COOKIE_SECURE=false",
  "CODEX_BIN=/home/epean/.local/bin/codex",
  "",
].join("\n");

try {
  await writeFile(envPath, env, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await writeFile(passwordPath, `${password}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
} catch (error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EEXIST"
  ) {
    throw new Error(
      "Local environment already exists; refusing to overwrite secrets.",
    );
  }
  throw error;
}

console.log(`Created ${envPath}`);
console.log(`Created ${passwordPath}`);
