import { describe, expect, it } from "vitest";
import { looksLikeNonPlace } from "./geocode";

describe("looksLikeNonPlace", () => {
  describe("rejects team-y strings with no location structure", () => {
    it.each([
      "Ethics Team",
      "Trading Engineering",
      "US Government Solutions",
      "Perception Research",
      "Data Science Group",
      "Firmware Division",
      "Strategy Practice",
      "Product Function",
    ])("%s → reject", (s) => {
      expect(looksLikeNonPlace(s)).toBe(true);
    });
  });

  describe("allows real geographic locations even when they contain team-y words", () => {
    it.each([
      "New York, NY",
      "San Francisco, CA",
      "London, UK",
      "Bengaluru, India",
      "Chicago, IL",
      "Greenwich, CT",
      "Remote", // handled by VIRTUAL_LOCATION_TERMS earlier; this fn should not reject
      "Boston, MA (BOS-01)",
      "Palo Alto, California, United States",
      // Real edge case: a location that literally contains "Research" but has a comma
      "Research Triangle, NC",
      // Real location containing team-y word + state code
      "Naval Operations, CA",
    ])("%s → allow", (s) => {
      expect(looksLikeNonPlace(s)).toBe(false);
    });
  });

  describe("allows bare city names with no team tokens", () => {
    it.each(["Austin", "Denver", "Tokyo", "Berlin"])("%s → allow", (s) => {
      expect(looksLikeNonPlace(s)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("case-insensitive: TEAM in caps still rejects", () => {
      expect(looksLikeNonPlace("Ethics TEAM")).toBe(true);
    });

    it("word-boundary: does not reject 'unity' just because it contains 'unit'", () => {
      // NON_PLACE_TOKENS uses " unit" (leading space) so "Unity" won't match.
      expect(looksLikeNonPlace("Unity, Maine")).toBe(false);
    });

    it("empty / whitespace → not flagged as non-place (caller handles empty separately)", () => {
      expect(looksLikeNonPlace("")).toBe(false);
      expect(looksLikeNonPlace("   ")).toBe(false);
    });
  });
});
