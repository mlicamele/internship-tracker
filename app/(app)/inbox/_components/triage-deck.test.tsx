// Smoke tests for TriageDeck: renders top card, Skip advances, Undo pops,
// empty state, keyboard shortcuts, and the shortcut-ignore-when-typing guard.
//
// Server actions are mocked so no Supabase hit. Framer-motion drag isn't
// exercised — jsdom can't simulate pointer physics; the click + keyboard
// paths cover the state transitions those drags trigger.
//
// Keyboard events go straight to window via fireEvent.keyDown — userEvent's
// timer coordination can deadlock against framer-motion motion values in
// jsdom (observed here empirically; framer's motionValue.stop() waits on
// animation frames that never fire under RTL's fake timer).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { PipelineRow } from "@/app/(app)/pipeline/_components/columns";

const triageActionMock = vi.fn();
const resetToInboxActionMock = vi.fn();

vi.mock("../actions", () => ({
  triageAction: (...args: unknown[]) => triageActionMock(...args),
  resetToInboxAction: (...args: unknown[]) => resetToInboxActionMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { TriageDeck } from "./triage-deck";

function makeRow(id: string, companyName: string, title: string): PipelineRow {
  return {
    id,
    role: {
      id: `r-${id}`,
      title,
      tags: [],
      locations: [],
      work_model: null,
      compensation_hourly_dollars: null,
      relocation_assistance: null,
      min_grad_year: null,
      max_grad_year: null,
      target_year: 2027,
      target_season: "summer",
      deadline_at: null,
      link_status: "unknown",
      link_checked_at: null,
      jd_url: null,
      company: { id: `c-${id}`, name: companyName },
    },
    distance_miles: null,
    fit_details: null,
    combined_total: null,
    combined_used_resume_signal: false,
    resume_fit_score: null,
    resume_fit_details: null,
  } as unknown as PipelineRow;
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  triageActionMock.mockReset();
  triageActionMock.mockResolvedValue(undefined);
  resetToInboxActionMock.mockReset();
  resetToInboxActionMock.mockResolvedValue(undefined);
});

describe("TriageDeck — empty state", () => {
  it("renders 'no eligible roles' when the input array is empty", () => {
    render(<TriageDeck rows={[]} interestTags={[]} />);
    expect(
      screen.getByText(/no eligible roles in the inbox/i)
    ).toBeInTheDocument();
  });
});

describe("TriageDeck — card advance", () => {
  it("shows '1 of N' initially and the top row's company name", () => {
    render(
      <TriageDeck
        rows={[makeRow("1", "Acme", "SWE"), makeRow("2", "Beta", "ML")]}
        interestTags={[]}
      />
    );
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
  });

  it("advances after Skip and calls triageAction with the right id", async () => {
    render(
      <TriageDeck
        rows={[makeRow("1", "Acme", "SWE"), makeRow("2", "Beta", "ML")]}
        interestTags={[]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^skip$/i }));
    await flushPromises();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(triageActionMock).toHaveBeenCalledWith("1", "skip");
  });

  it("calls triageAction 'apply' from the Apply button", async () => {
    render(
      <TriageDeck rows={[makeRow("1", "Acme", "SWE")]} interestTags={[]} />
    );
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    await flushPromises();
    expect(triageActionMock).toHaveBeenCalledWith("1", "apply");
  });

  it("calls triageAction 'snooze' from the Snooze button", async () => {
    render(
      <TriageDeck rows={[makeRow("1", "Acme", "SWE")]} interestTags={[]} />
    );
    fireEvent.click(screen.getByRole("button", { name: /snooze/i }));
    await flushPromises();
    expect(triageActionMock).toHaveBeenCalledWith("1", "snooze");
  });
});

describe("TriageDeck — undo stack", () => {
  it("undo is invisible and disabled until at least one swipe happened", () => {
    render(
      <TriageDeck rows={[makeRow("1", "Acme", "SWE")]} interestTags={[]} />
    );
    const undoBtn = screen.getByRole("button", { name: /^undo/i });
    expect(undoBtn.className).toMatch(/invisible/);
    expect(undoBtn).toBeDisabled();
  });

  it("pops one slot at a time (LIFO)", async () => {
    render(
      <TriageDeck
        rows={[
          makeRow("1", "Acme", "SWE"),
          makeRow("2", "Beta", "ML"),
          makeRow("3", "Gamma", "DS"),
        ]}
        interestTags={[]}
      />
    );
    // Swipe two.
    fireEvent.click(screen.getByRole("button", { name: /^skip$/i }));
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: /^skip$/i }));
    await flushPromises();
    expect(
      screen.getByRole("button", { name: /^undo \(2\)/i })
    ).toBeInTheDocument();

    // Undo once → stack size 1, top reverts to Beta.
    fireEvent.click(screen.getByRole("button", { name: /^undo/i }));
    await flushPromises();
    expect(
      screen.getByRole("button", { name: /^undo \(1\)/i })
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(resetToInboxActionMock).toHaveBeenCalledWith("2");

    // Undo again → stack empty, top reverts to Acme.
    fireEvent.click(screen.getByRole("button", { name: /^undo/i }));
    await flushPromises();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(resetToInboxActionMock).toHaveBeenLastCalledWith("1");
  });
});

describe("TriageDeck — keyboard shortcuts", () => {
  it("j = skip", async () => {
    render(
      <TriageDeck rows={[makeRow("1", "Acme", "SWE")]} interestTags={[]} />
    );
    fireEvent.keyDown(window, { key: "j" });
    await flushPromises();
    expect(triageActionMock).toHaveBeenCalledWith("1", "skip");
  });

  it("k = apply", async () => {
    render(
      <TriageDeck rows={[makeRow("1", "Acme", "SWE")]} interestTags={[]} />
    );
    fireEvent.keyDown(window, { key: "k" });
    await flushPromises();
    expect(triageActionMock).toHaveBeenCalledWith("1", "apply");
  });

  it("u = snooze", async () => {
    render(
      <TriageDeck rows={[makeRow("1", "Acme", "SWE")]} interestTags={[]} />
    );
    fireEvent.keyDown(window, { key: "u" });
    await flushPromises();
    expect(triageActionMock).toHaveBeenCalledWith("1", "snooze");
  });

  it("z = undo (after at least one swipe)", async () => {
    render(
      <TriageDeck
        rows={[makeRow("1", "Acme", "SWE"), makeRow("2", "Beta", "ML")]}
        interestTags={[]}
      />
    );
    fireEvent.keyDown(window, { key: "j" });
    await flushPromises();
    fireEvent.keyDown(window, { key: "z" });
    await flushPromises();
    expect(resetToInboxActionMock).toHaveBeenCalledWith("1");
  });

  it("ignores shortcuts when focus is inside an input", async () => {
    render(
      <div>
        <input data-testid="typing" />
        <TriageDeck rows={[makeRow("1", "Acme", "SWE")]} interestTags={[]} />
      </div>
    );
    const input = screen.getByTestId("typing") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "j" });
    await flushPromises();
    expect(triageActionMock).not.toHaveBeenCalled();
  });

  it("ignores shortcuts when a modifier is held (Cmd+K collision)", async () => {
    render(
      <TriageDeck rows={[makeRow("1", "Acme", "SWE")]} interestTags={[]} />
    );
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await flushPromises();
    expect(triageActionMock).not.toHaveBeenCalled();
  });
});
