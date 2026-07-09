// ============================================================
// Hand-written TS mirror of the Postgres schema in
// lib/db/migrations/0001_init.sql.
//
// Keep this in sync with the migration. If we ever outgrow
// hand-maintenance we can swap to `supabase gen types typescript`
// emitted into types.gen.ts and re-export from here.
// ============================================================

// ---------- Enums (string literal unions) ----------

export type RelocationTolerance = "nope" | "regional" | "anywhere";

export type RelocationAssistance = "provided" | "not_provided";

export type ConfidenceTier = "high" | "medium" | "low";

export type RoleSource = "paste_url" | "scrape_simplify" | "manual" | "capture";

export type TriageState = "draft" | "inbox" | "active" | "snoozed" | "skipped";

/** Frozen LLM-extraction snapshot stored on a role at creation time. */
export interface ExtractionSnapshot {
  values: Record<string, unknown>;
  confidences: Record<string, ConfidenceTier>;
}

export type ApplicationStatus =
  | "saved"
  | "applied"
  | "oa"
  | "phone"
  | "technical"
  | "final"
  | "offer"
  | "reject"
  | "ghosted";

// Added in migration 0002

export type TargetSeason = "summer" | "fall" | "winter" | "spring";

export type WorkModel = "remote" | "hybrid" | "onsite";

export type InterviewType =
  | "phone_screen"
  | "technical"
  | "behavioral"
  | "system_design"
  | "onsite"
  | "final"
  | "other";


// ---------- Row types ----------

export interface Profile {
  user_id: string;
  school: string | null;
  grad_year: number | null;
  home_address: string | null;
  home_lat: number | null;
  home_lng: number | null;
  local_radius_miles: number;
  relocation_tolerance: RelocationTolerance;
  interest_tags: string[];
  // Added in migration 0014 — raw 0..100 slider positions, normalized at
  // compute time in lib/scoring/fit.ts. Defaults 50/30/20 mirror the
  // previous hardcoded FIT_WEIGHTS.
  fit_weight_class_year: number;
  fit_weight_distance: number;
  fit_weight_interest: number;
  // Added in migration 0016 — raw 0..100 sliders that weight the combined
  // score = combined_weight_fit × fit + combined_weight_resume × resume_fit.
  // Normalized at read time (lib/scoring/combined.ts). Default 50/50.
  combined_weight_fit: number;
  combined_weight_resume: number;
  created_at: string;
  updated_at: string;
  onboarding_completed_at: string | null;
}

export interface Company {
  id: string;
  name: string;
  normalized_name: string;
  industry_tags: string[];
  hq_city: string | null;
  hq_lat: number | null;
  hq_lng: number | null;
  created_at: string;
}

export interface RoleLocation {
  text: string;
  lat: number | null;
  lng: number | null;
}

export interface Role {
  id: string;
  company_id: string;
  title: string;
  locations: RoleLocation[];
  jd_url: string | null;
  jd_body_text: string | null;
  jd_snapshot_at: string | null;
  deadline_at: string | null;
  posted_at: string | null;
  /** Earliest graduation year still eligible (e.g. "Dec 2027 or later" → 2027). Null = no lower bound. */
  min_grad_year: number | null;
  /** Latest graduation year still eligible (e.g. "rising junior+" for SS27 → 2029). Null = no upper bound. */
  max_grad_year: number | null;
  relocation_assistance: RelocationAssistance | null;
  /** Per-field confidence tier emitted by the LLM extractor. Missing keys = no signal / manually edited. */
  extraction_confidences: Record<string, ConfidenceTier>;
  /** Frozen original LLM extraction (values + confidences) for per-field revert. Empty `{}` for manually-entered roles. */
  extraction_snapshot: ExtractionSnapshot;
  source: RoleSource;
  source_external_id: string | null;
  // Added in migration 0002
  target_year: number | null;
  target_season: TargetSeason;
  work_model: WorkModel | null;
  /** Hourly rate in whole dollars (e.g. 50 for $50/hr). Null if unknown or non-numeric comp. */
  compensation_hourly_dollars: number | null;
  // Added in migration 0013
  /** Semantic tags drawn from lib/taxonomy.ts INTEREST_TAGS. LLM emits 1-3 (typical 1-2); used for interest-fit and pipeline filtering. */
  tags: string[];
  created_at: string;
}

