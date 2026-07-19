import { useMemo, useState } from "react";
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, FieldGroup, Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle, Progress, Separator } from "@theaiplatform/miniapp-sdk/ui";
import { AlertTriangle, CheckCircle2, File, FileCode2, Fingerprint, Link2, LockKeyhole, Search, ShieldAlert, UploadCloud } from "lucide-react";
import { auditMutation, canEdit, runtimeId, splitList, timestamp, type Actor, type Evidence, type Investigation } from "../domain";
import { captureEvidenceFile, type PlatformContext } from "../platform";
import { AddButton, EmptyPanel, EntityDialog, FormField, Metric, PermissionNotice, SectionHeader, SelectInput, StatusBadge, TextAreaInput, TextInput } from "../ui-helpers";

interface Props { investigation: Investigation; actor: Actor; saving: boolean; context: PlatformContext; onUpdate(next: Investigation, notice: string): Promise<boolean> }
const digestBytes = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer))).map((value) => value.toString(16).padStart(2, "0")).join("");

export function EvidenceView({ investigation, actor, saving, context, onUpdate }: Props) {
  const editable = canEdit(investigation, actor.id);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [formError, setFormError] = useState<string>();
  const [file, setFile] = useState<File>();
  const [form, setForm] = useState({ title: "", kind: "log" as Evidence["kind"], source: "", description: "", visibility: "investigation" as Evidence["visibility"], reliability: "", systems: "", incidentFrom: "", incidentTo: "" });
  const filtered = useMemo(() => investigation.evidence.filter((item) => `${item.title} ${item.description} ${item.source} ${item.systems.join(" ")}`.toLowerCase().includes(filter.toLowerCase())), [filter, investigation.evidence]);
  const captured = investigation.evidence.filter((item) => item.collectionStatus === "captured").length;
  const restricted = investigation.evidence.filter((item) => item.visibility === "restricted").length;
  const linked = investigation.evidence.filter((item) => item.supportsClaimIds.length || item.contradictsClaimIds.length || item.timelineEventIds.length).length;

  const create = async () => {
    if (!form.title.trim() || (!form.source.trim() && !file)) { setFormError("Enter a title and either a stable source locator or a file."); return; }
    setFormError(undefined);
    const evidenceId = runtimeId("evidence");
    const collectedAt = timestamp();
    const bytes = file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(`${form.source}\n${form.description}`);
    const digest = await digestBytes(bytes);
    const base: Evidence = {
      id: evidenceId, title: form.title.trim(), kind: file ? "file" : form.kind, source: form.source.trim() || `file:${file!.name}`,
      description: form.description.trim(), collectedAt, collectedBy: actor.displayName,
      incidentFrom: form.incidentFrom || undefined, incidentTo: form.incidentTo || undefined, visibility: form.visibility,
      digest, mimeType: file?.type || undefined, sizeBytes: file?.size, reliability: form.reliability.trim(), systems: splitList(form.systems),
      supportsClaimIds: [], contradictsClaimIds: [], timelineEventIds: [], immutableSnapshot: false,
      collectionStatus: file ? "failed" : "reference",
    };
    let row = base;
    if (file && !context.preview) {
      try {
        const receipt = { sourceSystem: "user-upload", locator: file.name, collectionTime: collectedAt, incidentTimeRange: { from: form.incidentFrom || null, to: form.incidentTo || null }, collector: actor.id, contentDigest: digest, mimeType: file.type || "application/octet-stream", visibility: form.visibility, accessDecision: "explicit user upload", sizeBytes: file.size };
        const paths = await captureEvidenceFile(investigation, context, evidenceId, file.name, bytes, receipt);
        row = { ...base, ...paths, immutableSnapshot: true, collectionStatus: "captured" };
      } catch (reason) {
        setFormError(`File capture failed. Nothing was reported as collected. ${String(reason)}`);
        return;
      }
    }
    if (file && context.preview) row = { ...base, collectionStatus: "reference", source: `preview-file:${file.name}` };
    const next = auditMutation({ ...investigation, evidence: [...investigation.evidence, row] }, actor.id, "evidence.created", "evidence", row.id, `${row.title} (${row.collectionStatus})`);
    if (await onUpdate(next, row.collectionStatus === "captured" ? "Evidence and receipt captured in VFS." : "Evidence reference saved.")) {
      setOpen(false); setFile(undefined); setForm({ title: "", kind: "log", source: "", description: "", visibility: "investigation", reliability: "", systems: "", incidentFrom: "", incidentTo: "" });
    }
  };

  return <div className="view-stack">
    <SectionHeader eyebrow="SOURCE MATERIAL" title="Evidence Library" description="Primary evidence remains separate from interpretation. Captured files receive content digests and sidecar receipts." action={editable ? <AddButton onClick={() => setOpen(true)}>Add Evidence</AddButton> : null} />
    <div className="metric-grid"><Metric value={investigation.evidence.length} label="Catalogued" /><Metric value={captured} label="VFS snapshots" tone={captured ? "success" : "neutral"} /><Metric value={linked} label="Linked to analysis" /><Metric value={restricted} label="Restricted" tone={restricted ? "warning" : "neutral"} /></div>
    <div className="toolbar-row"><div className="search-field"><Search aria-hidden="true" /><TextInput aria-label="Search evidence" name="evidence-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search evidence…" /></div><span className="quiet">{filtered.length} of {investigation.evidence.length}</span></div>
    {filtered.length ? <div className="evidence-grid">{filtered.map((item) => <EvidenceCard key={item.id} item={item} investigation={investigation} actor={actor} editable={editable} onUpdate={onUpdate} />)}</div> : <EmptyPanel icon="archive" title={investigation.evidence.length ? "No Matching Evidence" : "Evidence Library Is Empty"} description={investigation.evidence.length ? "Change the search text to see other evidence." : "Add a stable reference or capture a file into the incident VFS workspace."} action={editable && !investigation.evidence.length ? <Button onClick={() => setOpen(true)}><UploadCloud aria-hidden="true" />Add First Evidence</Button> : undefined} />}
    {!editable ? <PermissionNotice role={investigation.members.find((item) => item.id === actor.id)?.role} /> : null}
    <EntityDialog open={open} onOpenChange={setOpen} title="Add Evidence" description="Reference an authorized source or capture a user-selected file. Pyre never claims a reference was fetched."><FieldGroup>
      <FormField id="evidence-title" label="Evidence title"><TextInput id="evidence-title" name="evidence-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Gateway error log window…" /></FormField>
      <div className="form-grid"><FormField id="evidence-kind" label="Source type"><SelectInput id="evidence-kind" name="evidence-kind" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as Evidence["kind"] })}>{["log", "alert", "screenshot", "metric", "ticket", "code", "message", "testimony", "api-result"].map((kind) => <option key={kind} value={kind}>{kind.replace("-", " ")}</option>)}</SelectInput></FormField><FormField id="evidence-visibility" label="Visibility"><SelectInput id="evidence-visibility" name="evidence-visibility" value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value as Evidence["visibility"] })}><option value="investigation">Investigation members</option><option value="restricted">Restricted</option><option value="public-approved">Approved for public report</option></SelectInput></FormField></div>
      <FormField id="evidence-source" label="Source URL or stable locator" hint="Required when no file is selected"><TextInput id="evidence-source" name="evidence-source" type="url" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="https://logs.example.com/query/…" /></FormField>
      <FormField id="evidence-file" label="Capture file" hint={context.preview ? "Preview mode records metadata only. Packaged TAP execution writes the file and receipt to VFS." : "Selected files are written to the provisioned incident VFS workspace."}><input className="file-input" id="evidence-file" name="evidence-file" type="file" onChange={(event) => setFile(event.target.files?.[0])} /></FormField>
      <FormField id="evidence-description" label="Description"><TextAreaInput id="evidence-description" name="evidence-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Bounded export covering…" /></FormField>
      <div className="form-grid"><FormField id="evidence-from" label="Incident range start"><TextInput id="evidence-from" name="evidence-from" type="datetime-local" value={form.incidentFrom} onChange={(event) => setForm({ ...form, incidentFrom: event.target.value })} /></FormField><FormField id="evidence-to" label="Incident range end"><TextInput id="evidence-to" name="evidence-to" type="datetime-local" value={form.incidentTo} onChange={(event) => setForm({ ...form, incidentTo: event.target.value })} /></FormField><FormField id="evidence-systems" label="Affected systems"><TextInput id="evidence-systems" name="evidence-systems" value={form.systems} onChange={(event) => setForm({ ...form, systems: event.target.value })} placeholder="checkout-api, gateway…" /></FormField><FormField id="evidence-reliability" label="Reliability notes"><TextInput id="evidence-reliability" name="evidence-reliability" value={form.reliability} onChange={(event) => setForm({ ...form, reliability: event.target.value })} placeholder="Complete export; clock synchronized…" /></FormField></div>
      {formError ? <Alert variant="destructive"><AlertTriangle aria-hidden="true" /><AlertDescription>{formError}</AlertDescription></Alert> : null}
      <div className="dialog-actions"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving || !form.title.trim()} onClick={() => void create()}><Fingerprint aria-hidden="true" />{saving ? "Saving…" : file ? "Capture Evidence" : "Save Reference"}</Button></div>
    </FieldGroup></EntityDialog>
  </div>;
}

