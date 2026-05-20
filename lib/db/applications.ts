// Application data-access stubs. Implementations land in Phase 2 Track 2-A.

import type {
  Application,
  ApplicationStatus,
  TriageState,
} from "./types";

const NOT_IMPLEMENTED = "Not implemented yet — see Phase 2 Track 2-A in the build plan.";

export interface CreateApplicationInput {
  userId: string;
  roleId: string;
  triageState?: TriageState;
  fitScore?: number;
}

export async function createApplication(
  _input: CreateApplicationInput
): Promise<Application> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function transitionStatus(
  _applicationId: string,
  _toStatus: ApplicationStatus,
  _note?: string
): Promise<Application> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function updateNotes(
  _applicationId: string,
  _notes: string
): Promise<Application> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function listByTriageState(
  _userId: string,
  _state: TriageState
): Promise<Application[]> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function getById(
  _applicationId: string
): Promise<Application | null> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function softDelete(_applicationId: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function hardDelete(_applicationId: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Recompute and persist fit_score for all of a user's applications. */
export async function recomputeFitScores(_userId: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}
