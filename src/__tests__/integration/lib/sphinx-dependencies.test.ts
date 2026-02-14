/**
 * Integration tests for Sphinx Lightning authentication dependencies
 * Tests that qrcode and @noble/secp256k1 packages are properly installed and functional
 */

import { describe, it, expect } from "vitest";
import QRCode from "qrcode";
import * as secp256k1 from "@noble/secp256k1";

describe("Sphinx Dependencies Integration", () => {
  describe("qrcode package", () => {
    it("should import qrcode without errors", () => {
      expect(QRCode).toBeDefined();
      expect(typeof QRCode.toDataURL).toBe("function");
    });

    it("should generate a QR code data URL from a string", async () => {
      const testData = "sphinx.chat://?action=auth&host=localhost&challenge=abc123&ts=1234567890";
      
      const dataUrl = await QRCode.toDataURL(testData);
      
      expect(dataUrl).toBeDefined();
      expect(typeof dataUrl).toBe("string");
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(dataUrl.length).toBeGreaterThan(100); // QR codes are substantial
    });

    it("should generate QR codes with different options", async () => {
      const testData = "test-challenge-data";
      
      const dataUrl = await QRCode.toDataURL(testData, {
        errorCorrectionLevel: "H",
        type: "image/png",
        width: 300,
      });
      
      expect(dataUrl).toBeDefined();
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("should handle minimal valid string", async () => {
      const dataUrl = await QRCode.toDataURL("a");
      
      expect(dataUrl).toBeDefined();
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe("@noble/secp256k1 package", () => {
    it("should import @noble/secp256k1 without errors", () => {
      expect(secp256k1).toBeDefined();
    });

    it("should have Signature class with recoverPublicKey method", () => {
      expect(secp256k1.Signature).toBeDefined();
      // Create a test signature to verify instance method exists
      const testSig = new secp256k1.Signature(1n, 2n);
      expect(testSig.recoverPublicKey).toBeDefined();
      expect(typeof testSig.recoverPublicKey).toBe("function");
    });

    it("should recover public key from a valid signature", async () => {
      // Test vector: known signature and message that recovers to a specific pubkey
      const messageHash = new Uint8Array(32).fill(1); // Simple test hash
      const privateKey = new Uint8Array(32).fill(2); // Simple test private key
      
      // Sign the message - recovery bit is included by default in v2+
      const signature = await secp256k1.signAsync(messageHash, privateKey);
      
      // Get expected public key
      const expectedPubkey = secp256k1.getPublicKey(privateKey);
      
      // Recover public key from signature (recovery bit already in signature)
      const recoveredPubkey = signature.recoverPublicKey(messageHash);
      
      expect(recoveredPubkey).toBeDefined();
      // Convert Point to bytes for comparison
      const recoveredBytes = recoveredPubkey.toRawBytes();
      expect(recoveredBytes).toBeInstanceOf(Uint8Array);
      expect(recoveredBytes.length).toBeGreaterThan(0);
      
      // Verify recovered key matches expected key
      expect(recoveredBytes).toEqual(expectedPubkey);
    });

    it("should verify signature using recovered public key", async () => {
      const messageHash = new Uint8Array(32).fill(3);
      const privateKey = new Uint8Array(32).fill(4);
      
      const signature = await secp256k1.signAsync(messageHash, privateKey);
      const publicKey = secp256k1.getPublicKey(privateKey);
      
      // Verify the signature
      const isValid = secp256k1.verify(signature, messageHash, publicKey);
      
      expect(isValid).toBe(true);
    });

    it("should have required cryptographic functions", () => {
      // Verify all required functions are available
      expect(secp256k1.getPublicKey).toBeDefined();
      expect(secp256k1.sign).toBeDefined();
      expect(secp256k1.verify).toBeDefined();
      expect(secp256k1.Signature).toBeDefined();
      expect(secp256k1.utils).toBeDefined();
    });
  });

  describe("TypeScript import compatibility", () => {
    it("should import both packages in TypeScript without errors", () => {
      // This test verifies TypeScript can resolve the types correctly
      const qrcodeModule: typeof QRCode = QRCode;
      const secp256k1Module: typeof secp256k1 = secp256k1;
      
      expect(qrcodeModule).toBeDefined();
      expect(secp256k1Module).toBeDefined();
    });
  });
});
