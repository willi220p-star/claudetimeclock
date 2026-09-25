// Loaded only by a download click (dynamic import), so react-pdf and its yoga WebAssembly stay
// out of first load. Layout only: every string comes from src/lib/report.ts.
import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { CertificateModel, ReportModel } from "@/lib/report";
import { PDF_COLORS as C } from "@/lib/pdf-theme";

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontFamily: "Helvetica", fontSize: 9, color: C.navy },
  row: { flexDirection: "row" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 18 },
  muted: { color: C.stone },
  bold: { fontFamily: "Helvetica-Bold" },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 16, marginBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", borderTop: `1 solid ${C.sand}`, paddingTop: 8 },
  field: { width: "50%", marginBottom: 6 },
  label: { fontSize: 7.5, color: C.stone, textTransform: "uppercase", marginBottom: 1 },
  th: { flexDirection: "row", backgroundColor: C.mist, fontFamily: "Helvetica-Bold", paddingVertical: 4 },
  tr: { flexDirection: "row", borderBottom: `0.5 solid ${C.sand}`, paddingVertical: 3 },
  total: { flexDirection: "row", fontFamily: "Helvetica-Bold", paddingVertical: 4 },
  cell: { paddingHorizontal: 4 },
  box: { border: `1 solid ${C.sand}`, borderRadius: 4, padding: 10, marginTop: 16 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7.5, color: C.stone, textAlign: "center" },
});

function Logo({ size }: { size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        border: `${size / 16} solid ${C.teal}`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: size * 0.3 }}>
        <Text style={{ color: C.teal }}>D</Text>
        <Text style={{ color: C.orange, fontFamily: "Times-Bold" }}>G</Text>
        <Text style={{ color: C.green }}>K</Text>
      </Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

const WEEK_COLS = ["8%", "22%", "17%", "17%", "16%", "10%", "10%"];
const DAY_COLS = ["20%", "12%", "40%", "28%"];

function Cells({ values, widths }: { values: string[]; widths: string[] }) {
  return values.map((value, i) => (
    <Text key={i} style={[s.cell, { width: widths[i] }]}>
      {value}
    </Text>
  ));
}

function ReportDocument({ m }: { m: ReportModel }) {
  return (
    <Document title={`Placement hours report — ${m.internName}`} author="DGK Business Consultancy" subject={m.documentId}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Logo size={44} />
          <View style={{ flexGrow: 1 }}>
            <Text style={s.title}>Placement hours report</Text>
            <Text style={s.muted}>DGK Business Consultancy · Palmerston City NT</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.bold}>Document {m.documentId}</Text>
            <Text style={s.muted}>Generated {m.generated}</Text>
          </View>
        </View>

        <View style={s.grid}>
          <Field label="Intern" value={m.internName} />
          <Field label="Status" value={m.status} />
          <Field label="University" value={m.university} />
          <Field label="Course" value={m.course} />
          <Field label="University coordinator" value={m.coordinator} />
          <Field label="Placement dates" value={`${m.dates.start} to ${m.dates.plannedEnd} (planned)`} />
          <Field label="Ended" value={m.dates.ended} />
          <Field label="Hours: counted / target" value={`${m.counted} / ${m.target}`} />
        </View>

        <Text style={s.h2}>Weekly hours</Text>
        <View style={s.th}>
          <Cells widths={WEEK_COLS} values={["Week", "Week starting", "Scheduled", "Counted", "Approved OT", "No-shows", "Late days"]} />
        </View>
        {m.weeks.map((w) => (
          <View key={w.starting} style={s.tr} wrap={false}>
            <Cells widths={WEEK_COLS} values={[w.week, w.starting, w.scheduled, w.counted, w.overtime, w.noShows, w.late]} />
          </View>
        ))}
        <View style={s.total} wrap={false}>
          <Cells
            widths={WEEK_COLS}
            values={["", "Total", m.totals.scheduled, m.totals.counted, m.totals.overtime, m.totals.noShows, m.totals.late]}
          />
        </View>

        <Text style={s.h2}>Daily detail</Text>
        <View style={s.th}>
          <Cells widths={DAY_COLS} values={["Day", "Counted", "How it was verified", "Overtime"]} />
        </View>
        {m.days.length === 0 ? <Text style={[s.cell, s.muted, { paddingVertical: 4 }]}>No worked days yet.</Text> : null}
        {m.days.map((d) => (
          <View key={d.date} style={s.tr} wrap={false}>
            <Cells widths={DAY_COLS} values={[d.date, d.counted, d.verification, d.overtime]} />
          </View>
        ))}

        <View style={s.box} wrap={false}>
          <Text style={s.label}>DGK supervisor approval</Text>
          <Text style={[s.bold, { color: m.approval.approved ? C.green : C.warn }]}>{m.approval.line}</Text>
          {m.approval.note ? <Text style={{ marginTop: 3 }}>Note: {m.approval.note}</Text> : null}
        </View>

        <View style={[s.box, { flexDirection: "row", gap: 24, paddingTop: 36 }]} wrap={false}>
          <View style={{ flexGrow: 2, borderTop: `1 solid ${C.navy}`, paddingTop: 3 }}>
            <Text style={s.muted}>University signature</Text>
          </View>
          <View style={{ flexGrow: 1, borderTop: `1 solid ${C.navy}`, paddingTop: 3 }}>
            <Text style={s.muted}>Date</Text>
          </View>
        </View>

        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Generated from DGK Clock on ${m.generated} · ${m.documentId} · Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

function CertificateDocument({ m }: { m: CertificateModel }) {
  return (
    <Document title={`Certificate of Completion — ${m.internName}`} author="DGK Business Consultancy" subject={m.documentId}>
      <Page size="A4" orientation="landscape" style={{ padding: 28, fontFamily: "Helvetica", color: C.navy, backgroundColor: C.cream }}>
        <View
          style={{
            flexGrow: 1,
            border: `3 solid ${C.teal}`,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 60,
          }}
        >
          <Logo size={80} />
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 32, marginTop: 20 }}>Certificate of Completion</Text>
          <Text style={{ fontSize: 12, color: C.stone, marginTop: 18 }}>This certifies that</Text>
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 28, marginTop: 8 }}>{m.internName}</Text>
          <Text style={{ fontSize: 13, marginTop: 12, textAlign: "center", lineHeight: 1.4 }}>{m.statement}</Text>
          <Text style={{ fontSize: 12, color: C.stone, marginTop: 6 }}>{m.dates}</Text>
          <View style={{ flexDirection: "row", gap: 80, marginTop: 44 }}>
            <View style={{ width: 200, borderTop: `1 solid ${C.navy}`, paddingTop: 4, alignItems: "center" }}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{m.supervisorName}</Text>
              <Text style={{ fontSize: 9, color: C.stone }}>Placement supervisor, DGK Business Consultancy</Text>
            </View>
            <View style={{ width: 200, borderTop: `1 solid ${C.navy}`, paddingTop: 4, alignItems: "center" }}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{m.issued}</Text>
              <Text style={{ fontSize: 9, color: C.stone }}>Date issued</Text>
            </View>
          </View>
          <Text style={{ position: "absolute", bottom: 12, fontSize: 8, color: C.stone }}>Document {m.documentId}</Text>
        </View>
      </Page>
    </Document>
  );
}

export function reportBlob(model: ReportModel) {
  return pdf(<ReportDocument m={model} />).toBlob();
}

export function certificateBlob(model: CertificateModel) {
  return pdf(<CertificateDocument m={model} />).toBlob();
}
