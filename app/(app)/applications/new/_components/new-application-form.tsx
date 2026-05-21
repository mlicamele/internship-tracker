import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveNewApplication } from "../actions";

export function NewApplicationForm({ error }: { error?: string }) {
  return (
    <form action={saveNewApplication} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="url">URL</Label>
        <Input
          id="url"
          name="url"
          type="url"
          placeholder="https://job-boards.greenhouse.io/anthropic/jobs/..."
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          We&apos;ll extract company, role, location, deadline, and comp where we can.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="jd_body">Job description body</Label>
        <Textarea
          id="jd_body"
          name="jd_body"
          rows={10}
          placeholder="Paste the JD text here. Strongly recommended — most modern job boards bot-wall their JD pages, and pasting the text gives us everything to auto-extract from."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Your notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Why I'm interested, who referred me, anything else."
        />
      </div>

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
        <Button type="submit">Add</Button>
      </div>
    </form>
  );
}
