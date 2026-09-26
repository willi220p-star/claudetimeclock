import type { Metadata } from "next";
import { Suspense } from "react";
import { Opening } from "@/components/desk-gate";
import { RosterScreen } from "@/components/roster";

export const metadata: Metadata = {
  title: "Roster",
};

export default function RosterPage() {
  return (
    <Suspense fallback={<Opening label="Opening the roster…" />}>
      <RosterScreen role="supervisor" />
    </Suspense>
  );
}
