"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Described = { id: string; "aria-invalid"?: true; "aria-describedby"?: string };

/** A labelled field whose hint and error are wired to the input with aria-describedby (§11.5). */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (input: Described) => ReactNode;
}) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": described || undefined })}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A password input with a show/hide toggle. The value is never stored or shown back later. */
export function PasswordInput({ className, ...props }: ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-12", className)} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-md text-muted-foreground"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}

/** A form-level message: the database's own words for errors, announced to screen readers. */
export function FormMessage({ tone = "bad", children }: { tone?: "bad" | "ok"; children: ReactNode }) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      className={cn("rounded-md px-3 py-2 text-sm", tone === "bad" ? "bg-bad-bg text-bad" : "bg-ok-bg text-ok")}
    >
      {children}
    </p>
  );
}
