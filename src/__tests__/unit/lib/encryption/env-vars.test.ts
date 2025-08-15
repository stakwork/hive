import { describe, it, expect } from "vitest";
import {
  encryptEnvVars,
  decryptEnvVars,
  isEncrypted,
  EncryptionService,
} from "@/lib/encryption";

describe("env var helpers", () => {
  it("encrypts and decrypts arrays of env vars", () => {
    const vars = [
      { name: "A", value: "1" },
      { name: "B", value: "two" },
    ];
    const enc = encryptEnvVars(vars);
    expect(enc).toHaveLength(2);
    for (const v of enc) {
      expect(isEncrypted(v.value)).toBe(true);
    }

    const dec = decryptEnvVars(enc);
    expect(dec).toEqual(vars);
  });

  it("new encryptions carry version and keyId", () => {
    const vs = encryptEnvVars([{ name: "K", value: "V" }]);
    const one = vs[0].value;
    const encSvc = EncryptionService.getInstance();
    expect(one.version).toBe("1");
    expect(one.keyId).toBe(encSvc.getActiveKeyId() || "default");
  });
});
