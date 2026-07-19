import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  H3,
  Icon,
  Input,
  NativeSelect,
  Textarea,
} from '@theaiplatform/miniapp-sdk/ui';
import { AlertCircle } from 'lucide-react';
import {
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  addAdverseEvent,
  addConfounder,
  addItem,
  addLot,
  addOrder,
  addOutcome,
  addReconstitution,
  addSavedView,
  addScheduleVersion,
  recordAdministration,
  type AdministrationStatus,
  type Category,
  type LedgerState,
  type OrderStatus,
} from './domain';

export type EntryKind =
  | 'item'
  | 'schedule'
  | 'administration'
  | 'check-in'
  | 'lot'
  | 'order'
  | 'reconstitution'
  | 'outcome'
  | 'confounder'
  | 'adverse'
  | 'view'
  | null;

const today = (): string => new Date().toISOString().slice(0, 10);
const nowLocal = (): string => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const text = (form: FormData, key: string): string =>
  String(form.get(key) ?? '').trim();
const number = (form: FormData, key: string): number => Number(form.get(key));

interface EntryDialogProps {
  readonly kind: EntryKind;
  readonly state: LedgerState;
  readonly targetItemId?: string;
  readonly targetLotId?: string;
  readonly onClose: () => void;
  readonly onSubmit: (
    operation: (state: LedgerState) => LedgerState,
    message: string,
  ) => Promise<string | null>;
}

const titles: Record<Exclude<EntryKind, null>, string> = {
  item: 'Add Regimen Item',
  schedule: 'Create Schedule Period',
  administration: 'Record Administration',
  'check-in': 'Check In With Yourself',
  lot: 'Add Inventory Lot',
  order: 'Add Order',
  reconstitution: 'Record Reconstitution',
  outcome: 'Record Outcome',
  confounder: 'Add Timeline Context',
  adverse: 'Record Adverse Event',
  view: 'Save Research View',
};

const descriptions: Record<Exclude<EntryKind, null>, string> = {
  item: 'Enter the item exactly as it appears in your source record. The app will not alter or recommend a dose.',
  schedule:
    'A new effective period preserves the prior schedule instead of rewriting your history.',
  administration:
    'Confirm what actually occurred. Planned records never become administrations automatically.',
  'check-in':
    'Capture one feeling or symptom on a 0–10 scale so you can notice change over time.',
  lot: 'Track one physical lot or container, including provenance and expiration.',
  order:
    'Record shipment progress and factual provenance. The ledger never reorders automatically.',
  reconstitution:
    'Document confirmed values from an authoritative source. The ledger does not generate a recipe.',
  outcome: 'Record an observation or measurement without assigning causation.',
  confounder:
    'Add illness, travel, diet, training, sleep, or another event that may matter during review.',
  adverse:
    'Document timing and severity. For serious or worsening symptoms, seek appropriate help now.',
  view: 'Save evidence scope preferences for use with a reviewed research connector.',
};

