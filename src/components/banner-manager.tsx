"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { MovingText } from "@/components/announcement-banner";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadManagedBanners } from "@/lib/data";
import { darwinAt, formatDayTime } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

const STYLES = [
  { value: "sticky", label: "Stays on top" },
  { value: "scrolling", label: "Moving text" },
] as const;

/**
 * Post, preview and end announcement banners. An admin's banner goes to everyone; a supervisor's
 * to their own interns. Posting a new one ends your previous one.
 */
export function BannerManager({ audience }: { audience: "everyone" | "your interns" }) {
  const [state, reload] = useLoad(useCallback(() => loadManagedBanners(), []));
  const [message, setMessage] = useState("");
  const [style, setStyle] = useState<"sticky" | "scrolling">("sticky");
  const [ends, setEnds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setError(null);
    setBusy(true);
    const { error: fail } = await createClient().rpc("save_banner", {
      id: null as unknown as string, // null posts a new banner; the generated type can't say so
      message,
      style,
      ends_at: ends ? darwinAt(ends.slice(0, 10), ends.slice(11, 16)).toISOString() : undefined,
    });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "That banner didn't post. Try again."));
      return;
    }
    setMessage("");
    setEnds("");
    toast.success(`Banner posted to ${audience}.`);
    reload();
  }

  async function end(id: string) {
    const { error: fail } = await createClient().rpc("end_banner", { id });
    if (fail) {
      toast.error(errorText(fail, "That banner didn't end. Try again."));
      return;
    }
    toast.success("Banner ended.");
    reload();
  }

  return (
    <section aria-labelledby="banners-title" className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-card sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="banners-title">Announcement banner</h2>
        <p className="text-sm text-muted-foreground">
          Shows at the top of every screen for {audience}. Posting a new one ends your last one.
        </p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void post();
        }}
      >
        <FormField id="banner-message" label="Message" hint={`${message.trim().length} of 280 characters`}>
          {(field) => (
            <textarea
              {...field}
              rows={2}
              maxLength={280}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="min-h-16 rounded-md border border-input bg-card px-3 py-2"
            />
          )}
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Style</legend>
          <div role="radiogroup" className="flex w-fit rounded-full bg-muted p-1">
            {STYLES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={style === option.value}
                onClick={() => setStyle(option.value)}
                className={cn(
                  "min-h-11 rounded-full px-4 text-[15px] font-medium",
                  style === option.value ? "bg-card shadow-card" : "text-muted-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <FormField id="banner-ends" label="Ends (optional, Darwin time)" hint="Leave empty to keep it until you end it.">
          {(field) => <Input {...field} type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} />}
        </FormField>
        {message.trim() ? (
          <div aria-label="Preview" className="overflow-hidden rounded-md bg-primary px-4 py-2 text-[15px] font-medium text-primary-foreground">
            {style === "scrolling" ? <MovingText text={message} /> : message}
          </div>
        ) : null}
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button type="submit" disabled={busy || !message.trim()} className="self-start">
          {busy ? "Posting…" : "Post banner"}
        </Button>
      </form>
      <LoadBlock state={state} reload={reload}>
        {(banners) => {
          const live = banners.filter((banner) => banner.active);
          return live.length === 0 ? (
            <p className="text-sm text-muted-foreground">No banner is showing.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {live.map((banner) => (
                <li key={banner.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-medium break-words">{banner.message}</p>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <StatusChip tone="info" label={banner.style === "scrolling" ? "Moving text" : "Stays on top"} />
                      {banner.author?.display_name ?? "Someone"}
                      {banner.audience === "everyone" ? " · everyone" : " · their interns"}
                      {banner.ends_at ? ` · until ${formatDayTime(banner.ends_at)}` : ""}
                    </p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void end(banner.id)}>
                    End
                  </Button>
                </li>
              ))}
            </ul>
          );
        }}
      </LoadBlock>
    </section>
  );
}
