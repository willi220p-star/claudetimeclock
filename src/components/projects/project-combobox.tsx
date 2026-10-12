"use client";

import { useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Lookup } from "@/components/projects/project-helpers";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type PickedProject = { id: string; name: string };

/**
 * The task form's optional Project (D49): an ARIA combobox over `project_lookup(q)`, which only lists approved
 * projects the person can see. "No project" is always the first option. Each keystroke asks the database; a late
 * answer for an older query is dropped.
 */
export function ProjectCombobox({ value, onChange }: { value: PickedProject | null; onChange: (value: PickedProject | null) => void }) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Lookup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = useRef(0);
  const options: (Lookup | null)[] = [null, ...(results ?? [])];

  async function search(text: string) {
    const ticket = ++asked.current;
    const { data, error } = await createClient().rpc("project_lookup", text.trim() ? { q: text.trim() } : {});
    if (ticket !== asked.current) return;
    setFailed(Boolean(error));
    setResults((data ?? []) as Lookup[]);
  }

  function show(text: string) {
    setOpen(true);
    setActive(0);
    void search(text);
  }

  function pick(option: Lookup | null) {
    onChange(option ? { id: option.id, name: option.name } : null);
    setQuery(option?.name ?? "");
    setOpen(false);
  }

  return (
    <div className="relative flex flex-col gap-1">
      <Label htmlFor={`${id}-input`}>Project</Label>
      <div className="relative">
        <Input
          id={`${id}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          placeholder="No project"
          className="pr-11"
          value={query}
          onFocus={() => (open ? null : show(""))}
          onBlur={() => {
            // Leave the text matching what's picked.
            setOpen(false);
            setQuery(value?.name ?? "");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            show(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) show(query);
              else setActive((at) => Math.min(options.length - 1, at + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((at) => Math.max(0, at - 1));
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              pick(options[active] ?? null);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setQuery(value?.name ?? "");
            }
          }}
        />
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Projects"
        hidden={!open}
        className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-xl bg-popover p-1 shadow-lg ring-1 ring-border"
      >
        {options.map((option, index) => {
          const selected = option ? value?.id === option.id : !value;
          return (
            <li
              key={option?.id ?? "none"}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={selected}
              // Keep focus in the input so the list doesn't close before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(option)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2",
                index === active ? "bg-muted" : null,
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate", option ? null : "text-muted-foreground")}>{option?.name ?? "No project"}</span>
                {option?.client_name ? <span className="truncate text-sm text-muted-foreground">{option.client_name}</span> : null}
              </span>
              {selected ? <Check aria-hidden className="size-4 shrink-0 text-primary" /> : null}
            </li>
          );
        })}
        {results === null ? (
          <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
            Loading…
          </li>
        ) : failed ? (
          <li role="presentation" className="px-3 py-2 text-sm text-bad">
            Projects didn&apos;t load. Type again to retry.
          </li>
        ) : results.length === 0 && query.trim() ? (
          <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
            No projects match.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
