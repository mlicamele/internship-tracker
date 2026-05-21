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

export type RoleSource = "paste_url" | "scrape_simplify" | "manual";

export type TriageState = "inbox" | "active" | "snoozed" | "skipped";

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
  source: RoleSource;
  source_external_id: string | null;
  // Added in migration 0002
  target_year: number | null;
  target_season: TargetSeason;
  work_model: WorkModel | null;
  /** Hourly rate in whole dollars (e.g. 50 for $50/hr). Null if unknown or non-numeric comp. */
  compensation_hourly_dollars: number | null;
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
