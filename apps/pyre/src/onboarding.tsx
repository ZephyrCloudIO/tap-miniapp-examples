import { useState } from "react";
import { Alert, AlertDescription, Button, Card, CardContent, FieldGroup, H1, Progress } from "@theaiplatform/miniapp-sdk/ui";
import { ArrowRight, CheckCircle2, Flame, LockKeyhole, Network, ShieldCheck } from "lucide-react";
import { runtimeId, splitList, timestamp, validateIncident, validateSourceLinks, type Actor, type Investigation, type PyreState } from "./domain";
import { FormField, SelectInput, TextAreaInput, TextInput } from "./ui-helpers";

interface IntakeForm {
  title: string;
  statement: string;
  impact: string;
  businessImpact: string;
  severity: Investigation["severity"];
  start: string;
  detected: string;
  systems: string;
  regions: string;
  sourceLinks: string;
}

const initial: IntakeForm = { title: "", statement: "", impact: "", businessImpact: "", severity: "unassessed", start: "", detected: "", systems: "", regions: "", sourceLinks: "" };

export function Onboarding({ state, actor, saving, error, onCreate }: { state: PyreState; actor: Actor; saving: boolean; error?: string; onCreate(incident: Investigation): Promise<boolean> }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const next = () => {
    const nextErrors = validateIncident({ title: form.title, statement: form.statement, impact: form.impact });
    setErrors(nextErrors);
    if (!nextErrors.length) setStep(2);
  };
  const create = async () => {
    const sourceLinks = splitList(form.sourceLinks);
    const linkErrors = validateSourceLinks(sourceLinks);
    setErrors(linkErrors);
    if (linkErrors.length) return;
    const at = timestamp();
    const incidentId = runtimeId("inc");
    const incident: Investigation = {
      schemaVersion: 2,
      id: incidentId,
      title: form.title.trim(),
      statement: form.statement.trim(),
      severity: form.severity,
      status: "investigating",
      impact: form.impact.trim(),
      businessImpact: form.businessImpact.trim(),
      systems: splitList(form.systems),
      regions: splitList(form.regions),
      times: { start: form.start || undefined, detected: form.detected || undefined },
      sourceLinks,
      phase: "intake",
      createdAt: at,
      updatedAt: at,
      createdBy: actor.id,
      members: [{ id: actor.id, displayName: actor.displayName, role: "lead", joinedAt: at }],
      evidence: [], timeline: [], whys: [], actions: [], questions: [], decisions: [], reports: [],
      audit: [{ id: runtimeId("audit"), at, actorId: actor.id, action: "investigation.created", entityType: "investigation", entityId: incidentId, summary: "Draft intake created" }],
      revision: 1,
      bindings: {},
    };
    await onCreate(incident);
  };

  return <main id="main-content" className="onboarding-page">
    <section className="onboarding-story" aria-labelledby="onboarding-title">
      <div className="pyre-mark"><Flame aria-hidden="true" /><span>PYRE</span></div>
      <div>
        <span className="eyebrow">BLAMELESS INCIDENT INVESTIGATION</span>
        <H1 id="onboarding-title">Turn uncertainty into durable learning.</H1>
        <p className="onboarding-lede">Build a factual timeline, test competing explanations against evidence, and leave every conclusion reviewable.</p>
      </div>
      <div className="principle-list">
        <div><ShieldCheck aria-hidden="true" /><span><strong>Evidence before conclusions</strong><small>Every material claim stays connected to its source.</small></span></div>
        <div><Network aria-hidden="true" /><span><strong>Branches, not a single story</strong><small>Keep alternative explanations visible until evidence rules them out.</small></span></div>
        <div><LockKeyhole aria-hidden="true" /><span><strong>Governed by default</strong><small>Human approvals, visibility controls, and immutable revisions.</small></span></div>
      </div>
      <p className="quiet">{state.investigations.length ? `${state.investigations.length} existing investigation${state.investigations.length === 1 ? "" : "s"} available after setup.` : "Your workspace starts empty. No example incidents or records are installed."}</p>
    </section>
    <Card className="intake-card">
      <CardContent>
        <div className="step-heading"><div><span className="eyebrow">NEW INVESTIGATION</span><h2>{step === 1 ? "Describe the observed incident" : "Set the initial scope"}</h2></div><span className="step-count">{step} / 2</span></div>
        <Progress value={step * 50} aria-label={`Intake step ${step} of 2`} />
        {step === 1 ? <FieldGroup>
          <FormField id="incident-title" label="Incident title" error={errors.find((item) => item.includes("title"))}><TextInput id="incident-title" name="incident-title" value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="Checkout requests returning 503…" /></FormField>
          <FormField id="problem-statement" label="Observable problem statement" error={errors.find((item) => item.includes("observable"))} hint="Describe what was observed. Avoid assigning cause or blame."><TextAreaInput id="problem-statement" name="problem-statement" value={form.statement} onChange={(event) => set("statement", event.target.value)} placeholder="Customers received HTTP 503 responses while…" /></FormField>
          <FormField id="customer-impact" label="Customer impact" error={errors.find((item) => item.includes("impact"))}><TextAreaInput id="customer-impact" name="customer-impact" value={form.impact} onChange={(event) => set("impact", event.target.value)} placeholder="Customers could not complete…" /></FormField>
          <FormField id="business-impact" label="Business impact" hint="Optional until established"><TextAreaInput id="business-impact" name="business-impact" value={form.businessImpact} onChange={(event) => set("businessImpact", event.target.value)} placeholder="Order volume decreased…" /></FormField>
          <Button type="button" onClick={next}>Continue to Scope <ArrowRight aria-hidden="true" /></Button>
        </FieldGroup> : <FieldGroup>
          <div className="form-grid">
            <FormField id="severity" label="Severity"><SelectInput id="severity" name="severity" value={form.severity} onChange={(event) => set("severity", event.target.value as Investigation["severity"])}><option value="unassessed">Unassessed</option><option>SEV-1</option><option>SEV-2</option><option>SEV-3</option><option>SEV-4</option></SelectInput></FormField>
            <FormField id="systems" label="Affected systems"><TextInput id="systems" name="systems" value={form.systems} onChange={(event) => set("systems", event.target.value)} placeholder="checkout-api, payment-router…" /></FormField>
            <FormField id="regions" label="Affected regions"><TextInput id="regions" name="regions" value={form.regions} onChange={(event) => set("regions", event.target.value)} placeholder="us-east-1, eu-west-1…" /></FormField>
            <FormField id="source-links" label="Source links" hint="Optional; separate multiple HTTP(S) URLs with commas" error={errors.find((item) => item.includes("Source link"))}><TextInput id="source-links" name="source-links" value={form.sourceLinks} onChange={(event) => set("sourceLinks", event.target.value)} placeholder="https://status.example.com/incidents/…" /></FormField>
            <FormField id="start-time" label="Incident start"><TextInput id="start-time" name="start-time" type="datetime-local" value={form.start} onChange={(event) => set("start", event.target.value)} /></FormField>
            <FormField id="detected-time" label="Detection time"><TextInput id="detected-time" name="detected-time" type="datetime-local" value={form.detected} onChange={(event) => set("detected", event.target.value)} /></FormField>
          </div>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button><Button type="button" onClick={() => void create()} disabled={saving}>{saving ? "Creating…" : <><CheckCircle2 aria-hidden="true" />Create Investigation</>}</Button></div>
        </FieldGroup>}
      </CardContent>
    </Card>
  </main>;
}
