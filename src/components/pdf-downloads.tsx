"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { loadReportData } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { buildCertificateModel, buildReportModel, certificateBlocker, documentId } from "@/lib/report";

type Kind = "report" | "certificate";

/**
 * Uni report and certificate downloads (§13). The PDF is built in the browser from the caller's
 * RLS-visible data; react-pdf loads only on click. `report` hides the report button (the intern
 * sees it only after approval).
 */
export function PdfDownloads({
  placementId,
  status,
  reportApprovedAt,
  report = true,
}: {
  placementId: string;
  status: string;
  reportApprovedAt: string | null;
  report?: boolean;
}) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const blocker = certificateBlocker({ status, report_approved_at: reportApprovedAt });

  async function download(kind: Kind) {
    setBusy(kind);
    try {
      const generatedAt = new Date();
      const [data, id, docs] = await Promise.all([
        loadReportData(placementId),
        documentId(placementId, generatedAt),
        import("@/components/pdf/documents"),
      ]);
      const input = { ...data, generatedAt, documentId: id };
      const blob =
        kind === "report"
          ? await docs.reportBlob(buildReportModel(input))
          : await docs.certificateBlob(buildCertificateModel(input));
      const name = data.internName.replace(/[^A-Za-z0-9]+/g, "-");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${kind === "report" ? "Hours-report" : "Certificate"}-${name}-${id}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch (error) {
      toast.error(errorText(error, "The PDF didn't build. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {report ? (
          <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void download("report")}>
            {busy === "report" ? "Building PDF…" : "Download report (PDF)"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null || blocker !== null}
          aria-describedby={blocker ? `certificate-blocker-${placementId}` : undefined}
          onClick={() => void download("certificate")}
        >
          {busy === "certificate" ? "Building PDF…" : "Download certificate (PDF)"}
        </Button>
      </div>
      {blocker ? (
        <p id={`certificate-blocker-${placementId}`} className="text-sm text-muted-foreground">
          {blocker}
        </p>
      ) : null}
    </div>
  );
}
