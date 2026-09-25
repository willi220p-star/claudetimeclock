"use client";

import { AdminDesk } from "@/app/admin/admin-desk";
import { AdminFrame } from "@/app/admin/admin-frame";

export function PeopleScreen() {
  return <AdminFrame title="People">{(profile) => <AdminDesk profile={profile} />}</AdminFrame>;
}
