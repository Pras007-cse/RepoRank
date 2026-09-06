import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

describe("src/lib/crypto.ts", () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it("successfully encrypts and decrypts a sensitive plaintext string", () => {
    const secret = "gho_test_github_access_token_1234567890abcdef";
    const encrypted = encryptSecret(secret);

    expect(encrypted).not.toEqual(secret);
    expect(encrypted.split(":")).toHaveLength(3);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toEqual(secret);
  });

  it("generates a distinct IV and ciphertext for identical plaintexts", () => {
    const secret = "gho_identical_token";
    const enc1 = encryptSecret(secret);
    const enc2 = encryptSecret(secret);

    expect(enc1).not.toEqual(enc2);
    expect(decryptSecret(enc1)).toEqual(secret);
    expect(decryptSecret(enc2)).toEqual(secret);
  });

  it("throws an error when decrypting a malformed payload missing colon delimiters", () => {
    expect(() => decryptSecret("invalid_payload")).toThrow("Malformed encrypted payload");
    expect(() => decryptSecret("part1:part2")).toThrow("Malformed encrypted payload");
  });

  it("throws an authentication error when the ciphertext is tampered with", () => {
    const secret = "gho_tamper_test";
    const encrypted = encryptSecret(secret);
    const [iv, tag, data] = encrypted.split(":");

    // Modify the ciphertext data
    const tamperedData = Buffer.from(data, "base64");
    tamperedData[0] ^= 0xff;
    const tamperedPayload = `${iv}:${tag}:${tamperedData.toString("base64")}`;

    expect(() => decryptSecret(tamperedPayload)).toThrow();
  });

  it("throws an authentication error when the auth tag is tampered with", () => {
    const secret = "gho_auth_tag_test";
    const encrypted = encryptSecret(secret);
    const [iv, tag, data] = encrypted.split(":");

    const tamperedTag = Buffer.from(tag, "base64");
    tamperedTag[0] ^= 0xff;
    const tamperedPayload = `${iv}:${tamperedTag.toString("base64")}:${data}`;

    expect(() => decryptSecret(tamperedPayload)).toThrow();
  });

  it("throws when TOKEN_ENCRYPTION_KEY is unset", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptSecret("sample")).toThrow("TOKEN_ENCRYPTION_KEY is not set");
  });

  it("throws when TOKEN_ENCRYPTION_KEY does not decode to 32 bytes", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("short-key").toString("base64");
    expect(() => encryptSecret("sample")).toThrow("must decode to exactly 32 bytes");
  });
});