function EvidenceCard({ item, investigation, actor, editable, onUpdate }: { item: Evidence; investigation: Investigation; actor: Actor; editable: boolean; onUpdate(next: Investigation, notice: string): Promise<boolean> }) {
  const [linksOpen, setLinksOpen] = useState(false);
  const [supporting, setSupporting] = useState(item.supportsClaimIds);
  const [contradicting, setContradicting] = useState(item.contradictsClaimIds);
  const [events, setEvents] = useState(item.timelineEventIds);
  const toggle = (items: string[], id: string) => items.includes(id) ? items.filter((itemId) => itemId !== id) : [...items, id];
  const icon = item.kind === "code" ? <FileCode2 aria-hidden="true" /> : item.visibility === "restricted" ? <LockKeyhole aria-hidden="true" /> : <File aria-hidden="true" />;
  return <Card className="evidence-card"><CardHeader><div className="evidence-icon">{icon}</div><div className="min-w-0"><CardTitle>{item.title}</CardTitle><p>{item.kind.replace("-", " ")} · {item.systems.join(", ") || "No system tagged"}</p></div><StatusBadge value={item.collectionStatus} /></CardHeader><CardContent><p className="evidence-description">{item.description || "No description provided."}</p><div className="evidence-meta"><span><Fingerprint aria-hidden="true" />SHA-256 <code>{item.digest.slice(0, 12)}…</code></span><span><Link2 aria-hidden="true" />{item.supportsClaimIds.length + item.contradictsClaimIds.length + item.timelineEventIds.length} analysis links</span></div><div className="tag-row"><Badge variant="outline">{item.visibility}</Badge>{item.reliability ? <Badge variant="secondary">{item.reliability}</Badge> : null}</div><Separator /><div className="card-actions"><Button size="sm" variant="ghost" onClick={() => setLinksOpen(true)} disabled={!editable}>Link to Analysis</Button>{item.vfsPath ? <span className="quiet">VFS snapshot</span> : <span className="quiet">Source reference</span>}</div></CardContent>
    <EntityDialog open={linksOpen} onOpenChange={setLinksOpen} title="Link Evidence" description="Connect this evidence to causal claims and timeline events. Support and contradiction are distinct interpretations."><FieldGroup><fieldset className="check-list"><legend>Supports causal claims</legend>{investigation.whys.length ? investigation.whys.map((node) => <label key={node.id}><input type="checkbox" checked={supporting.includes(node.id)} onChange={() => setSupporting(toggle(supporting, node.id))} /><span>{node.answer}</span></label>) : <small>No causal claims exist yet.</small>}</fieldset><fieldset className="check-list"><legend>Contradicts causal claims</legend>{investigation.whys.length ? investigation.whys.map((node) => <label key={node.id}><input type="checkbox" checked={contradicting.includes(node.id)} onChange={() => setContradicting(toggle(contradicting, node.id))} /><span>{node.answer}</span></label>) : <small>No causal claims exist yet.</small>}</fieldset><fieldset className="check-list"><legend>Supports timeline events</legend>{investigation.timeline.length ? investigation.timeline.map((event) => <label key={event.id}><input type="checkbox" checked={events.includes(event.id)} onChange={() => setEvents(toggle(events, event.id))} /><span>{event.description}</span></label>) : <small>No timeline events exist yet.</small>}</fieldset><div className="dialog-actions"><Button variant="outline" onClick={() => setLinksOpen(false)}>Cancel</Button><Button onClick={async () => { const nextEvidence = investigation.evidence.map((evidence) => evidence.id === item.id ? { ...evidence, supportsClaimIds: supporting, contradictsClaimIds: contradicting, timelineEventIds: events } : evidence); const nextWhys = investigation.whys.map((node) => ({ ...node, supportingEvidenceIds: supporting.includes(node.id) ? [...new Set([...node.supportingEvidenceIds, item.id])] : node.supportingEvidenceIds.filter((id) => id !== item.id), contradictingEvidenceIds: contradicting.includes(node.id) ? [...new Set([...node.contradictingEvidenceIds, item.id])] : node.contradictingEvidenceIds.filter((id) => id !== item.id) })); const nextTimeline = investigation.timeline.map((event) => ({ ...event, evidenceIds: events.includes(event.id) ? [...new Set([...event.evidenceIds, item.id])] : event.evidenceIds.filter((id) => id !== item.id) })); const next = auditMutation({ ...investigation, evidence: nextEvidence, whys: nextWhys, timeline: nextTimeline }, actor.id, "evidence.linked", "evidence", item.id, `Updated ${supporting.length + contradicting.length + events.length} evidence links`); if (await onUpdate(next, "Evidence links saved.")) setLinksOpen(false); }}><CheckCircle2 aria-hidden="true" />Save Links</Button></div></FieldGroup></EntityDialog>
  </Card>;
}
