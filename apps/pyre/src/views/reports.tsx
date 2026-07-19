import { useMemo, useState } from "react";
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, CodeBlock, FieldGroup, Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle, Tabs, TabsContent, TabsList, TabsTrigger } from "@theaiplatform/miniapp-sdk/ui";
import { AlertTriangle, Check, Download, Eye, FileCode2, FileText, Globe2, LockKeyhole, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { auditMutation, buildReportMarkdown, canEdit, canReview, reportReadiness, runtimeId, timestamp, type Actor, type Investigation, type ReportRevision } from "../domain";
import { AddButton, EmptyPanel, EntityDialog, FormField, Metric, PermissionNotice, SectionHeader, SelectInput, StatusBadge } from "../ui-helpers";

interface Props { investigation: Investigation; actor: Actor; saving: boolean; onUpdate(next: Investigation, notice: string): Promise<boolean> }
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((value) => value.toString(16).padStart(2, "0")).join("");
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const renderHtml = (markdown: string, title: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.65 system-ui;max-width:800px;margin:48px auto;padding:0 24px;color:#17202a}h1,h2{line-height:1.2}h2{margin-top:2em;border-bottom:1px solid #ddd;padding-bottom:.3em}li{margin:.35em 0}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}h2{border-color:#444}}</style></head><body>${markdown.split("\n").map((line) => line.startsWith("# ") ? `<h1>${escape(line.slice(2))}</h1>` : line.startsWith("## ") ? `<h2>${escape(line.slice(3))}</h2>` : line.startsWith("- ") ? `<li>${escape(line.slice(2))}</li>` : line ? `<p>${escape(line).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</p>` : "").join("\n")}</body></html>`;
const download = (content: string, type: string, filename: string) => { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); };

export function ReportsView({ investigation, actor, saving, onUpdate }: Props) {
  const editable = canEdit(investigation, actor.id), reviewer = canReview(investigation, actor.id);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ReportRevision>();
  const [choice, setChoice] = useState({ visibility: "internal" as ReportRevision["visibility"], template: "engineering" as ReportRevision["template"] });
  const latestInternal = investigation.reports.filter((report) => report.visibility === "internal").toSorted((a, b) => b.number - a.number)[0];
  const latestPublic = investigation.reports.filter((report) => report.visibility === "public").toSorted((a, b) => b.number - a.number)[0];
  const blockers = useMemo(() => reportReadiness(investigation, choice.visibility), [choice.visibility, investigation]);
  const create = async () => {
    const markdown = buildReportMarkdown(investigation, choice.visibility), html = renderHtml(markdown, investigation.title);
    const number = Math.max(0, ...investigation.reports.map((report) => report.number)) + 1;
    const row: ReportRevision = { id: runtimeId("report"), number, createdAt: timestamp(), createdBy: actor.displayName, visibility: choice.visibility, template: choice.template, status: "draft", markdown, html, digest: await sha(`${markdown}\n${html}`) };
    const reports = investigation.reports.map((report) => report.visibility === row.visibility && report.status === "draft" ? { ...report, status: "superseded" as const } : report);
    if (await onUpdate(auditMutation({ ...investigation, reports: [...reports, row] }, actor.id, "report.created", "report", row.id, `${row.visibility} report revision ${row.number} created`), "Report revision created from current structured state.")) { setOpen(false); setPreview(row); }
  };
  const approve = async (report: ReportRevision) => {
    const currentBlockers = reportReadiness(investigation, report.visibility);
    if (currentBlockers.length) return;
    const at = timestamp();
    const reports = investigation.reports.map((item) => item.id === report.id ? { ...item, status: "approved" as const, approvedBy: actor.displayName, approvedAt: at } : item);
    await onUpdate(auditMutation({ ...investigation, reports }, actor.id, "report.approved", "report", report.id, `${report.visibility} revision ${report.number} approved`), "Report revision approved.");
  };
  const reopen = async (report: ReportRevision) => {
    const markdown = buildReportMarkdown(investigation, report.visibility), html = renderHtml(markdown, investigation.title), number = Math.max(...investigation.reports.map((item) => item.number)) + 1;
    const row: ReportRevision = { ...report, id: runtimeId("report"), number, createdAt: timestamp(), createdBy: actor.displayName, status: "draft", approvedBy: undefined, approvedAt: undefined, publishedAt: undefined, publicationUrl: undefined, markdown, html, digest: await sha(`${markdown}\n${html}`) };
    const reports = investigation.reports.map((item) => item.id === report.id && item.status === "published" ? { ...item, status: "superseded" as const } : item);
    await onUpdate(auditMutation({ ...investigation, reports: [...reports, row] }, actor.id, "report.reopened", "report", row.id, `Revision ${number} created from immutable revision ${report.number}`), "New draft revision created; the historical report remains unchanged.");
  };
  return <div className="view-stack">
    <SectionHeader eyebrow="GOVERNED OUTPUT" title="Review & Reports" description="Internal and public variants are separate immutable revisions. Templates control presentation—not investigation truth." action={editable ? <AddButton onClick={() => setOpen(true)}>Create Revision</AddButton> : null} />
    <div className="metric-grid"><Metric value={investigation.reports.length} label="Revisions" /><Metric value={investigation.reports.filter((item) => item.status === "approved").length} label="Approved" tone="success" /><Metric value={latestInternal?.number || "—"} label="Latest internal" /><Metric value={latestPublic?.number || "—"} label="Latest public" /></div>
    <div className="report-variants"><ReportVariant title="Internal Incident Review" icon={<LockKeyhole aria-hidden="true" />} report={latestInternal} description="Complete evidence and causal analysis for authorized participants." reviewer={reviewer} editable={editable} blockers={latestInternal ? reportReadiness(investigation, "internal") : []} onPreview={setPreview} onApprove={approve} onReopen={reopen} /><ReportVariant title="Approved Public Postmortem" icon={<Globe2 aria-hidden="true" />} report={latestPublic} description="Separately reviewed content using only public-approved source material." reviewer={reviewer} editable={editable} blockers={latestPublic ? reportReadiness(investigation, "public") : []} onPreview={setPreview} onApprove={approve} onReopen={reopen} /></div>
    <Card className="publication-card"><CardHeader><CardTitle>Zephyr Cloud Publication</CardTitle><Badge variant="outline">Unavailable in SDK 0.2.0</Badge></CardHeader><CardContent><p>TAP SDK 0.2.0 does not expose Zephyr build or publication operations. Pyre therefore does not display a publish control or simulate a resulting URL. Approved report sources, HTML, digests, and revision history remain available for an authorized future publisher.</p></CardContent></Card>
    {!editable && !reviewer ? <PermissionNotice role={investigation.members.find((item) => item.id === actor.id)?.role} /> : null}
    <EntityDialog open={open} onOpenChange={setOpen} title="Create Report Revision" description="Render a new immutable source snapshot from the current structured investigation."><FieldGroup><div className="form-grid"><FormField id="report-visibility" label="Report variant"><SelectInput id="report-visibility" name="report-visibility" value={choice.visibility} onChange={(event) => setChoice({ ...choice, visibility: event.target.value as ReportRevision["visibility"] })}><option value="internal">Internal</option><option value="public">Public</option></SelectInput></FormField><FormField id="report-template" label="Template"><SelectInput id="report-template" name="report-template" value={choice.template} onChange={(event) => setChoice({ ...choice, template: event.target.value as ReportRevision["template"] })}><option value="engineering">Engineering review</option><option value="executive">Executive summary</option><option value="internal-review">Internal review</option><option value="public-postmortem">Public postmortem</option></SelectInput></FormField></div><div className="readiness-box"><strong>Approval readiness</strong>{blockers.length ? <ul>{blockers.map((blocker) => <li key={blocker}><AlertTriangle aria-hidden="true" />{blocker}</li>)}</ul> : <p><Check aria-hidden="true" />Ready for reviewer approval after generation.</p>}</div><Alert><AlertDescription>You may generate a draft with unresolved items; Pyre preserves those items in the report. Approval remains gated.</AlertDescription></Alert><div className="dialog-actions"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void create()}><FileText aria-hidden="true" />Create Draft Revision</Button></div></FieldGroup></EntityDialog>
    <EntityDialog open={Boolean(preview)} onOpenChange={(next) => { if (!next) setPreview(undefined); }} title={preview ? `${preview.visibility === "public" ? "Public" : "Internal"} Report · Revision ${preview.number}` : "Report Preview"} description={preview ? `SHA-256 ${preview.digest.slice(0, 20)}… · ${preview.status}` : ""}>{preview ? <Tabs defaultValue="preview"><TabsList variant="line"><TabsTrigger value="preview">Rendered</TabsTrigger><TabsTrigger value="markdown">Markdown</TabsTrigger></TabsList><TabsContent value="preview"><article className="html-report" dangerouslySetInnerHTML={{ __html: preview.html.match(/<body>([\s\S]*)<\/body>/)?.[1] || "" }} /></TabsContent><TabsContent value="markdown"><CodeBlock language="markdown" code={preview.markdown} /></TabsContent><div className="dialog-actions"><Button variant="outline" onClick={() => download(preview.markdown, "text/markdown", `${investigation.id}-r${preview.number}.md`)}><Download aria-hidden="true" />Markdown</Button><Button variant="outline" onClick={() => download(preview.html, "text/html", `${investigation.id}-r${preview.number}.html`)}><FileCode2 aria-hidden="true" />HTML</Button><Button onClick={() => setPreview(undefined)}>Done</Button></div></Tabs> : null}</EntityDialog>
  </div>;
}

