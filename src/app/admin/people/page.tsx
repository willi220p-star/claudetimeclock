import type { Metadata } from "next";
import { Suspense } from "react";
import { PeopleScreen } from "@/app/admin/people/people-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "People",
};

export default function PeoplePage() {
  return (
    <Suspense fallback={<Opening label="Opening people…" />}>
      <PeopleScreen />
    </Suspense>
  );
}
