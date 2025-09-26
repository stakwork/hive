import "./global";
import { beforeAll, afterAll, beforeEach } from "vitest";
import { resetDbMock } from "../mocks/prisma";

beforeAll(() => {
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    process.env.TOKEN_ENCRYPTION_KEY =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  }

  if (!process.env.TOKEN_ENCRYPTION_KEY_ID) {
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
  }
});

beforeEach(() => {
  resetDbMock();
});

afterAll(() => {
  // Unit test suites can add teardown logic here if necessary.
});