export interface ResumeVersion {
  id: string;
  user_id: string;
  label: string;
  storage_path: string;
  file_size_bytes: number | null;
  uploaded_at: string;
  is_master: boolean;
  // Added in migration 0015
  extracted_text: string | null;
  mime_type: string;
}

/** Coarse tier derived from the numeric resume_fit_score, used for badge coloring. */
export type ResumeFitTier = "strong" | "partial" | "weak" | "insufficient";

/**
 * 1-10 grade emitted by the LLM per rubric category. Each level has an
 * explicit anchor description in the SYSTEM_PROMPT (see
 * lib/scoring/resume-fit.ts). The LLM picks a described level, not a raw
 * number — this preserves the categorical-in-disguise property while
 * giving fine-grained resolution (weights are coprime so every integer
 * 20-100 in the composed total is reachable).
 */
export type RubricGrade =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Shape of applications.resume_fit_details JSONB. The LLM emits per-
 * category grades; the numeric total on applications.resume_fit_score is
 * composed deterministically from these (see lib/scoring/resume-fit.ts).
 * Keeping the grades alongside the total means we can retune weights and
 * grade-to-contribution mappings without re-running the LLM.
 *
 * Seniority is deliberately non-monotonic on the mapping side: grades
 * 5-6 = "at the expected level" are the peak, 10 = "over-qualified" is a
 * weaker signal for internships. The rubric anchors make this explicit.
 */
export interface ResumeFitDetails {
  tier: ResumeFitTier;
  /** Grades 1..10. Each anchor described in the LLM prompt. */
  skills_coverage: RubricGrade;
  domain_depth: RubricGrade;
  seniority_fit: RubricGrade;
  impact_evidence: RubricGrade;
  recency_trajectory: RubricGrade;
  practical_exposure: RubricGrade;
  /** Per-category one-sentence note explaining WHY that grade was picked. Short — 1 sentence. */
  skills_coverage_note: string;
  domain_depth_note: string;
  seniority_fit_note: string;
  impact_evidence_note: string;
  recency_trajectory_note: string;
  practical_exposure_note: string;
  matched_skills: string[];
  gaps: string[];
  /** Overall rationale synthesizing the six categories. 1-2 sentences. */
  rationale: string;
  /** The resume_version_id whose extracted_text produced this score. */
  resume_version_id_used: string;
}

export interface Application {
  id: string;
  user_id: string;
  role_id: string;
  resume_version_id: string | null;
  triage_state: TriageState;
  status: ApplicationStatus;
  snoozed_until: string | null;
  notes: string;
  fit_score: number | null;
  // Added in migration 0016 — see lib/scoring/resume-fit.ts.
  resume_fit_score: number | null;
  resume_fit_details: ResumeFitDetails | null;
  resume_fit_scored_at: string | null;
  /** sha256 of (resume_version_id + normalized role tags + normalized jd_body_text). Cache key. */
  resume_fit_input_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatusEvent {
  id: string;
  application_id: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  occurred_at: string;
  note: string | null;
}

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  role_title: string | null;
  company_id: string | null;
  email: string | null;
  linkedin_url: string | null;
  last_contact_at: string | null;
  notes: string;
  created_at: string;
}

export interface ApplicationContact {
  application_id: string;
  contact_id: string;
  attached_at: string;
}

// Added in migration 0002

export interface Interview {
  id: string;
  application_id: string;
  type: InterviewType;
  scheduled_at: string | null;
  duration_minutes: number | null;
  meeting_url: string | null;
  location: string | null;
  interviewer_names: string | null;
  notes: string;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyNote {
  user_id: string;
  company_id: string;
  notes: string;
  created_at: string;
  updated_at: string;
}


// ---------- Helper composite types ----------

/** A role joined with its company, the shape Inbox/Pipeline cards consume. */
export interface RoleWithCompany extends Role {
  company: Pick<Company, "id" | "name" | "industry_tags">;
}

/** An application joined with its role + company, the shape detail pages consume. */
export interface ApplicationWithRole extends Application {
  role: RoleWithCompany;
}
