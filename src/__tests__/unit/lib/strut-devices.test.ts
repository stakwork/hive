/**
 * The pure parts of strut device pairing (`lib/strut-devices.ts`): the user
 * code a person reads off a device and types back, and the device credential.
 * The flow itself runs against a database in
 * `integration/api/strut-devices.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  generateDeviceCode,
  generateDeviceCredential,
  generateUserCode,
  isDeviceCredential,
  normalizeUserCode,
} from "@/lib/strut-devices";

describe("strut device codes", () => {
  it("a user code is two groups of four consonants", () => {
    for (let i = 0; i < 50; i++) expect(generateUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  });

  it("a typed code is read in any case, with any separator", () => {
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDF-GHJK");
    expect(normalizeUserCode(" BCDFGHJK ")).toBe("BCDF-GHJK");
    expect(normalizeUserCode("bcdf ghjk")).toBe("BCDF-GHJK");
  });

  it("a code it could never have issued is no code", () => {
    expect(normalizeUserCode("BCDF-GHJ")).toBeNull();
    expect(normalizeUserCode("BCDF-GHJKL")).toBeNull();
    expect(normalizeUserCode("ABCD-EFGH")).toBeNull(); // vowels are not in the alphabet
    expect(normalizeUserCode("")).toBeNull();
    expect(normalizeUserCode(null)).toBeNull();
  });

  it("device codes and credentials are unguessable and recognizable", () => {
    expect(generateDeviceCode()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateDeviceCode()).not.toBe(generateDeviceCode());
    const credential = generateDeviceCredential();
    expect(credential).toMatch(/^hivedev_[0-9A-Za-z]{32}$/);
    expect(isDeviceCredential(credential)).toBe(true);
    expect(isDeviceCredential("hive_abcd_x")).toBe(false);
    expect(isDeviceCredential(undefined)).toBe(false);
  });
});
