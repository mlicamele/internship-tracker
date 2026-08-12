// Smoke tests for InboxViewSwitcher: the tab toggle, localStorage persistence,
// and the cross-tab storage-event subscription that keeps two tabs in sync.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Child components pull in Supabase / server-only code transitively via the
// pipeline row column types. Stub them to isolate the tab logic.
vi.mock("./inbox-list", () => ({
  InboxList: () => <div data-testid="list-view" />,
}));
vi.mock("./triage-deck", () => ({
  TriageDeck: () => <div data-testid="cards-view" />,
}));

import { InboxViewSwitcher } from "./inbox-view-switcher";

beforeEach(() => {
  window.localStorage.clear();
});

describe("InboxViewSwitcher", () => {
  it("defaults to the list view when localStorage is empty", () => {
    render(<InboxViewSwitcher rows={[]} interestTags={[]} />);
    expect(screen.getByTestId("list-view")).toBeInTheDocument();
    expect(screen.queryByTestId("cards-view")).not.toBeInTheDocument();
  });

  it("switches to the cards view when the Cards tab is clicked", () => {
    render(<InboxViewSwitcher rows={[]} interestTags={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: /cards/i }));
    expect(screen.getByTestId("cards-view")).toBeInTheDocument();
    expect(screen.queryByTestId("list-view")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("inbox_view")).toBe("cards");
  });

  it("restores the persisted view on remount", () => {
    window.localStorage.setItem("inbox_view", "cards");
    render(<InboxViewSwitcher rows={[]} interestTags={[]} />);
    expect(screen.getByTestId("cards-view")).toBeInTheDocument();
  });

  it("syncs when a storage event fires (cross-tab)", () => {
    render(<InboxViewSwitcher rows={[]} interestTags={[]} />);
    expect(screen.getByTestId("list-view")).toBeInTheDocument();

    act(() => {
      window.localStorage.setItem("inbox_view", "cards");
      window.dispatchEvent(new Event("storage"));
    });

    expect(screen.getByTestId("cards-view")).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected", () => {
    render(<InboxViewSwitcher rows={[]} interestTags={[]} />);
    const listTab = screen.getByRole("tab", { name: /list/i });
    const cardsTab = screen.getByRole("tab", { name: /cards/i });
    expect(listTab).toHaveAttribute("aria-selected", "true");
    expect(cardsTab).toHaveAttribute("aria-selected", "false");
    fireEvent.click(cardsTab);
    expect(listTab).toHaveAttribute("aria-selected", "false");
    expect(cardsTab).toHaveAttribute("aria-selected", "true");
  });
});
