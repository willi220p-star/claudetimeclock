"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AdminFrame } from "@/app/admin/admin-frame";
import { ConfirmDialog } from "@/app/admin/confirm-dialog";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QUARTER_HOURS } from "@/lib/admin-config";
import { loadSites } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { formatTimeOfDay } from "@/lib/darwin";
import { fieldErrors, siteSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Site = Awaited<ReturnType<typeof loadSites>>[number];
type Draft = Record<
  "name" | "address" | "latitude" | "longitude" | "radius_m" | "standard_capacity" | "hard_capacity" | "window_start" | "window_end",
  string
>;

const selectClass = "h-12 w-full rounded-md border border-input bg-card px-3";

function draftOf(site: Site | null): Draft {
  return {
    name: site?.name ?? "",
    address: site?.address ?? "",
    latitude: site ? String(site.latitude) : "",
    longitude: site ? String(site.longitude) : "",
    radius_m: String(site?.radius_m ?? 200),
    standard_capacity: String(site?.standard_capacity ?? 3),
    hard_capacity: String(site?.hard_capacity ?? 4),
    window_start: (site?.window_start ?? "07:00").slice(0, 5),
    window_end: (site?.window_end ?? "19:00").slice(0, 5),
  };
}

export function SitesScreen() {
  return (
    <AdminFrame title="Sites">
      <SitesDesk />
    </AdminFrame>
  );
}

function SitesDesk() {
  const [sites, reload] = useLoad(loadSites);
  const [editing, setEditing] = useState<Site | "new" | null>(null);
  const [toggling, setToggling] = useState<Site | null>(null);

  return (
    <>
      <PageHeader
        title="Sites"
        description="Where interns clock in: the geofence, the clock-in window and how many desks there are."
        actions={
          <Button type="button" onClick={() => setEditing("new")}>
            New site
          </Button>
        }
      />
      {editing ? (
        <SiteForm
          key={editing === "new" ? "new" : editing.id}
          site={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      <LoadBlock state={sites} reload={reload} empty="No sites yet. Add the office first.">
        {(rows) => (
          <ul className="flex flex-col gap-2">
            {rows.map((site) => (
              <li key={site.id} className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{site.name}</p>
                    <StatusChip tone={site.active ? "ok" : "neutral"} label={site.active ? "Open" : "Off"} />
                  </div>
                  <p className="text-sm break-words text-muted-foreground">{site.address}</p>
                  <p className="text-sm text-muted-foreground">
                    {site.radius_m} m radius · {site.standard_capacity} desks, up to {site.hard_capacity} ·{" "}
                    {formatTimeOfDay(site.window_start)}–{formatTimeOfDay(site.window_end)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(site)}>
                    Edit
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setToggling(site)}>
                    {site.active ? "Turn off" : "Turn on"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </LoadBlock>
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.active ? `Turn off ${toggling.name}?` : `Turn on ${toggling?.name ?? "this site"}?`}
        description={
          toggling?.active
            ? "No one can be placed here while it's off. Sites with live placements can't be turned off."
            : "It can take placements and clock-ins again."
        }
        confirmLabel={toggling?.active ? "Turn off" : "Turn on"}
        destructive={toggling?.active}
        onCancel={() => setToggling(null)}
        onConfirm={async () => {
          if (!toggling) return null;
          const { error } = await createClient().rpc("set_site_active", { id: toggling.id, active: !toggling.active });
          if (error) return errorText(error, "That didn't save. Try again.");
          toast.success(`${toggling.name} is ${toggling.active ? "off" : "open"}.`);
          setToggling(null);
          reload();
          return null;
        }}
      />
    </>
  );
}

function SiteForm({ site, onCancel, onSaved }: { site: Site | null; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(site));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    setFormError(null);
    const parsed = siteSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const { error } = await createClient().rpc("save_site", { site: site ? { id: site.id, ...parsed.data } : parsed.data });
    setBusy(false);
    if (error) {
      setFormError(errorText(error, "That site didn't save. Try again."));
      return;
    }
    toast.success(site ? "Site saved." : "Site added.");
    onSaved();
  }

  const text = (key: keyof Draft, label: string, props: Record<string, string> = {}, hint?: string) => (
    <FormField id={`site-${key}`} label={label} hint={hint} error={errors[key]}>
      {(field) => <Input {...field} {...props} value={draft[key]} onChange={set(key)} />}
    </FormField>
  );
  const time = (key: "window_start" | "window_end", label: string) => (
    <FormField id={`site-${key}`} label={label} error={errors[key]}>
      {(field) => (
        <select {...field} className={selectClass} value={draft[key]} onChange={set(key)}>
          {QUARTER_HOURS.map((t) => (
            <option key={t} value={t}>
              {formatTimeOfDay(t)}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-card sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>{site ? `Edit ${site.name}` : "New site"}</h2>
      {text("name", "Name", { autoComplete: "off" })}
      {text("address", "Address", { autoComplete: "off" })}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("latitude", "Latitude", { inputMode: "decimal" }, "-90 to 90, e.g. -12.4634")}
        {text("longitude", "Longitude", { inputMode: "decimal" }, "-180 to 180, e.g. 130.8456")}
      </div>
      {text("radius_m", "Geofence radius (metres)", { inputMode: "numeric" }, "20 to 2,000.")}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("standard_capacity", "Standard capacity", { inputMode: "numeric" }, "Desks booked without approval.")}
        {text("hard_capacity", "Hard limit", { inputMode: "numeric" }, "Never more than this, extra spots included.")}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {time("window_start", "Clock-in window opens")}
        {time("window_end", "Clock-in window closes")}
      </div>
      {formError ? <FormMessage>{formError}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : site ? "Save site" : "Add site"}
        </Button>
      </div>
    </form>
  );
}
