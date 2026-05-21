// Shared types for the layered scraper.

import type { TargetSeason, WorkModel } from "@/lib/db/types";

/**
 * A single layer of evidence about a job posting, gathered from one source
 * (board API, JSON-LD, reader-mode, headless browser, etc.). Multiple layers
 * are gathered then merged + passed to the LLM extractor.
 */
export interface EvidenceLayer {
  source:
    | "greenhouse_api"
    | "lever_api"
    | "ashby_api"
    | "workday_api"
    | "jsonld"
    | "direct_fetch"
    | "jina_reader"
    | "cf_browser";
  company: string | null;
  title: string | null;
  location_texts: string[];
  jd_body: string;
  jd_url: string | null;
  posted_at?: string | null;
  deadline_at?: string | null;
  work_model?: WorkModel;
  target_year?: number | null;
  target_season?: TargetSeason;
  compensation_text?: string | null;
  /** Raw data from the source for debugging / future use. */
  raw?: Record<string, unknown>;
}
