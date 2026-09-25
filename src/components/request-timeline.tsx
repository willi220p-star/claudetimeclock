import { cn } from "@/lib/utils";
import { requestTimeline } from "@/lib/placement-ui";

const STEP_LABEL: Record<string, string> = {
  submitted: "Submitted",
  supervisor: "Supervisor",
  admin: "Admin",
  outcome: "Outcome",
};

const ORDER = ["submitted", "supervisor", "admin", "outcome"];

export function RequestTimeline({ status, extraSpot }: { status: string; extraSpot: boolean }) {
  const { steps, current } = requestTimeline(status, extraSpot);
  const currentIndex = steps.indexOf(current);
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Request status">
      {steps.map((step, index) => {
        const done = index < currentIndex || (current === "outcome" && index <= currentIndex);
        const here = step === current && current !== "outcome" ? true : current === "outcome" && step === "outcome";
        return (
          <li
            key={step}
            data-step={step}
            className={cn(
              "rounded-[2.75px] px-2 py-0.5 text-xs font-semibold",
              here ? "bg-primary text-primary-foreground" : done ? "bg-ok-bg text-ok" : "bg-muted text-muted-foreground",
            )}
          >
            {STEP_LABEL[step] ?? step}
          </li>
        );
      })}
    </ol>
  );
}

export function timelineHasAdmin(status: string, extraSpot: boolean) {
  return requestTimeline(status, extraSpot).steps.includes("admin");
}

export { ORDER as TIMELINE_ORDER };
