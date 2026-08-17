import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashPassword,
  SESSION_TTL,
  verifyPassword,
  verifySessionToken,
} from "./security.js";

describe("security", () => {
  it("hashes and verifies a password with scrypt", async () => {
    const hash = await hashPassword("a-long-random-test-password");

    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(
      verifyPassword("a-long-random-test-password", hash),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects malformed password hashes", async () => {
    await expect(verifyPassword("anything", "not-a-scrypt-hash")).resolves.toBe(
      false,
    );
  });

  it("accepts an intact session until its 12 hour expiry", () => {
    const now = Date.UTC(2026, 7, 15, 0, 0, 0);
    const secret = "test-session-secret-that-is-long-enough";
    const token = createSessionToken(secret, now);

    expect(
      verifySessionToken(token, secret, now + SESSION_TTL * 1_000 - 1),
    ).toBe(true);
    expect(verifySessionToken(token, secret, now + SESSION_TTL * 1_000)).toBe(
      false,
    );
    expect(verifySessionToken(`${token}x`, secret, now)).toBe(false);
    expect(verifySessionToken(token, `${secret}x`, now)).toBe(false);
  });
});
