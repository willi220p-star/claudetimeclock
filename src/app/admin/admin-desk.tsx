"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PunchDayTable } from "@/components/punch-day-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText, type Profile, type Punch } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

type Person = Profile & { password: string | null; contact_email: string | null };

type TimeCard = Punch & {
  photoUrl: string | null;
  displayName: string;
  loginId: string;
};

type CreatedLogin = {
  displayName: string;
  loginId: string;
  password: string;
  email: string;
};

export function AdminDesk({ profile }: { profile: Profile }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [cards, setCards] = useState<TimeCard[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [loadingCards, setLoadingCards] = useState(true);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState("all");
  const [name, setName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedLogin | null>(null);
  const [nextPassword, setNextPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [draftPassword, setDraftPassword] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [savingAdminEmail, setSavingAdminEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void loadPeople();
  }, []);

  useEffect(() => {
    void loadCards(personFilter);
  }, [personFilter]);

  const staff = useMemo(
    () => people.filter((person) => person.role === "staff"),
    [people],
  );

  const personDays = useMemo(() => {
    const groups = new Map<string, TimeCard[]>();
    for (const card of cards) {
      const list = groups.get(card.user_id);
      if (list) list.push(card);
      else groups.set(card.user_id, [card]);
    }
    return [...groups.entries()].map(([userId, punches]) => ({
      userId,
      name: punches[0]?.displayName ?? "Unknown person",
      loginId: punches[0]?.loginId ?? "",
      punches,
    }));
  }, [cards]);

  async function loadPeople() {
    setPeopleError(null);
    const supabase = createClient();
    const [{ data, error }, secrets] = await Promise.all([
      supabase
        .from("daymark_profiles")
        .select("id, login_id, display_name, role, active, created_at, contact_email")
        .order("display_name"),
      supabase.from("daymark_login_secrets").select("user_id, password"),
    ]);

    if (error) setPeopleError(error.message);
    else {
      const passwords = new Map(
        ((secrets.data ?? []) as Array<{ user_id: string; password: string }>).map((row) => [row.user_id, row.password]),
      );
      const nextPeople = ((data ?? []) as Array<Profile & { contact_email: string | null }>).map((person) => ({
        ...person,
        contact_email: person.contact_email,
        password: passwords.get(person.id) ?? null,
      }));
      setPeople(nextPeople);
      const admin = nextPeople.find((person) => person.id === profile.id);
      if (admin) setAdminEmail(admin.contact_email ?? "");
    }
    setLoadingPeople(false);
  }

  async function loadCards(selectedPerson: string) {
    setLoadingCards(true);
    setCardsError(null);
    const supabase = createClient();
    const start = new Date();
    start.setDate(start.getDate() - 30);

    let query = supabase
      .from("daymark_punches")
      .select(
        "id, user_id, event_type, occurred_at, latitude, longitude, accuracy_m, photo_path, place_name, daymark_profiles(display_name, login_id)",
      )
      .gte("occurred_at", start.toISOString())
      .order("occurred_at", { ascending: false })
      .limit(400);

    if (selectedPerson !== "all") query = query.eq("user_id", selectedPerson);

    const { data, error } = await query;
    if (error) {
      setCardsError(error.message);
      setLoadingCards(false);
      return;
    }

    const rows = (data ?? []) as Array<
      Punch & {
        daymark_profiles: { display_name: string; login_id: string } | { display_name: string; login_id: string }[] | null;
      }
    >;
    const urls = await signedPhotoUrls(
      supabase,
      rows.map((row) => row.photo_path),
    );

    setCards(
      rows.map((row) => {
        const linked = Array.isArray(row.daymark_profiles) ? row.daymark_profiles[0] : row.daymark_profiles;
        return {
          id: row.id,
          user_id: row.user_id,
          event_type: row.event_type,
          occurred_at: row.occurred_at,
          latitude: row.latitude,
          longitude: row.longitude,
          accuracy_m: row.accuracy_m,
          photo_path: row.photo_path,
          place_name: row.place_name,
          photoUrl: urls.get(row.photo_path) ?? null,
          displayName: linked?.display_name ?? "Unknown person",
          loginId: linked?.login_id ?? "",
        };
      }),
    );
    setLoadingCards(false);
  }

  async function createPerson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreated(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_staff_login", {
        display_name: name.trim(),
        login_id: loginId.trim().toLowerCase(),
        password,
        email: contactEmail.trim().toLowerCase(),
      });

      if (error) throw new Error(error.message);
      if (!data || typeof data !== "object") throw new Error("Could not create that login.");

      const person = data as Person;
      setPeople((current) =>
        [...current, { ...person, contact_email: contactEmail.trim().toLowerCase(), password, created_at: new Date().toISOString() }].sort(byName),
      );
      setCreated({
        displayName: person.display_name,
        loginId: person.login_id,
        password,
        email: contactEmail.trim().toLowerCase(),
      });
      setName("");
      setLoginId("");
      setContactEmail("");
      setPassword("");
      toast.success(`${person.display_name} can sign in now.`);
    } catch (error) {
      toast.error(errorText(error, "Could not create that login."));
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(person: Person) {
    if (person.id === profile.id) {
      toast.error("You can't pause your own admin login.");
      return;
    }
    const supabase = createClient();
    const next = !person.active;
    const { error } = await supabase.from("daymark_profiles").update({ active: next }).eq("id", person.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPeople((current) => current.map((item) => (item.id === person.id ? { ...item, active: next } : item)));
    toast.success(next ? `${person.display_name} can sign in again.` : `${person.display_name} is paused.`);
  }

  async function saveStaffPassword(person: Person) {
    if (draftPassword.length < 8) {
      toast.error("Use at least 8 characters.");
      return;
    }
    setSavingPassword(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_staff_password", {
        target_id: person.id,
        password: draftPassword,
      });
      if (error) throw error;
      setPeople((current) =>
        current.map((item) => (item.id === person.id ? { ...item, password: draftPassword } : item)),
      );
      setDraftPassword("");
      setRevealed(person.id);
      toast.success(`Password updated for ${person.display_name}.`);
    } catch (error) {
      toast.error(errorText(error, "Could not update that password."));
    } finally {
      setSavingPassword(false);
    }
  }

  async function deletePerson(person: Person) {
    setDeleting(true);
    try {
      const supabase = createClient();
      const { data: files } = await supabase.storage.from("daymark-photos").list(person.id, { limit: 1000 });
      const paths = (files ?? []).filter((file) => file.name).map((file) => `${person.id}/${file.name}`);
      if (paths.length > 0) {
        const { error: photoError } = await supabase.storage.from("daymark-photos").remove(paths);
        if (photoError) throw photoError;
      }
      const { error } = await supabase.rpc("delete_staff_login", { target_id: person.id });
      if (error) throw error;
      setPeople((current) => current.filter((item) => item.id !== person.id));
      setCards((current) => current.filter((card) => card.user_id !== person.id));
      setOpenPerson(null);
      setConfirmDelete(null);
      if (personFilter === person.id) setPersonFilter("all");
      toast.success(`${person.display_name} was deleted.`);
    } catch (error) {
      toast.error(errorText(error, "Could not delete that person."));
    } finally {
      setDeleting(false);
    }
  }

  async function saveEmail(targetId: string, email: string, onSaved: (email: string) => void) {
    const next = email.trim().toLowerCase();
    if (!next.includes("@")) {
      toast.error("Enter a real email address.");
      return;
    }
    setSavingEmail(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_login_email", { target_id: targetId, email: next });
      if (error) throw error;
      onSaved(next);
      toast.success("Reset email saved.");
    } catch (error) {
      toast.error(errorText(error, "Could not save that email."));
    } finally {
      setSavingEmail(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nextPassword.length < 8) {
      toast.error("Use at least 8 characters.");
      return;
    }
    setChangingPassword(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: nextPassword });
      if (error) throw error;
      const { error: saveError } = await supabase.rpc("save_own_password", { password: nextPassword });
      if (saveError) throw saveError;
      setNextPassword("");
      toast.success("Admin password updated.");
    } catch (error) {
      toast.error(errorText(error, "Could not change the password."));
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[340px_1fr] md:px-8">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Add a person</CardTitle>
            <CardDescription>
              They sign in with this login ID and password. Hand it to them yourself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="post" action="." onSubmit={createPerson} className="flex flex-col gap-4">
              <Field label="Name" id="display-name">
                <Input
                  id="display-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Maya Chen"
                  className="h-11 rounded-xl bg-background px-3"
                  required
                />
              </Field>
              <Field label="Login ID" id="new-login">
                <Input
                  id="new-login"
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  placeholder="maya.chen"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-11 rounded-xl bg-background px-3"
                  required
                />
              </Field>
              <Field label="Email" id="new-email">
                <Input
                  id="new-email"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  placeholder="maya@email.com"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-11 rounded-xl bg-background px-3"
                  required
                />
              </Field>
              <Field label="Password" id="new-password">
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-11 rounded-xl bg-background px-3 pr-11"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              <Button type="submit" className="h-11 rounded-xl" disabled={creating}>
                {creating ? "Creating…" : "Create login"}
              </Button>
            </form>
            {created ? (
              <div className="mt-4 rounded-2xl bg-secondary px-3 py-3 text-sm">
                <p className="font-medium">{created.displayName} is ready.</p>
                <p className="mt-1 text-muted-foreground">
                  Login ID <span className="font-medium text-foreground">{created.loginId}</span>
                </p>
                <p className="text-muted-foreground">
                  Password <span className="font-medium text-foreground">{created.password}</span>
                </p>
                <p className="text-muted-foreground">
                  Email <span className="font-medium text-foreground">{created.email}</span>
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your admin password</CardTitle>
            <CardDescription>Save the email that receives your reset link, and replace the starter password.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              method="post"
              action="."
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setSavingAdminEmail(true);
                void saveEmail(profile.id, adminEmail, (next) => {
                  setAdminEmail(next);
                  setPeople((current) =>
                    current.map((person) => (person.id === profile.id ? { ...person, contact_email: next } : person)),
                  );
                }).finally(() => setSavingAdminEmail(false));
              }}
            >
              <Label htmlFor="admin-email">Reset email</Label>
              <Input
                id="admin-email"
                type="email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                placeholder="you@email.com"
                className="h-11 rounded-xl bg-background px-3"
              />
              <Button type="submit" variant="outline" className="h-10" disabled={savingAdminEmail || savingEmail}>
                {savingAdminEmail ? "Saving…" : "Save email"}
              </Button>
            </form>
            <form method="post" action="." onSubmit={changePassword} className="flex flex-col gap-3">
              <Label htmlFor="admin-password">New password</Label>
              <Input
                id="admin-password"
                type="password"
                value={nextPassword}
                onChange={(event) => setNextPassword(event.target.value)}
                minLength={8}
                className="h-11 rounded-xl bg-background px-3"
              />
              <Button type="submit" variant="outline" className="h-10" disabled={changingPassword}>
                {changingPassword ? "Saving…" : "Update password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>Open a person to see their password, replace it, pause them, or delete them.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {loadingPeople ? <p className="text-sm text-muted-foreground">Loading people…</p> : null}
            {peopleError ? <p className="text-sm text-destructive">{peopleError}</p> : null}
            {!loadingPeople && staff.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                No one can clock in yet. Add a login ID and password above.
              </p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {people.map((person) => {
                const open = openPerson === person.id;
                return (
                  <li key={person.id} className="rounded-2xl bg-secondary px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{person.display_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {person.login_id} · {person.role === "admin" ? "Admin" : person.active ? "Staff" : "Paused"}
                        </p>
                      </div>
                      {person.role === "admin" ? (
                        <Badge variant="outline">Admin</Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8"
                          onClick={() => {
                            setOpenPerson(open ? null : person.id);
                            setDraftPassword("");
                            setDraftEmail(person.contact_email ?? "");
                            setConfirmDelete(null);
                          }}
                        >
                          {open ? "Close" : "Manage"}
                        </Button>
                      )}
                    </div>
                    {open && person.role === "staff" ? (
                      <div className="mt-3 flex flex-col gap-3 border-t border-border/70 pt-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Password</p>
                          <p className="mt-1 font-medium tracking-wide">
                            {person.password
                              ? revealed === person.id
                                ? person.password
                                : "•".repeat(Math.min(person.password.length, 12))
                              : "Not stored yet. Set a new one below."}
                          </p>
                          {person.password ? (
                            <button
                              type="button"
                              className="mt-1 text-xs text-primary"
                              onClick={() => setRevealed(revealed === person.id ? null : person.id)}
                            >
                              {revealed === person.id ? "Hide" : "Show"}
                            </button>
                          ) : null}
                        </div>
                        <form
                          method="post"
                          action="."
                          className="flex flex-col gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveEmail(person.id, draftEmail, (next) => {
                              setDraftEmail(next);
                              setPeople((current) =>
                                current.map((item) => (item.id === person.id ? { ...item, contact_email: next } : item)),
                              );
                            });
                          }}
                        >
                          <Label htmlFor={`email-${person.id}`}>Reset email</Label>
                          <Input
                            id={`email-${person.id}`}
                            type="email"
                            value={draftEmail}
                            onChange={(event) => setDraftEmail(event.target.value)}
                            className="h-10 rounded-xl bg-background px-3"
                            autoComplete="email"
                          />
                          <Button type="submit" variant="outline" className="h-9" disabled={savingEmail}>
                            {savingEmail ? "Saving…" : "Save email"}
                          </Button>
                        </form>
                        <form
                          method="post"
                          action="."
                          className="flex flex-col gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveStaffPassword(person);
                          }}
                        >
                          <Label htmlFor={`password-${person.id}`}>New password</Label>
                          <Input
                            id={`password-${person.id}`}
                            type="text"
                            value={draftPassword}
                            onChange={(event) => setDraftPassword(event.target.value)}
                            minLength={8}
                            className="h-10 rounded-xl bg-background px-3"
                            autoComplete="new-password"
                          />
                          <Button type="submit" variant="outline" className="h-9" disabled={savingPassword}>
                            {savingPassword ? "Saving…" : "Update password"}
                          </Button>
                        </form>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" className="h-9" onClick={() => toggleActive(person)}>
                            {person.active ? "Pause" : "Restore"}
                          </Button>
                          {confirmDelete === person.id ? (
                            <Button
                              type="button"
                              variant="destructive"
                              className="h-9"
                              disabled={deleting}
                              onClick={() => void deletePerson(person)}
                            >
                              {deleting ? "Deleting…" : "Delete permanently"}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="destructive"
                              className="h-9"
                              onClick={() => setConfirmDelete(person.id)}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                        {confirmDelete === person.id ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            This removes {person.display_name}, their punches, and their photos.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-heading text-3xl tracking-tight">Time cards</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Each day is one row: clock in, clock out, break in, and break out, with the full address. Open a photo to see it larger.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10 bg-card"
            onClick={() => void loadCards(personFilter)}
          >
            <RefreshCw />
            Refresh
          </Button>
        </div>

        <Field label="Person" id="person-filter">
          <select
            id="person-filter"
            value={personFilter}
            onChange={(event) => setPersonFilter(event.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"
          >
            <option value="all">Everyone</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.display_name}
              </option>
            ))}
          </select>
        </Field>

        {loadingCards ? <p className="text-sm text-muted-foreground">Loading time cards…</p> : null}
        {cardsError ? (
          <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {cardsError}
          </p>
        ) : null}
        {!loadingCards && !cardsError && cards.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-sm leading-relaxed text-muted-foreground">
              No punches in the last 30 days. When someone clocks in on site, the photo, time, and place show up here.
            </CardContent>
          </Card>
        ) : null}

        {personDays.map((person) => (
          <section key={person.userId} className="flex flex-col gap-3">
            <div>
              <h2 className="font-heading text-2xl tracking-tight">{person.name}</h2>
              <p className="text-sm text-muted-foreground">{person.loginId}</p>
            </div>
            <PunchDayTable punches={person.punches} />
          </section>
        ))}
      </section>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function byName(a: Person, b: Person) {
  return a.display_name.localeCompare(b.display_name);
}

async function signedPhotoUrls(supabase: ReturnType<typeof createClient>, paths: string[]) {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data } = await supabase.storage.from("daymark-photos").createSignedUrls(paths, 60 * 60);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}
