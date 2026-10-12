"use client";

import { useCallback, useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/daymark";
import { formatDayTime } from "@/lib/darwin";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Audience = "everyone" | "interns" | "my_interns";
export const AUDIENCE_LABEL: Record<Audience, string> = {
  everyone: "Everyone",
  interns: "All interns",
  my_interns: "My interns",
};

const card = "flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card";

async function loadMine() {
  const { data, error } = await createClient().rpc("my_announcements");
  if (error) throw error;
  return data ?? [];
}

/** "4 of 6 read" or, when it must be acknowledged, "4 of 6 acknowledged". */
export function readSummary(row: { must_ack: boolean; recipients: number; read: number; acked: number }) {
  return row.must_ack ? `${row.acked} of ${row.recipients} acknowledged` : `${row.read} of ${row.recipients} read`;
}

/**
 * Home (D41): announcements not yet read, and must-acknowledge ones not yet acknowledged, pinned above
 * the clock until the person taps the button. Never blocks clocking.
 */
export function AnnouncementCards() {
  const [state, reload] = useLoad(loadMine);
  const [busy, setBusy] = useState<string | null>(null);
  if (state.status !== "ready") return null;
  const open = state.data.filter((a) => (a.must_ack ? !a.acked_at : !a.read_at));
  if (open.length === 0) return null;

  async function mark(id: string, ack: boolean) {
    setBusy(id);
    const { error } = await createClient().rpc("mark_announcement", { id, ack });
    setBusy(null);
    if (error) toast.error(errorText(error, "That didn't save. Try again."));
    else reload();
  }

  return (
    <div className="flex flex-col gap-3">
      {open.map((a) => (
        <section key={a.id} aria-labelledby={`ann-${a.id}`} className={`${card} border-l-4 border-primary`}>
          <h2 id={`ann-${a.id}`} className="flex items-center gap-2 text-base">
            <Megaphone aria-hidden className="size-4 text-primary" />
            {a.title}
          </h2>
          <p className="whitespace-pre-line">{a.body}</p>
          <p className="text-sm text-muted-foreground">
            {a.author} · {formatDayTime(a.created_at)}
          </p>
          <Button
            type="button"
            className="w-fit"
            variant={a.must_ack ? "default" : "secondary"}
            disabled={busy === a.id}
            onClick={() => void mark(a.id, a.must_ack)}
          >
            {a.must_ack ? "I've read this" : "Got it"}
          </Button>
        </section>
      ))}
    </div>
  );
}

async function loadPosted() {
  const { data, error } = await createClient().rpc("posted_announcements");
  if (error) throw error;
  return data ?? [];
}

/** Staff page (D41): post, see who has read each one, remind the rest, archive. */
export function AnnouncementsDesk({ isAdmin }: { isAdmin: boolean }) {
  const [state, reload] = useLoad(loadPosted);
  return (
    <>
      <PageHeader
        title="Announcements"
        description={
          isAdmin
            ? "Post a notice to everyone, all interns or your own interns, and see who has read it."
            : "Post a notice to your interns and see who has read it."
        }
      />
      <PostForm isAdmin={isAdmin} onPosted={reload} />
      <LoadBlock state={state} reload={reload} empty="Nothing posted yet.">
        {(rows) => (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <PostedCard key={row.id} row={row} onChanged={reload} />
            ))}
          </ul>
        )}
      </LoadBlock>
    </>
  );
}

function PostForm({ isAdmin, onPosted }: { isAdmin: boolean; onPosted: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>(isAdmin ? "everyone" : "my_interns");
  const [mustAck, setMustAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("post_announcement", { title, body, audience, must_ack: mustAck });
    setBusy(false);
    if (error) {
      setError(errorText(error, "It didn't post. Try again."));
      return;
    }
    toast.success("Posted. Everyone it's for gets a notification.");
    setTitle("");
    setBody("");
    setMustAck(false);
    onPosted();
  }

  return (
    <form
      className={card}
      onSubmit={(event) => {
        event.preventDefault();
        void post();
      }}
    >
      <h2 className="text-base">New announcement</h2>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ann-title">Title</Label>
        <Input id="ann-title" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ann-body">Message</Label>
        <textarea
          id="ann-body"
          maxLength={2000}
          rows={4}
          className="rounded-md border border-input bg-card px-3 py-2"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {isAdmin ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="ann-audience">For</Label>
          <select
            id="ann-audience"
            className="h-12 w-full rounded-md border border-input bg-card px-3"
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
          >
            {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((key) => (
              <option key={key} value={key}>
                {AUDIENCE_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" className="size-5 accent-primary" checked={mustAck} onChange={(e) => setMustAck(e.target.checked)} />
        Must be acknowledged (stays pinned on Home until they tap &quot;I&apos;ve read this&quot;)
      </label>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="submit" className="w-fit" disabled={busy || !title.trim() || !body.trim()}>
        {busy ? "Posting…" : "Post"}
      </Button>
    </form>
  );
}

type Posted = Awaited<ReturnType<typeof loadPosted>>[number];

function PostedCard({ row, onChanged }: { row: Posted; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const done = row.must_ack ? row.acked : row.read;
  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc("announcement_reads", { id: row.id });
    if (error) throw error;
    return data ?? [];
  }, [row.id]);

  async function nudge() {
    const { data, error } = await createClient().rpc("nudge_announcement", { id: row.id });
    if (error) toast.error(errorText(error, "The reminder didn't send. Try again."));
    else toast.success(data === 1 ? "Reminded 1 person." : `Reminded ${data ?? 0} people.`);
  }

  async function archive() {
    const { error } = await createClient().rpc("archive_announcement", { id: row.id });
    if (error) toast.error(errorText(error, "It didn't archive. Try again."));
    else onChanged();
  }

  return (
    <li className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{row.title}</p>
          <p className="text-sm text-muted-foreground">
            {AUDIENCE_LABEL[row.audience as Audience] ?? row.audience} · {row.author} · {formatDayTime(row.created_at)}
          </p>
        </div>
        <StatusChip tone={done >= row.recipients ? "ok" : "warn"} label={readSummary(row)} />
      </div>
      <p className="whitespace-pre-line text-sm">{row.body}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide who read it" : "Who read it"}
        </Button>
        {done < row.recipients ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => void nudge()}>
            Remind the rest
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => void archive()}>
          Archive
        </Button>
      </div>
      {open ? <ReadList load={load} mustAck={row.must_ack} /> : null}
    </li>
  );
}

function ReadList({
  load,
  mustAck,
}: {
  load: () => Promise<{ person_id: string; display_name: string; read_at: string | null; acked_at: string | null }[]>;
  mustAck: boolean;
}) {
  const [state, reload] = useLoad(load);
  return (
    <LoadBlock state={state} reload={reload} empty="Nobody to show.">
      {(people) => (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {people.map((p) => {
            const at = mustAck ? p.acked_at : p.read_at;
            return (
              <li key={p.person_id} className="flex items-center justify-between gap-2 py-2">
                <span>{p.display_name}</span>
                {at ? (
                  <span className="text-muted-foreground">
                    {mustAck ? "Acknowledged" : "Read"} {formatDayTime(at)}
                  </span>
                ) : (
                  <StatusChip tone="warn" label={mustAck && p.read_at ? "Read, not acknowledged" : "Not read"} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </LoadBlock>
  );
}