export function EntryDialog({
  kind,
  state,
  targetItemId,
  targetLotId,
  onClose,
  onSubmit,
}: EntryDialogProps) {
  if (!kind) return null;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="entry-dialog"
        aria-describedby="entry-dialog-description"
      >
        <DialogHeader className="dialog-heading">
          <span className="dialog-kicker">Private Ledger Entry</span>
          <DialogTitle>{titles[kind]}</DialogTitle>
          <DialogDescription id="entry-dialog-description">
            {descriptions[kind]}
          </DialogDescription>
        </DialogHeader>
        <EntryForm
          kind={kind}
          state={state}
          {...(targetItemId ? { targetItemId } : {})}
          {...(targetLotId ? { targetLotId } : {})}
          onCancel={onClose}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

interface EntryFormProps extends Omit<EntryDialogProps, 'kind' | 'onClose'> {
  readonly kind: Exclude<EntryKind, null>;
  readonly onCancel: () => void;
}

function EntryForm({
  kind,
  state,
  targetItemId,
  targetLotId,
  onCancel,
  onSubmit,
}: EntryFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const submitOperation = async (
    operation: (current: LedgerState) => LedgerState,
    message: string,
  ) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const operationError = await onSubmit(operation, message);
      if (!operationError) {
        setSubmitting(false);
        onCancel();
        return;
      }
      setSubmitError(operationError);
      requestAnimationFrame(() => errorRef.current?.focus());
    } catch (cause) {
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : 'The record could not be saved.',
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (kind === 'item') {
      void submitOperation(
        current =>
          addItem(current, {
            name: text(form, 'name'),
            canonicalName: text(form, 'canonicalName'),
            category: text(form, 'category') as Category,
            status: text(
              form,
              'status',
            ) as LedgerState['items'][number]['status'],
            jurisdiction: current.jurisdiction,
            regulatoryStatus: text(form, 'regulatoryStatus'),
            form: text(form, 'form'),
            route: text(form, 'route'),
            concentration: text(form, 'concentration'),
            purpose: text(form, 'purpose'),
            clinician: text(form, 'clinician'),
            sourceRecord: text(form, 'sourceRecord'),
            startedOn: text(form, 'startedOn'),
            notes: text(form, 'notes'),
            clinicianQuestions: text(form, 'clinicianQuestions'),
            cadence: text(form, 'cadence'),
            dose: number(form, 'dose'),
            unit: text(form, 'unit'),
            instructionSource: text(form, 'instructionSource'),
          }),
        'Regimen item saved',
      );
    }
    if (kind === 'schedule') {
      void submitOperation(
        current =>
          addScheduleVersion(current, text(form, 'itemId'), {
            effectiveFrom: text(form, 'effectiveFrom'),
            cadence: text(form, 'cadence'),
            dose: number(form, 'dose'),
            unit: text(form, 'unit'),
            source: text(form, 'source'),
          }),
        'New schedule period created',
      );
    }
    if (kind === 'administration') {
      void submitOperation(
        current =>
          recordAdministration(current, {
            replayKey: crypto.randomUUID(),
            itemId: text(form, 'itemId'),
            lotId: text(form, 'lotId'),
            plannedAt: text(form, 'plannedAt'),
            actualAt: text(form, 'actualAt'),
            dose: number(form, 'dose'),
            unit: text(form, 'unit'),
            route: text(form, 'route'),
            site: text(form, 'site'),
            status: text(form, 'status') as AdministrationStatus,
            reason: text(form, 'reason'),
            reaction: text(form, 'reaction'),
            instructionSource: text(form, 'instructionSource'),
          }),
        'Administration recorded & inventory updated',
      );
    }
    if (kind === 'lot') {
      void submitOperation(
        current =>
          addLot(current, {
            itemId: text(form, 'itemId'),
            quantityReceived: number(form, 'quantity'),
            unit: text(form, 'unit'),
            containerSize: text(form, 'containerSize'),
            lotNumber: text(form, 'lotNumber'),
            expiresOn: text(form, 'expiresOn'),
            provenance: text(form, 'provenance'),
            orderReference: text(form, 'orderReference'),
            storageInstructions: text(form, 'storageInstructions'),
            openedOn: text(form, 'openedOn'),
            condition: text(form, 'condition'),
          }),
        'Inventory lot saved',
      );
    }
    if (kind === 'order') {
      void submitOperation(
        current =>
          addOrder(current, {
            itemId: text(form, 'itemId'),
            reference: text(form, 'reference'),
            status: text(form, 'status') as OrderStatus,
            orderedOn: text(form, 'orderedOn'),
            expectedOn: text(form, 'expectedOn'),
            receivedOn: '',
            quantity: number(form, 'quantity'),
            unit: text(form, 'unit'),
            provenance: text(form, 'provenance'),
            notes: text(form, 'notes'),
          }),
        'Order saved',
      );
    }
    if (kind === 'reconstitution') {
      void submitOperation(
        current =>
          addReconstitution(current, {
            itemId: text(form, 'itemId'),
            lotId: text(form, 'lotId'),
            occurredAt: text(form, 'occurredAt'),
            labeledAmount: number(form, 'labeledAmount'),
            labeledUnit: text(form, 'labeledUnit'),
            diluent: text(form, 'diluent'),
            diluentLot: text(form, 'diluentLot'),
            diluentVolumeMl: number(form, 'diluentVolumeMl'),
            performedBy: text(form, 'performedBy'),
            instructionSource: text(form, 'instructionSource'),
            storageRequirements: text(form, 'storageRequirements'),
            discardOn: text(form, 'discardOn'),
            inspectionNotes: text(form, 'inspectionNotes'),
          }),
        'Reconstitution record saved with transparent arithmetic',
      );
    }
    if (kind === 'outcome') {
      void submitOperation(
        current =>
          addOutcome(current, {
            kind: text(form, 'kind') as LedgerState['outcomes'][number]['kind'],
            name: text(form, 'name'),
            value: number(form, 'value'),
            unit: text(form, 'unit'),
            occurredAt: text(form, 'occurredAt'),
            referenceRange: text(form, 'referenceRange'),
            source: text(form, 'source'),
            notes: text(form, 'notes'),
          }),
        'Outcome recorded',
      );
    }
    if (kind === 'check-in') {
      const score = number(form, 'value');
      if (score < 0 || score > 10) {
        setSubmitError('Check-in score must be between 0 and 10.');
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      void submitOperation(
        current =>
          addOutcome(current, {
            kind: text(
              form,
              'kind',
            ) as LedgerState['outcomes'][number]['kind'],
            name: text(form, 'name'),
            value: score,
            unit: 'score/10',
            occurredAt: text(form, 'occurredAt'),
            referenceRange: '',
            source: 'self-reported check-in',
            notes: text(form, 'notes'),
          }),
        'Check-in added to your journey',
      );
    }
    if (kind === 'confounder') {
      void submitOperation(
        current =>
          addConfounder(current, {
            kind: text(
              form,
              'kind',
            ) as LedgerState['confounders'][number]['kind'],
            occurredAt: text(form, 'occurredAt'),
            note: text(form, 'note'),
          }),
        'Timeline context recorded',
      );
    }
    if (kind === 'adverse') {
      void submitOperation(
        current =>
          addAdverseEvent(current, {
            itemId: text(form, 'itemId'),
            lotId: text(form, 'lotId'),
            severity: text(
              form,
              'severity',
            ) as LedgerState['adverseEvents'][number]['severity'],
            occurredAt: text(form, 'occurredAt'),
            description: text(form, 'description'),
            actionTaken: text(form, 'actionTaken'),
          }),
        'Adverse event recorded',
      );
    }
    if (kind === 'view') {
      void submitOperation(
        current =>
          addSavedView(current, {
            name: text(form, 'name'),
            scope: text(
              form,
              'scope',
            ) as LedgerState['savedViews'][number]['scope'],
            evidenceTypes: form.getAll('evidenceTypes').map(String),
          }),
        'Research view saved',
      );
    }
  };

  const itemSelect = (
    <SelectField
      name="itemId"
      label="Regimen Item"
      defaultValue={targetItemId ?? ''}
      required
      options={state.items.map(item => ({ value: item.id, label: item.name }))}
      placeholder="Choose an item…"
    />
  );
  const availableLots = targetItemId
    ? state.lots.filter(lot => lot.itemId === targetItemId)
    : state.lots;
  const lotSelect = (
    <SelectField
      name="lotId"
      label={
        kind === 'reconstitution' ? 'Inventory Lot' : 'Inventory Lot (Optional)'
      }
      defaultValue={targetLotId ?? ''}
      required={kind === 'reconstitution'}
      options={availableLots.map(lot => ({
        value: lot.id,
        label: `${state.items.find(item => item.id === lot.itemId)?.name ?? 'Item'} · ${lot.lotNumber || 'Unnumbered lot'}`,
      }))}
      placeholder={
        kind === 'reconstitution' ? 'Choose a lot…' : 'No lot selected'
      }
    />
  );

  return (
    <form onSubmit={submit} autoComplete="off">
      {kind === 'item' ? (
        <>
          <FormSection
            title="Identity"
            description="Use the label or prescription as the source of truth."
          >
            <InputField
              name="name"
              label="Display Name"
              required
              placeholder="e.g. Label name…"
            />
            <InputField
              name="canonicalName"
              label="Canonical Name"
              placeholder="Scientific or generic name…"
            />
            <SelectField
              name="category"
              label="Category"
              required
              options={options([
                'vitamin',
                'supplement',
                'approved-medication',
                'compounded-medication',
                'peptide',
                'other',
              ])}
            />
            <SelectField
              name="status"
              label="Tracking Status"
              required
              options={options(['active', 'paused', 'planned', 'discontinued'])}
            />
            <InputField
              name="regulatoryStatus"
              label="Regulatory Status"
              placeholder="Factual status, if known…"
            />
            <InputField
              name="form"
              label="Form"
              placeholder="e.g. capsule, tablet, vial…"
            />
            <InputField
              name="route"
              label="Route"
              required
              placeholder="e.g. oral…"
            />
            <InputField
              name="concentration"
              label="Label Concentration"
              placeholder="Copy exactly from the source…"
            />
          </FormSection>
          <FormSection
            title="Current Plan"
            description="The value is recorded, never chosen by the ledger."
          >
            <InputField
              name="startedOn"
              label="Effective Date"
              type="date"
              required
              defaultValue={today()}
            />
            <InputField
              name="cadence"
              label="Planned Schedule"
              required
              placeholder="Copy the written schedule…"
            />
            <InputField
              name="dose"
              label="Planned Dose"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
            />
            <InputField
              name="unit"
              label="Dose Unit"
              required
              placeholder="e.g. mg, capsule…"
            />
            <SelectField
              name="instructionSource"
              label="Instruction Source"
              required
              options={options([
                'prescription',
                'pharmacy-label',
                'manufacturer',
                'clinician',
                'self-entered',
              ])}
            />
          </FormSection>
          <FormSection
            title="Context"
            description="Optional details for later review and clinician preparation."
          >
            <InputField
              name="purpose"
              label="Purpose in Your Words"
              placeholder="Why are you tracking this?…"
            />
            <InputField
              name="clinician"
              label="Prescriber or Clinician"
              placeholder="Optional…"
            />
            <InputField
              name="sourceRecord"
              label="Pharmacy or Factual Source"
              placeholder="Optional provenance…"
            />
            <TextareaField
              name="notes"
              label="Notes"
              placeholder="Optional notes…"
            />
            <TextareaField
              name="clinicianQuestions"
              label="Clinician Questions"
              placeholder="Questions to bring to an appointment…"
            />
          </FormSection>
        </>
      ) : null}

      {kind === 'schedule' ? (
        <FormSection
          title="New Effective Period"
          description="The current period receives an end date automatically."
        >
          {itemSelect}
          <InputField
            name="effectiveFrom"
            label="Effective From"
            type="date"
            required
            defaultValue={today()}
          />
          <InputField
            name="cadence"
            label="Planned Schedule"
            required
            placeholder="Copy the written schedule…"
          />
          <InputField
            name="dose"
            label="Planned Dose"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            required
          />
          <InputField
            name="unit"
            label="Dose Unit"
            required
            placeholder="e.g. mg, capsule…"
          />
          <SelectField
            name="source"
            label="Instruction Source"
            required
            options={options([
              'prescription',
              'pharmacy-label',
              'manufacturer',
              'clinician',
              'self-entered',
            ])}
          />
        </FormSection>
      ) : null}

      {kind === 'administration' ? (
        <>
          <FormSection
            title="What Occurred"
            description="Review each value before saving."
          >
            {itemSelect}
            {lotSelect}
            <InputField
              name="plannedAt"
              label="Planned Time (Optional)"
              type="datetime-local"
            />
            <InputField
              name="actualAt"
              label="Actual Time"
              type="datetime-local"
              required
              defaultValue={nowLocal()}
            />
            <InputField
              name="dose"
              label="Recorded Dose"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
            />
            <InputField
              name="unit"
              label="Unit"
              required
              placeholder="Must match the active plan…"
            />
            <InputField
              name="route"
              label="Route"
              required
              placeholder="e.g. oral…"
            />
            <InputField
              name="site"
              label="Site (Optional)"
              placeholder="Optional…"
            />
            <SelectField
              name="status"
              label="Observed Status"
              required
              options={options([
                'taken',
                'skipped',
                'delayed',
                'partial',
                'uncertain',
              ])}
            />
            <SelectField
              name="instructionSource"
              label="Instruction Source"
              required
              options={options([
                'prescription',
                'pharmacy-label',
                'manufacturer',
                'clinician',
                'self-entered',
              ])}
            />
          </FormSection>
          <FormSection
            title="Variation & Reaction"
            description="Optional context remains attached to this exact event."
          >
            <TextareaField
              name="reason"
              label="Reason for Variation"
              placeholder="If delayed, partial, skipped, or uncertain…"
            />
            <TextareaField
              name="reaction"
              label="Immediate Note or Reaction"
              placeholder="What did you notice?…"
            />
          </FormSection>
        </>
      ) : null}

      {kind === 'lot' ? (
        <>
          <FormSection
            title="Container"
            description="One record per physical lot or container."
          >
            {itemSelect}
            <InputField
              name="quantity"
              label="Quantity Received"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
            />
            <InputField
              name="unit"
              label="Inventory Unit"
              required
              placeholder="e.g. capsule, mL…"
            />
            <InputField
              name="containerSize"
              label="Container Size or Count"
              placeholder="e.g. 60 capsules…"
            />
            <InputField
              name="lotNumber"
              label="Lot or Batch Number"
              placeholder="Copy from packaging…"
            />
            <InputField name="expiresOn" label="Expiration Date" type="date" />
            <InputField name="openedOn" label="Opened Date" type="date" />
          </FormSection>
          <FormSection
            title="Provenance & Storage"
            description="Record facts without endorsing or recommending a supplier."
          >
            <InputField
              name="provenance"
              label="Pharmacy, Manufacturer, or Seller"
              placeholder="Factual provenance…"
            />
            <InputField
              name="orderReference"
              label="Order Reference"
              placeholder="Optional…"
            />
            <InputField
              name="storageInstructions"
              label="Copied Storage Instructions"
              placeholder="Copy exactly from source…"
            />
            <InputField
              name="condition"
              label="Received Condition & Packaging"
              placeholder="Optional observations…"
            />
          </FormSection>
        </>
      ) : null}

      {kind === 'order' ? (
        <FormSection
          title="Order Record"
          description="This is tracking only; no automatic reorder occurs."
        >
          {itemSelect}
          <InputField
            name="reference"
            label="Order Reference"
            required
            placeholder="Receipt or order number…"
          />
          <SelectField
            name="status"
            label="Status"
            required
            options={options([
              'ordered',
              'confirmed',
              'shipped',
              'delivered',
              'partially-received',
              'cancelled',
              'returned',
              'disputed',
            ])}
          />
          <InputField
            name="orderedOn"
            label="Ordered Date"
            type="date"
            required
            defaultValue={today()}
          />
          <InputField name="expectedOn" label="Expected Date" type="date" />
          <InputField
            name="quantity"
            label="Quantity"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            required
          />
          <InputField
            name="unit"
            label="Unit"
            required
            placeholder="e.g. container…"
          />
          <InputField
            name="provenance"
            label="Factual Source"
            placeholder="Optional provenance…"
          />
          <TextareaField
            name="notes"
            label="Notes"
            placeholder="Optional notes…"
          />
        </FormSection>
      ) : null}

      {kind === 'reconstitution' ? (
        <>
          <FormSection
            title="Confirmed Inputs"
            description="Every value must come from you and an authoritative instruction source."
          >
            {itemSelect}
            {lotSelect}
            <InputField
              name="occurredAt"
              label="Date & Time"
              type="datetime-local"
              required
              defaultValue={nowLocal()}
            />
            <InputField
              name="labeledAmount"
              label="Labeled Amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
            />
            <InputField
              name="labeledUnit"
              label="Labeled Unit"
              required
              placeholder="Copy from label…"
            />
            <InputField
              name="diluent"
              label="Diluent Identity"
              required
              placeholder="Copy from source…"
            />
            <InputField
              name="diluentLot"
              label="Diluent Lot"
              placeholder="Optional…"
            />
            <InputField
              name="diluentVolumeMl"
              label="Confirmed Volume (mL)"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
            />
          </FormSection>
          <div className="formula-callout">
            <strong>Transparent formula</strong>
            <span>Labeled amount ÷ confirmed mL = labeled units per mL</span>
            <small>
              The ledger refuses ambiguous or missing units and never infers an
              input.
            </small>
          </div>
          <FormSection
            title="Audit Details"
            description="Preserve the source and handling record."
          >
            <InputField
              name="performedBy"
              label="Performed or Supervised By"
              placeholder="Optional…"
            />
            <InputField
              name="instructionSource"
              label="Authoritative Source"
              required
              placeholder="Clinician, pharmacy label, or manufacturer…"
            />
            <InputField
              name="storageRequirements"
              label="Copied Storage Requirements"
              placeholder="Copy exactly from source…"
            />
            <InputField
              name="discardOn"
              label="Beyond-Use or Discard Date"
              type="date"
            />
            <InputField
              name="inspectionNotes"
              label="Visual Inspection Notes"
              placeholder="Optional observations…"
            />
          </FormSection>
        </>
      ) : null}

      {kind === 'outcome' ? (
        <FormSection
          title="Observed Result"
          description="Record the value, source, and time exactly as observed."
        >
          <SelectField
            name="kind"
            label="Type"
            required
            options={options([
              'symptom',
              'side-effect',
              'mood',
              'energy',
              'sleep',
              'appetite',
              'pain',
              'recovery',
              'weight',
              'blood-pressure',
              'heart-rate',
              'lab',
              'other',
            ])}
          />
          <InputField
            name="name"
            label="Outcome or Measurement"
            required
            placeholder="e.g. Sleep score…"
          />
          <InputField
            name="value"
            label="Value"
            type="number"
            inputMode="decimal"
            step="any"
            required
          />
          <InputField
            name="unit"
            label="Unit"
            required
            placeholder="e.g. points, mg/dL…"
          />
          <InputField
            name="occurredAt"
            label="Collection Time"
            type="datetime-local"
            required
            defaultValue={nowLocal()}
          />
          <InputField
            name="referenceRange"
            label="Reference Range"
            placeholder="If applicable…"
          />
          <InputField
            name="source"
            label="Lab, Device, or Source"
            placeholder="Optional provenance…"
          />
          <InputField
            name="notes"
            label="Notes"
            placeholder="Optional notes…"
          />
        </FormSection>
      ) : null}

      {kind === 'check-in' ? (
        <FormSection
          title="How You Feel"
          description="Choose one signal to track consistently. A higher score means more of the named feeling or symptom."
        >
          <SelectField
            name="kind"
            label="What Are You Tracking?"
            required
            options={options([
              'mood',
              'energy',
              'sleep',
              'appetite',
              'pain',
              'recovery',
              'symptom',
              'side-effect',
              'other',
            ])}
          />
          <InputField
            name="name"
            label="Signal Name"
            required
            placeholder="e.g. Energy, headache, sleep quality…"
          />
          <InputField
            name="value"
            label="Score From 0 to 10"
            type="number"
            inputMode="decimal"
            min="0"
            max="10"
            step="0.1"
            required
          />
          <InputField
            name="occurredAt"
            label="Date & Time"
            type="datetime-local"
            required
            defaultValue={nowLocal()}
          />
          <TextareaField
            name="notes"
            label="What Stands Out?"
            placeholder="Optional context you may want to remember…"
          />
        </FormSection>
      ) : null}

      {kind === 'confounder' ? (
        <FormSection
          title="Timeline Context"
          description="Context appears alongside regimen changes and outcomes."
        >
          <SelectField
            name="kind"
            label="Context Type"
            required
            options={options([
              'training',
              'diet',
              'illness',
              'travel',
              'sleep',
              'other',
            ])}
          />
          <InputField
            name="occurredAt"
            label="Date & Time"
            type="datetime-local"
            required
            defaultValue={nowLocal()}
          />
          <TextareaField
            name="note"
            label="What Happened"
            required
            placeholder="Describe the event…"
          />
        </FormSection>
      ) : null}

      {kind === 'adverse' ? (
        <FormSection
          title="Safety Record"
          description="For serious or worsening symptoms, contact appropriate professional or emergency help now."
        >
          {itemSelect}
          {lotSelect}
          <SelectField
            name="severity"
            label="Severity"
            required
            options={options(['mild', 'moderate', 'serious'])}
          />
          <InputField
            name="occurredAt"
            label="Date & Time"
            type="datetime-local"
            required
            defaultValue={nowLocal()}
          />
          <TextareaField
            name="description"
            label="Description"
            required
            placeholder="What happened?…"
          />
          <TextareaField
            name="actionTaken"
            label="Action Taken"
            placeholder="What did you do?…"
          />
        </FormSection>
      ) : null}

      {kind === 'view' ? (
        <FormSection
          title="Discovery Scope"
          description="These preferences never imply approval or established safety."
        >
          <InputField
            name="name"
            label="View Name"
            required
            placeholder="e.g. All human evidence…"
          />
          <SelectField
            name="scope"
            label="Regulatory Scope"
            required
            options={options(['approved-only', 'include-unapproved'])}
          />
          <Field className="field-span-full">
            <FieldLabel>Evidence Types</FieldLabel>
            <div className="check-grid">
              {[
                'human-clinical',
                'registered-trials',
                'animal',
                'mechanistic',
                'preprints',
                'regulatory',
                'expert-commentary',
                'web-x-forums',
              ].map(value => (
                <label className="check-tile" key={value}>
                  <input type="checkbox" name="evidenceTypes" value={value} />
                  <span>{label(value)}</span>
                </label>
              ))}
            </div>
          </Field>
        </FormSection>
      ) : null}

      {submitError ? (
        <div ref={errorRef} className="dialog-error" tabIndex={-1}>
          <Alert variant="destructive" role="alert">
            <Icon icon={AlertCircle} size="sm" aria-hidden="true" />
            <AlertTitle>Record Not Saved</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <DialogFooter className="dialog-actions">
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? 'Saving…'
            : `Save ${kind === 'view' ? 'View' : 'Record'}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <fieldset className="form-section">
      <div className="form-section-heading">
        <H3 size="sm">{title}</H3>
        <p>{description}</p>
      </div>
      <div className="form-fields">{children}</div>
    </fieldset>
  );
}

function InputField({
  name,
  label: fieldLabel,
  ...props
}: { readonly name: string; readonly label: string } & ComponentProps<
  typeof Input
>) {
  return (
    <Field>
      <FieldLabel htmlFor={`entry-${name}`}>
        {fieldLabel}
        {props.required ? <span aria-hidden="true"> *</span> : null}
      </FieldLabel>
      <Input id={`entry-${name}`} name={name} autoComplete="off" {...props} />
    </Field>
  );
}

function TextareaField({
  name,
  label: fieldLabel,
  ...props
}: { readonly name: string; readonly label: string } & ComponentProps<
  typeof Textarea
>) {
  return (
    <Field className="field-span-full">
      <FieldLabel htmlFor={`entry-${name}`}>
        {fieldLabel}
        {props.required ? <span aria-hidden="true"> *</span> : null}
      </FieldLabel>
      <Textarea
        id={`entry-${name}`}
        name={name}
        autoComplete="off"
        rows={3}
        {...props}
      />
    </Field>
  );
}

function SelectField({
  name,
  label: fieldLabel,
  options: selectOptions,
  placeholder,
  ...props
}: {
  readonly name: string;
  readonly label: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly placeholder?: string;
} & Omit<ComponentProps<typeof NativeSelect>, 'children'>) {
  return (
    <Field>
      <FieldLabel htmlFor={`entry-${name}`}>
        {fieldLabel}
        {props.required ? <span aria-hidden="true"> *</span> : null}
      </FieldLabel>
      <NativeSelect id={`entry-${name}`} name={name} {...props}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {selectOptions.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {name === 'scope' ? (
        <FieldDescription>
          Applies to future connector-backed discovery and summaries.
        </FieldDescription>
      ) : null}
    </Field>
  );
}

const label = (value: string): string =>
  value
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
const options = (
  values: readonly string[],
): readonly { readonly value: string; readonly label: string }[] =>
  values.map(value => ({ value, label: label(value) }));
