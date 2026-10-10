import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import { AlertTriangle, CircleUserRound, Plus, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { CalendarAccount } from "./domain";
import "./profile-menu.css";

const initials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map(word => word[0]?.toUpperCase() ?? "").join("");

function useSignedInName(): string {
  const [name, setName] = useState("");
  useEffect(() => {
    let active = true;
    try {
      const current = sdk.user?.current();
      if (current) void Promise.resolve(current).then(user => { if (active) setName(user.displayName.trim()); }, () => undefined);
    } catch {
      // Older hosts and the local preview have no user capability.
    }
    return () => { active = false; };
  }, []);
  return name;
}

export function ProfileMenu({ accounts, refreshing, onOpenSettings, onConnectCalendar, onRefresh }: {
  readonly accounts: readonly CalendarAccount[];
  readonly refreshing: boolean;
  readonly onOpenSettings: () => void;
  readonly onConnectCalendar: () => void;
  readonly onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const signedInName = useSignedInName();
  const email = accounts[0]?.label ?? "";
  const name = signedInName || email || "TAP Calendar";
  const attention = accounts.filter(account => account.status === "attention");
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % list.length
      : event.key === "ArrowUp" ? (index - 1 + list.length) % list.length
        : event.key === "Home" ? 0
          : event.key === "End" ? list.length - 1 : null;
    if (next !== null) {
      event.preventDefault();
      list[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className="avatar-button"
        type="button"
        aria-label={attention.length ? `Account menu, ${attention.length} ${attention.length === 1 ? "account needs" : "accounts need"} attention` : "Account menu"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); }
        }}
      >
        {signedInName ? <span className="avatar-initials">{initials(signedInName)}</span> : <CircleUserRound aria-hidden="true" />}
        {attention.length ? <span className="avatar-attention" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="profile-menu-popover" id={menuId} role="menu" aria-label="Account" ref={menuRef} onKeyDown={onMenuKeyDown}>
          <div className="profile-menu-identity">
            <span className="profile-menu-avatar" aria-hidden="true">{initials(name) || <CircleUserRound />}</span>
            <div>
              <strong>{name}</strong>
              <span>{accounts.length === 0 ? "No calendars connected" : email && email !== name ? email : `${accounts.length} connected ${accounts.length === 1 ? "account" : "accounts"}`}</span>
            </div>
          </div>
          {attention.length ? (
            <button type="button" role="menuitem" className="profile-menu-attention" onClick={() => choose(onOpenSettings)}>
              <AlertTriangle aria-hidden="true" />
              <span>{attention.length === 1 ? `Reconnect ${attention[0]!.label}` : `${attention.length} accounts need reconnecting`}</span>
            </button>
          ) : null}
          <div className="profile-menu-items">
            <button type="button" role="menuitem" onClick={() => choose(onOpenSettings)}><Settings2 aria-hidden="true" /> Calendar settings</button>
            <button type="button" role="menuitem" onClick={() => choose(onConnectCalendar)}><Plus aria-hidden="true" /> Connect a calendar</button>
            <button type="button" role="menuitem" disabled={refreshing || accounts.length === 0} onClick={() => choose(onRefresh)}>
              <RefreshCw aria-hidden="true" className={refreshing ? "is-spinning" : undefined} /> {refreshing ? "Refreshing calendars…" : "Refresh calendars"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
