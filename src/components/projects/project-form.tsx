"use client";

import { useCallback, useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-field";
import { PROJECT_STATUS, PROJECT_STATUSES, checkLinks, type ProjectDetail } from "@/components/projects/project-helpers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Database } from "@/lib/database.types";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type SaveArgs = Database["public"]["Functions"]["save_project"]["Args"];

async function loadPeople(project: string | null) {
  const supabase = createClient();
  const [{ data, error }, { data: claims }] = await Promise.all([
    supabase.rpc("project_people", project ? { project } : {}),
    supabase.auth.getClaims(),
  ]);
  if (error) throw error;
  return { people: (data ?? []).sort((a, b) => a.display_name.localeCompare(b.display_name)), me: claims?.claims?.sub ?? null };
}

const field = "flex flex-col gap-1";
const select = "h-12 w-full rounded-md border border-input bg-card px-3";

/**
 * Add or edit a project (D49) as a sheet: every field, the lead and members from `project_people`, up to 5 links.
 * An intern's new project waits for approval; staff projects are approved at once (save_project decides).
 */
export function ProjectForm({
  open,
  initial,
  staff,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: ProjectDetail;
  staff: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const id = useId();
  const project = initial?.project;
  const projectId = project?.id ?? null;
  const load = useCallback(() => loadPeople(projectId), [projectId]);
  const [people] = useLoad(load);
  const [name, setName] = useState(project?.name ?? "");
  const [client, setClient] = useState(project?.client_name ?? "");
  const [contact, setContact] = useState(project?.contact_name ?? "");
  const [email, setEmail] = useState(project?.contact_email ?? "");
  const [phone, setPhone] = useState(project?.contact_phone ?? "");
  const [start, setStart] = useState(project?.start_date ?? "");
  const [due, setDue] = useState(project?.due_date ?? "");
  const [status, setStatus] = useState(project?.status ?? "planning");
  // null until touched: then the saved lead, or me when adding.
  const [lead, setLead] = useState<string | null>(null);
  const [members, setMembers] = useState(() => new Set(initial?.members.map((member) => member.id) ?? []));
  const [description, setDescription] = useState(project?.description ?? "");
  const [links, setLinks] = useState<string[]>(() => (project?.links?.length ? project.links : [""]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = people.status === "ready" ? people.data.people : [];
  const me = people.status === "ready" ? people.data.me : null;
  const leadValue = lead ?? (project ? (project.lead_id ?? "") : list.some((person) => person.person_id === me) ? (me ?? "") : "");
  // Keep the current lead and members choosable even if they've since left project_people's list.
  const known = new Map(list.map((person) => [person.person_id, person.display_name]));
  if (project?.lead_id && !known.has(project.lead_id)) known.set(project.lead_id, project.lead_name ?? "Current lead");
  for (const member of initial?.members ?? []) if (!known.has(member.id)) known.set(member.id, member.name);
  const choices = [...known.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Give the project a name.");
    if (email.trim() && !email.includes("@")) return setError("Check the contact email.");
    if (start && due && due < start) return setError("The due date can't be before the start date.");
    const checked = checkLinks(links);
    if ("error" in checked) return setError(checked.error);
    setBusy(true);
    // The generated Args mark every parameter non-null; the function takes nulls for the optional ones.
    const args = {
      id: project?.id ?? null,
      name: name.trim(),
      client_name: client.trim() || null,
      contact_name: contact.trim() || null,
      contact_email: email.trim() || null,
      contact_phone: phone.trim() || null,
      start_date: start || null,
      due_date: due || null,
      status,
      description: description.trim() || null,
      links: checked.links,
      lead: leadValue || null,
      members: [...members].filter((person) => person !== leadValue),
    } as unknown as SaveArgs;
    const { data, error: fail } = await createClient().rpc("save_project", args);
    setBusy(false);
    if (fail) return setError(errorText(fail, "The project didn't save. Try again."));
    toast.success(project ? "Project saved." : staff ? "Project added." : "Project added. Your supervisor has been asked to approve it.");
    onSaved(data ?? project?.id ?? "");
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="flex flex-col gap-0 p-0 pb-0 sm:w-[min(100%-2rem,36rem)] sm:pb-0">
        <form
          aria-label={project ? "Edit project" : "New project"}
          className="flex max-h-[90svh] min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-background px-4 pt-4 pb-4 sm:px-6">
            <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
            <DialogDescription className="mt-0">
              {project || staff ? "Only the team and their supervisors can see it." : "Your supervisor approves it before tasks can go under it."}
            </DialogDescription>

            <div className="flex flex-col gap-3 rounded-xl bg-card p-4">
              <div className={field}>
                <Label htmlFor={`${id}-name`}>Project name</Label>
                <Input id={`${id}-name`} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={field}>
                  <Label htmlFor={`${id}-status`}>Status</Label>
                  <select id={`${id}-status`} className={select} value={status} onChange={(e) => setStatus(e.target.value)}>
                    {PROJECT_STATUSES.map((key) => (
                      <option key={key} value={key}>
                        {PROJECT_STATUS[key].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={field}>
                  <Label htmlFor={`${id}-lead`}>Lead</Label>
                  <select id={`${id}-lead`} className={select} value={leadValue} onChange={(e) => setLead(e.target.value)}>
                    <option value="">No lead</option>
                    {choices.map(([person, display]) => (
                      <option key={person} value={person}>
                        {person === me ? `${display} (you)` : display}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={field}>
                  <Label htmlFor={`${id}-start`}>Start date</Label>
                  <Input id={`${id}-start`} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div className={field}>
                  <Label htmlFor={`${id}-due`}>Due date</Label>
                  <Input id={`${id}-due`} type="date" min={start || undefined} value={due} onChange={(e) => setDue(e.target.value)} />
                </div>
              </div>
            </div>

            <fieldset className="flex flex-col gap-3 rounded-xl bg-card p-4">
              <legend className="sr-only">Client</legend>
              <p aria-hidden className="text-[15px] font-semibold">
                Client
              </p>
              <div className={field}>
                <Label htmlFor={`${id}-client`}>Client name</Label>
                <Input id={`${id}-client`} maxLength={120} value={client} onChange={(e) => setClient(e.target.value)} />
              </div>
              <div className={field}>
                <Label htmlFor={`${id}-contact`}>Contact name</Label>
                <Input id={`${id}-contact`} maxLength={80} autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={field}>
                  <Label htmlFor={`${id}-email`}>Contact email</Label>
                  <Input
                    id={`${id}-email`}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    maxLength={200}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className={field}>
                  <Label htmlFor={`${id}-phone`}>Contact phone</Label>
                  <Input
                    id={`${id}-phone`}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={30}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-1 rounded-xl bg-card p-4">
              <legend className="sr-only">Team members</legend>
              <p aria-hidden className="mb-1 text-[15px] font-semibold">
                Team members
              </p>
              {people.status === "loading" ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : people.status === "error" ? (
                <p className="text-sm text-bad">{people.message}</p>
              ) : choices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one to add yet.</p>
              ) : (
                <div className="flex max-h-56 flex-col overflow-y-auto">
                  {choices
                    .filter(([person]) => person !== leadValue)
                    .map(([person, display]) => (
                      <label key={person} className="flex min-h-11 items-center gap-3">
                        <input
                          type="checkbox"
                          className="size-5 accent-primary"
                          checked={members.has(person)}
                          onChange={(e) =>
                            setMembers((current) => {
                              const next = new Set(current);
                              if (e.target.checked) next.add(person);
                              else next.delete(person);
                              return next;
                            })
                          }
                        />
                        {person === me ? `${display} (you)` : display}
                      </label>
                    ))}
                </div>
              )}
            </fieldset>

            <div className="flex flex-col gap-3 rounded-xl bg-card p-4">
              <div className={field}>
                <Label htmlFor={`${id}-description`}>Description</Label>
                <textarea
                  id={`${id}-description`}
                  rows={3}
                  maxLength={2000}
                  className="rounded-md border border-input bg-card px-3 py-2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Links</legend>
                {links.map((link, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      aria-label={`Link ${index + 1}`}
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      maxLength={500}
                      value={link}
                      onChange={(e) => setLinks(links.map((item, at) => (at === index ? e.target.value : item)))}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove link ${index + 1}`}
                      onClick={() => setLinks(links.length === 1 ? [""] : links.filter((_, at) => at !== index))}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
                {links.length < 5 ? (
                  <Button type="button" variant="ghost" className="w-fit px-2" onClick={() => setLinks([...links, ""])}>
                    <Plus aria-hidden />
                    Add a link
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">That&apos;s the most links a project can have.</p>
                )}
              </fieldset>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-t border-border bg-card px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
            {error ? <FormMessage>{error}</FormMessage> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : project ? "Save project" : "Add project"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
