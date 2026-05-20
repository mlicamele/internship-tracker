// Role data-access stubs. Implementations land in Phase 2 Track 2-B (manual)
// and Phase 4 Track 4-C (paste-URL) / Phase 5 Track 5-B (scraper).

import type { ClassYearTag, Role, RoleSource } from "./types";

const NOT_IMPLEMENTED = "Not implemented yet — see Phase 2 Track 2-B in the build plan.";

export interface CreateRoleInput {
  companyId: string;
  title: string;
  locationText?: string;
  jdUrl?: string;
  jdBodyText?: string;
  deadlineAt?: string;
  postedAt?: string;
  classYearTag?: ClassYearTag;
  classYearConfidence?: number;
  source: RoleSource;
  sourceExternalId?: string;
}

export async function create(_input: CreateRoleInput): Promise<Role> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function getById(_roleId: string): Promise<Role | null> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Upsert by (source, source_external_id). Used by the scraper. */
export async function upsertBySourceId(
  _input: CreateRoleInput
): Promise<Role> {
  throw new Error(NOT_IMPLEMENTED);
}
