import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@theaiplatform/miniapp-sdk/ui";
import type { ComponentProps, ReactNode } from "react";

type CalendarSelectProps = ComponentProps<typeof Select> &
  Pick<
    ComponentProps<typeof SelectTrigger>,
    "id" | "ref" | "aria-label" | "aria-describedby" | "aria-invalid"
  > & {
    placeholder?: ReactNode;
  };

export function CalendarSelect({
  children,
  id,
  ref,
  placeholder,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: CalendarSelectProps) {
  return (
    <Select {...props}>
      <SelectTrigger
        className="h-10"
        id={id}
        ref={ref ?? null}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
