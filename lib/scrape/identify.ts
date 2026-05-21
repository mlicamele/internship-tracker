// Identify which job board hosts a given URL and pull out the
// company/posting identifiers needed for that board's API.

export type BoardKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "linkedin"
  | "unknown";

export interface BoardIdentity {
  kind: BoardKind;
  company: string | null;
  jobId: string | null;
  /** Board-specific extras (e.g. workday needs host + site). */
  extras?: Record<string, string>;
}

export function identifyBoard(url: string): BoardIdentity {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "unknown", company: null, jobId: null };
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  // Greenhouse — multiple URL shapes
  //   https://job-boards.greenhouse.io/anthropic/jobs/4456891
  //   https://boards.greenhouse.io/anthropic/jobs/4456891
  //   https://job-boards.greenhouse.io/embed/job_app?for=anthropic&token=4456891
  if (host.endsWith("greenhouse.io")) {
    const m = path.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (m) return { kind: "greenhouse", company: m[1], jobId: m[2] };
    // Embed pattern
    const company = parsed.searchParams.get("for");
    const token = parsed.searchParams.get("token");
    if (company && token) {
      return { kind: "greenhouse", company, jobId: token };
    }
    // Company-only landing — board exists but no specific job
    const segs = path.split("/").filter(Boolean);
    if (segs.length === 1) return { kind: "greenhouse", company: segs[0], jobId: null };
    return { kind: "greenhouse", company: null, jobId: null };
  }

  // Lever
  //   https://jobs.lever.co/discord/8a1f23c5-2-44ba-...
  //   https://jobs.eu.lever.co/{company}/{id}
  if (host.endsWith("lever.co")) {
    const m = path.match(/^\/([^/]+)\/([^/?]+)/);
    if (m) return { kind: "lever", company: m[1], jobId: m[2] };
    const segs = path.split("/").filter(Boolean);
    if (segs.length === 1) return { kind: "lever", company: segs[0], jobId: null };
    return { kind: "lever", company: null, jobId: null };
  }

  // Ashby
  //   https://jobs.ashbyhq.com/openai/{job-id}
  if (host.endsWith("ashbyhq.com")) {
    const m = path.match(/^\/([^/]+)\/([^/?]+)/);
    if (m) return { kind: "ashby", company: m[1], jobId: m[2] };
    const segs = path.split("/").filter(Boolean);
    if (segs.length === 1) return { kind: "ashby", company: segs[0], jobId: null };
    return { kind: "ashby", company: null, jobId: null };
  }

  // Workday — many variants, all *.myworkdayjobs.com or wd*.myworkdaysite.com
  //   https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site/job/{slug-and-id}
  //   https://tenant.wdN.myworkdayjobs.com/{site}/job/{slug-and-id}    (locale optional)
  // We need: tenant (host's first label), site (path segment before /job/),
  // and the slug-and-id (last segment of path).
  if (host.includes("myworkdayjobs.com") || host.includes("myworkdaysite.com")) {
    const tenant = host.split(".")[0] || null;
    const m = path.match(/(?:\/[a-z]{2}-[A-Z]{2})?\/([^/]+)\/job\/([^/?#]+)/);
    if (tenant && m) {
      const [, site, jobPath] = m;
      return {
        kind: "workday",
        company: tenant,
        jobId: jobPath,
        extras: { host, site },
      };
    }
    return { kind: "workday", company: tenant, jobId: null, extras: { host } };
  }

  // LinkedIn
  if (host.endsWith("linkedin.com")) {
    return { kind: "linkedin", company: null, jobId: null };
  }

  return { kind: "unknown", company: null, jobId: null };
}
