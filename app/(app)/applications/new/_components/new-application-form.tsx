import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { saveNewApplication } from "../actions";

const SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}

function FieldHelper({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function NewApplicationForm({
  defaultTargetYear,
  error,
}: {
  defaultTargetYear: number;
  error?: string;
}) {
  return (
    <form action={saveNewApplication} className="space-y-8">
      <Section title="Company">
        <div className="space-y-2">
          <Label htmlFor="company">Company name</Label>
          <Input
            id="company"
            name="company"
            placeholder="Anthropic"
            required
            autoComplete="organization"
          />
        </div>
      </Section>

      <Section title="Role">
        <div className="space-y-2">
          <Label htmlFor="role_title">Role title</Label>
          <Input
            id="role_title"
            name="role_title"
            placeholder="ML Engineering Intern"
            required
          />
        </div>
        <FieldRow>
          <div className="space-y-2">
            <Label htmlFor="location_text">Location</Label>
            <Input
              id="location_text"
              name="location_text"
              placeholder="Remote · San Francisco, CA"
            />
            <FieldHelper>
              Used to compute distance from your home. Roughly fine.
            </FieldHelper>
          </div>
          <div className="space-y-2">
            <Label htmlFor="work_model">Work model</Label>
            <select
              id="work_model"
              name="work_model"
              defaultValue="unspecified"
              className={SELECT_CLS}
            >
              <option value="unspecified">Unspecified</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>
          </div>
        </FieldRow>
      </Section>

      <Section title="Target & eligibility">
        <FieldRow>
          <div className="space-y-2">
            <Label htmlFor="target_year">Target year</Label>
            <Input
              id="target_year"
              name="target_year"
              type="number"
              min={2024}
              max={2032}
              defaultValue={defaultTargetYear}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="target_season">Target season</Label>
            <select
              id="target_season"
              name="target_season"
              defaultValue="summer"
              className={SELECT_CLS}
            >
              <option value="summer">Summer</option>
              <option value="fall">Fall</option>
              <option value="winter">Winter</option>
              <option value="spring">Spring</option>
            </select>
          </div>
        </FieldRow>
        <div className="space-y-2">
          <Label htmlFor="class_year_tag">Class year eligibility</Label>
          <select
            id="class_year_tag"
            name="class_year_tag"
            defaultValue="unspecified"
            className={SELECT_CLS}
          >
            <option value="unspecified">Any / unspecified</option>
            <option value="freshman_ok">Freshman+ (any class year)</option>
            <option value="sophomore_ok">Sophomore+ (no first-years)</option>
            <option value="junior_plus">Junior+ only</option>
          </select>
          <FieldHelper>
            Who the role is actually open to. Auto-detected for scraped roles
            later (Phase 5).
          </FieldHelper>
        </div>
      </Section>

      <Section title="Deadlines & posting">
        <FieldRow>
          <div className="space-y-2">
            <Label htmlFor="deadline_at">Application deadline</Label>
            <Input
              id="deadline_at"
              name="deadline_at"
              type="date"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="posted_at">Posted date</Label>
            <Input id="posted_at" name="posted_at" type="date" />
          </div>
        </FieldRow>
        <div className="space-y-2">
          <Label htmlFor="jd_url">Job description URL</Label>
          <Input
            id="jd_url"
            name="jd_url"
            type="url"
            placeholder="https://job-boards.greenhouse.io/anthropic/jobs/..."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="jd_body_text">Job description (paste body)</Label>
          <Textarea
            id="jd_body_text"
            name="jd_body_text"
            rows={8}
            placeholder="Paste the JD body so it doesn't rot if the posting closes."
          />
          <FieldHelper>
            Cached locally. Used later by the AI bullet-angle suggestions
            (Phase 6).
          </FieldHelper>
        </div>
      </Section>

      <Section title="Compensation">
        <FieldRow>
          <div className="space-y-2">
            <Label htmlFor="compensation_text">Compensation (text)</Label>
            <Input
              id="compensation_text"
              name="compensation_text"
              placeholder="$50/hr + housing"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="compensation_hourly_cents">
              Hourly equivalent (cents)
            </Label>
            <Input
              id="compensation_hourly_cents"
              name="compensation_hourly_cents"
              type="number"
              min={0}
              step={50}
              placeholder="5000"
            />
            <FieldHelper>
              5000 = $50/hr. Used for sortable salary comparison. Optional.
            </FieldHelper>
          </div>
        </FieldRow>
      </Section>

      <Section title="Notes">
        <div className="space-y-2">
          <Label htmlFor="notes">Initial application notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="Why I'm interested, who referred me, prep notes, anything else."
          />
        </div>
      </Section>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-6">
        <Link
          href="/pipeline"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Cancel
        </Link>
        <Button type="submit">Add to pipeline</Button>
      </div>
    </form>
  );
}
