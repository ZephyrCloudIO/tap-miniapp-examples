import type { ReactNode } from "react";
import { Alert, AlertDescription, Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, Field, FieldError, FieldLabel, Input, MiniAppMetric, MiniAppMetricContent, MiniAppMetricLabel, MiniAppMetricValue, MiniAppSectionHeader, MiniAppSectionHeaderActions, MiniAppSectionHeaderContent, MiniAppSectionHeaderDescription, MiniAppSectionHeaderTitle, NativeSelect, Textarea } from "@theaiplatform/miniapp-sdk/ui";
import { AlertTriangle, Archive, FileQuestion, Plus } from "lucide-react";

export function FormField({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    {children}
    {hint ? <small className="field-hint">{hint}</small> : null}
    {error ? <FieldError>{error}</FieldError> : null}
  </Field>;
}

export const TextInput = (props: React.ComponentProps<typeof Input>) => <Input autoComplete="off" {...props} />;
export const SelectInput = (props: React.ComponentProps<typeof NativeSelect>) => <NativeSelect {...props} />;
export const TextAreaInput = (props: React.ComponentProps<typeof Textarea>) => <Textarea {...props} />;

export function EmptyPanel({ icon = "question", title, description, action }: { icon?: "question" | "archive"; title: string; description: string; action?: ReactNode }) {
  return <Empty className="empty-panel">
    <EmptyHeader>
      <EmptyMedia variant="icon">{icon === "archive" ? <Archive aria-hidden="true" /> : <FileQuestion aria-hidden="true" />}</EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    {action ? <EmptyContent>{action}</EmptyContent> : null}
  </Empty>;
}

export function Metric({ value, label, tone = "neutral" }: { value: string | number; label: string; tone?: "neutral" | "danger" | "success" | "warning" }) {
  return <MiniAppMetric className={`metric metric-${tone}`}><MiniAppMetricContent><MiniAppMetricValue>{value}</MiniAppMetricValue><MiniAppMetricLabel>{label}</MiniAppMetricLabel></MiniAppMetricContent></MiniAppMetric>;
}

export function SectionHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <MiniAppSectionHeader className="section-header"><MiniAppSectionHeaderContent className="min-w-0">{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<MiniAppSectionHeaderTitle>{title}</MiniAppSectionHeaderTitle>{description ? <MiniAppSectionHeaderDescription>{description}</MiniAppSectionHeaderDescription> : null}</MiniAppSectionHeaderContent>{action ? <MiniAppSectionHeaderActions className="section-action">{action}</MiniAppSectionHeaderActions> : null}</MiniAppSectionHeader>;
}

export function EntityDialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange(open: boolean): void; title: string; description: string; children: ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="entity-dialog"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}

export function AddButton({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return <Button onClick={onClick}><Plus aria-hidden="true" />{children}</Button>;
}

export function PermissionNotice({ role }: { role?: string }) {
  return <Alert><AlertTriangle aria-hidden="true" /><AlertDescription>Your {role || "participant"} role has read-only access to this operation. Ask the incident lead to change your role.</AlertDescription></Alert>;
}

export function StatusBadge({ value }: { value: string }) {
  const variant = /failed|rejected|contradicted|disputed|critical/i.test(value) ? "destructive" : /verified|approved|confirmed|captured|published/i.test(value) ? "default" : "secondary";
  return <Badge variant={variant}>{value.replaceAll("-", " ")}</Badge>;
}
