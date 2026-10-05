import type { Metadata } from "next";
import { Suspense } from "react";
import { Opening } from "@/components/desk-gate";
import { TimesheetsScreen } from "@/components/timesheets";

export const metadata: Metadata = {
  title: "Timesheets",
};

export default function TimesheetsPage() {
  return (
    <Suspense fallback={<Opening label="Opening timesheets…" />}>
      <TimesheetsScreen role="supervisor" />
    </Suspense>
  );
}
