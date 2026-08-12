// @vitest-environment node
//
// resetToInboxAction is a Next.js server action — jsdom isn't relevant, and
// the node env keeps the mock surface small. We stub the DB + Supabase + Next
// framework helpers, then assert setTriageState is called with the "inbox"
// state and a null snooze timestamp (the entire behavior worth verifying —
// the revalidatePath calls and the resume-fit rescore are best-effort).
//
// vi.mock() is hoisted above the imports, so shared mock instances live in a
// vi.hoisted() block or they'd be undefined when the factory runs.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setTriageStateMock: vi.fn(async () => {}),
  scoreAndPersistResumeFitMock: vi.fn(async () => {}),
  getByIdMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePathMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
  })),
}));
vi.mock("@/lib/db/applications", () => ({
  getById: mocks.getByIdMock,
  setTriageState: mocks.setTriageStateMock,
}));
vi.mock("@/lib/db/resume-fit", () => ({
  scoreAndPersistResumeFit: mocks.scoreAndPersistResumeFitMock,
  rescoreInboxAgainstResume: vi.fn(async () => {}),
}));

import { resetToInboxAction } from "./actions";

beforeEach(() => {
  mocks.setTriageStateMock.mockClear();
  mocks.setTriageStateMock.mockResolvedValue(undefined);
  mocks.scoreAndPersistResumeFitMock.mockClear();
  mocks.scoreAndPersistResumeFitMock.mockResolvedValue(undefined);
  mocks.revalidatePathMock.mockClear();
  mocks.getByIdMock.mockReset();
});

describe("resetToInboxAction", () => {
  it("flips triage_state back to 'inbox' with a null snooze timestamp", async () => {
    mocks.getByIdMock.mockResolvedValue({ id: "app-1", user_id: "user-1" });
    await resetToInboxAction("app-1");
    expect(mocks.setTriageStateMock).toHaveBeenCalledWith(
      expect.anything(),
      "app-1",
      "inbox",
      null
    );
  });

  it("triggers a resume-fit rescore after the state flip", async () => {
    mocks.getByIdMock.mockResolvedValue({ id: "app-1", user_id: "user-1" });
    await resetToInboxAction("app-1");
    expect(mocks.scoreAndPersistResumeFitMock).toHaveBeenCalledWith(
      expect.anything(),
      "app-1"
    );
  });

  it("revalidates the inbox / pipeline / archive routes so lists refresh", async () => {
    mocks.getByIdMock.mockResolvedValue({ id: "app-1", user_id: "user-1" });
    await resetToInboxAction("app-1");
    const paths = mocks.revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/inbox");
    expect(paths).toContain("/pipeline");
    expect(paths).toContain("/archive");
  });

  it("404s when the application belongs to a different user", async () => {
    mocks.getByIdMock.mockResolvedValue({ id: "app-1", user_id: "other-user" });
    await expect(resetToInboxAction("app-1")).rejects.toThrow(/notFound/);
    expect(mocks.setTriageStateMock).not.toHaveBeenCalled();
  });

  it("404s when the application doesn't exist", async () => {
    mocks.getByIdMock.mockResolvedValue(null);
    await expect(resetToInboxAction("missing")).rejects.toThrow(/notFound/);
    expect(mocks.setTriageStateMock).not.toHaveBeenCalled();
  });

  it("survives a resume-fit rescore failure (best-effort)", async () => {
    mocks.getByIdMock.mockResolvedValue({ id: "app-1", user_id: "user-1" });
    mocks.scoreAndPersistResumeFitMock.mockRejectedValueOnce(new Error("boom"));
    await expect(resetToInboxAction("app-1")).resolves.toBeUndefined();
    expect(mocks.setTriageStateMock).toHaveBeenCalled();
  });
});
