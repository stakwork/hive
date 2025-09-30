import { vi } from "vitest";
import { getServerSession } from "next-auth/next";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

export const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;

export function setupNextAuthMock() {
  return mockGetServerSession;
}