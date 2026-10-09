"use client";

import { useState } from "react";
import { readAppearance, saveAppearance, TEXT_SIZES, THEMES, type TextSize, type Theme } from "@/lib/appearance";

const THEME_LABEL: Record<Theme, string> = { system: "Match phone", light: "Light", dark: "Dark" };
const TEXT_LABEL: Record<TextSize, string> = { normal: "Normal", large: "Large", larger: "Larger" };

/** Theme and text size (D38), on this phone only. */
export function AppearanceCard() {
  const [value, setValue] = useState(readAppearance);
  const choose = (next: typeof value) => {
    setValue(next);
    saveAppearance(next);
  };
  return (
    <section aria-labelledby="appearance" className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card">
      <h2 id="appearance">Appearance</h2>
      <Choice legend="Theme" options={THEMES} labels={THEME_LABEL} value={value.theme} onChange={(theme) => choose({ ...value, theme })} />
      <Choice legend="Text size" options={TEXT_SIZES} labels={TEXT_LABEL} value={value.text} onChange={(text) => choose({ ...value, text })} />
    </section>
  );
}

function Choice<T extends string>({
  legend,
  options,
  labels,
  value,
  onChange,
}: {
  legend: string;
  options: T[];
  labels: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="caption mb-1 font-semibold text-muted-foreground">{legend}</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {options.map((option) => (
          <label
            key={option}
            className="flex min-h-11 cursor-pointer items-center justify-center rounded-md text-center font-medium has-[:checked]:bg-card has-[:checked]:shadow-card has-[:focus-visible]:outline-2"
          >
            <input type="radio" name={legend} className="sr-only" checked={value === option} onChange={() => onChange(option)} />
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