function ReportVariant({ title, icon, report, description, reviewer, editable, blockers, onPreview, onApprove, onReopen }: { title: string; icon: React.ReactNode; report?: ReportRevision; description: string; reviewer: boolean; editable: boolean; blockers: string[]; onPreview(report: ReportRevision): void; onApprove(report: ReportRevision): Promise<void>; onReopen(report: ReportRevision): Promise<void> }) {
  return <Card>
    <CardHeader>
      <div className="report-icon">{icon}</div>
      <div><CardTitle>{title}</CardTitle><p>{description}</p></div>
      {report ? <StatusBadge value={report.status} /> : null}
    </CardHeader>
    <CardContent>
      {report ? <>
        <div className="report-meta">
          <span>Revision {report.number}</span>
          <span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.createdAt))}</span>
          <code>{report.digest.slice(0, 12)}…</code>
        </div>
        {blockers.length > 0 && report.status === "draft" ? <ul className="mini-blockers">{blockers.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        <div className="card-actions">
          <Button size="sm" variant="outline" onClick={() => onPreview(report)}><Eye aria-hidden="true" />Preview</Button>
          {reviewer && report.status === "draft" ? <Button size="sm" disabled={blockers.length > 0} onClick={() => { void onApprove(report); }}><ShieldCheck aria-hidden="true" />Approve</Button> : null}
          {editable && report.status === "published" ? <Button size="sm" variant="outline" onClick={() => { void onReopen(report); }}><RotateCcw aria-hidden="true" />New Revision</Button> : null}
        </div>
      </> : <EmptyPanel title="No Report Revision" description="Create a governed draft from the current investigation state." />}
    </CardContent>
  </Card>;
}
