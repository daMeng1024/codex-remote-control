import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SCRYPT_KEY_LENGTH = 64;

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

interface SessionPayload {
  exp: number;
  nonce: string;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt$16384$8$1$${encode(salt)}$${encode(derived)}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, n, r, p, saltValue, expectedValue] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !n ||
    !r ||
    !p ||
    !saltValue ||
    !expectedValue
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(expectedValue, "base64url");
    const actual = await scrypt(
      password,
      Buffer.from(saltValue, "base64url"),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const payload: SessionPayload = {
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!token) {
    return false;
  }
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return false;
  }

  const expectedSignature = sign(body, secret);
  const expected = Buffer.from(expectedSignature);
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as SessionPayload;
    return (
      Number.isInteger(payload.exp) && payload.exp > Math.floor(now / 1000)
    );
  } catch {
    return false;
  }
}

export const SESSION_COOKIE_NAME = "codex_remote_session";
export const SESSION_TTL = SESSION_TTL_SECONDS;
