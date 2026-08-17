import { isIP } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const defaultEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));
dotenv.config({ path: defaultEnvPath, quiet: true });

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  REMOTE_PASSWORD_HASH: z.string().min(20),
  SESSION_SECRET: z.string().min(32),
  BIND_HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ALLOWED_ORIGINS: z
    .string()
    .default("http://127.0.0.1:5173,http://127.0.0.1:8787"),
  WORKSPACE_ROOT: z.string().default("/home/epean/code"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  CODEX_BIN: z.string().default("/home/epean/.local/bin/codex"),
  ZEROTIER_ADDRESS: z.string().optional(),
  WEB_DIST: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  passwordHash: string;
  sessionSecret: string;
  bindHost: string;
  port: number;
  allowedOrigins: Set<string>;
  workspaceRoot: string;
  cookieSecure: boolean;
  codexBin: string;
  zeroTierAddress?: string;
  webDist?: string;
}

type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

export function assertSafeProductionBind(
  bindHost: string,
  zeroTierAddress: string | undefined,
  interfaces: InterfaceMap = networkInterfaces(),
): void {
  if (bindHost === "127.0.0.1" || bindHost === "::1") {
    return;
  }
  if (!isIP(bindHost) || bindHost === "0.0.0.0" || bindHost === "::") {
    throw new Error(
      "Production BIND_HOST must be a specific loopback or ZeroTier IP address.",
    );
  }
  if (!zeroTierAddress || bindHost !== zeroTierAddress) {
    throw new Error(
      "Production BIND_HOST must exactly match ZEROTIER_ADDRESS.",
    );
  }

  const assignedAddresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.address);
  if (!assignedAddresses.includes(zeroTierAddress)) {
    throw new Error(
      "ZEROTIER_ADDRESS is not assigned to a local network interface.",
    );
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(env);
  if (parsed.NODE_ENV === "production") {
    assertSafeProductionBind(parsed.BIND_HOST, parsed.ZEROTIER_ADDRESS);
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    passwordHash: parsed.REMOTE_PASSWORD_HASH,
    sessionSecret: parsed.SESSION_SECRET,
    bindHost: parsed.BIND_HOST,
    port: parsed.PORT,
    allowedOrigins: new Set(
      parsed.ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    workspaceRoot: parsed.WORKSPACE_ROOT,
    cookieSecure: parsed.COOKIE_SECURE === "true",
    codexBin: parsed.CODEX_BIN,
    zeroTierAddress: parsed.ZEROTIER_ADDRESS,
    webDist: parsed.WEB_DIST,
  };
}
