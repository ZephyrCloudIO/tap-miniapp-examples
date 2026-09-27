import { CalendarSelect } from "./calendar-select";
import type { MiniAppWorkspaceMember } from "@theaiplatform/miniapp-sdk/sdk";
import { hostPolicyMatches, sharedHostInput, workspaceHosts } from "./workspace-hosts";
import { Button, SelectItem } from "@theaiplatform/miniapp-sdk/ui";
import { copyTextToClipboard } from "./clipboard";
import { useEffect, useRef, useState } from "react";
import { Users, Plus, Copy, RefreshCw, CheckCircle2, LockKeyhole, Pencil } from "lucide-react";
import type { CalendarState } from "./domain";
import type { CalendarGatewayClient } from "./gateway";
import type { SharedEventType, SharedHostInput, WorkspaceBookings, WorkspaceBookingProfileInput } from "./workspace-bookings";

const message = (error: unknown): string => error instanceof Error ? error.message : "The shared booking settings could not be loaded.";

export function WorkspaceBookingPanel({ gateway, state, authorize, loadMembers }: { readonly loadMembers: () => Promise<readonly MiniAppWorkspaceMember[]>; readonly gateway: CalendarGatewayClient; readonly state: CalendarState; readonly authorize: (action: "calendar.manage" | "calendar.publish" | "calendar.approve") => Promise<void> }) {
  const [data, setData] = useState<WorkspaceBookings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileFocusRevision, setProfileFocusRevision] = useState(0);
  const [members, setMembers] = useState<readonly MiniAppWorkspaceMember[]>([]);
  const autoSyncAttempt = useRef("");
  const latest = useRef(authorize);
  latest.current = authorize;
  useEffect(() => {
    let active = true;
    setData(null);
    setMembers([]); autoSyncAttempt.current = "";
    void Promise.all([gateway.workspaceBookings(), loadMembers()]).then(([value, roster]) => {
      if (active) { setMembers(roster); setData(value); }
    }).catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [gateway, loadMembers]);
  const refresh = async () => {
    const [value, roster] = await Promise.all([gateway.workspaceBookings(), loadMembers()]);
    setMembers(roster); setData(value);
  };
  const selfName = data?.self?.host.displayName || members.find(member => member.userId === gateway.principalId)?.displayName || "";
  const automaticPolicy = data ? sharedHostInput(state, data.self, selfName) : null;
  const automaticPolicyKey = automaticPolicy && !hostPolicyMatches(data?.self ?? null, automaticPolicy) ? JSON.stringify(automaticPolicy) : "";
  useEffect(() => {
    if (!automaticPolicyKey || autoSyncAttempt.current === automaticPolicyKey) return;
    autoSyncAttempt.current = automaticPolicyKey;
    let active = true;
    const input = JSON.parse(automaticPolicyKey) as Extract<SharedHostInput, { enabled: true }>;
    setBusy(true);
    void (async () => {
      try {
        await latest.current("calendar.manage");
        await gateway.saveSharedHost(input);
        const updated = await gateway.workspaceBookings();
        if (active) { setData(updated); setError(""); }
      } catch (cause) { if (active) setError(`Your booking availability could not sync. ${message(cause)}`); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [gateway, automaticPolicyKey]);
  const view = data ? { ...data, hosts: workspaceHosts(members, data.hosts) } : null;
  const perform = async (operation: () => Promise<void>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); await refresh(); setNotice(success); return true; }
    catch (cause) { setError(message(cause)); await refresh().catch(() => undefined); return false; }
    finally { setBusy(false); }
  };
  return <section className="shared-booking-panel" aria-labelledby="shared-booking-heading">
    <div className="shared-booking-heading"><div><h2 id="shared-booking-heading"><Users aria-hidden="true" /> Shared bookings</h2><p>One workspace link. Every selected host attends.</p></div><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(refresh, "Shared settings refreshed.")}><RefreshCw aria-hidden="true" /> Refresh</button></div>
    {error ? <p role="alert" className="shared-booking-error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!data && !error ? <p role="status">Loading shared booking settings…</p> : null}
    {data ? <>
      {data.pendingApprovals.length ? <section className="shared-booking-section" aria-labelledby="shared-approvals-heading">
        <h3 id="shared-approvals-heading">Meetings awaiting your approval</h3>
        {data.pendingApprovals.map(booking => <div className="shared-booking-event" key={booking.operationId}>
          <strong>{booking.title}</strong><span>{booking.guestName} · {booking.guestEmail} · {new Date(booking.startsAt).toLocaleString()}</span>
          <div className="shared-booking-actions">{(["approve", "decline"] as const).map(decision => <button type="button" className={decision === "approve" ? "primary-button" : "secondary-button"} disabled={busy} key={decision} onClick={() => void perform(async () => {
            await authorize("calendar.approve");
            await gateway.resolveApprovalHold(booking.operationId, { idempotencyKey: `shared-${decision}-${booking.operationId}`, decision,
              ...(decision === "approve" ? { conflictCalendarIds: booking.conflictCalendarIds, conferenceProvider: booking.conferenceProvider } : {}) });
          }, decision === "approve" ? "Meeting approved. Everyone will receive the invitation." : "Meeting declined.")}>{decision === "approve" ? "Approve meeting" : "Decline meeting"}</button>)}</div>
        </div>)}
      </section> : null}
      <HostAvailability key={`${gateway.principalId}:${data.self?.host.version ?? 0}`} data={data} state={state} displayName={selfName} busy={busy}
        onSave={async input => { await perform(async () => { await authorize("calendar.manage"); await gateway.saveSharedHost(input); }, input.enabled ? "Your booking availability is saved." : "Shared bookings disabled. Existing meetings remain on your calendar."); }} />
      {data.canManage ? <WorkspaceProfileEditor key={`${data.definition?.version ?? 0}:${data.publication?.publication_generation ?? 0}`} data={view!} busy={busy} focusRevision={profileFocusRevision}
        onSave={async input => {
          const success = !data.publication && input.published ? "Workspace name claimed."
            : input.published ? "Workspace profile saved." : "Workspace profile saved offline.";
          if (await perform(async () => { await authorize("calendar.publish"); await gateway.saveWorkspaceBookingProfile(input); }, success)) {
            setProfileFocusRevision(value => value + 1);
          }
        }}
        onCopy={async url => { await perform(async () => { await copyTextToClipboard(url); }, "Booking link copied."); }} />
        : <p>Everyone in this workspace is a host. A workspace owner or admin can choose hosts for shared meetings.</p>}
    </> : null}
  </section>;
}

function HostAvailability({ data, state, busy, onSave, displayName: memberName }: { readonly displayName: string; readonly data: WorkspaceBookings; readonly state: CalendarState; readonly busy: boolean; readonly onSave: (input: SharedHostInput) => Promise<void> }) {
  const own = data.self;
  const calendars = state.accounts.filter(account => account.provider === "google" && account.status === "connected").flatMap(account => account.calendars);
  const destinations = calendars.filter(calendar => calendar.writable);
  const [displayName, setDisplayName] = useState(own?.host.displayName || memberName);
  const [destination, setDestination] = useState(own?.host.destinationCalendarId ?? destinations.find(calendar => calendar.destination)?.id ?? destinations[0]?.id ?? "");
  const [scheduleId, setScheduleId] = useState(own?.host.sourceAvailabilityScheduleId ?? state.availability[0]?.id ?? "");
  const schedule = state.availability.find(item => item.id === scheduleId);
  const canSave = Boolean(schedule && destinations.some(calendar => calendar.id === destination) && displayName.trim());
  return <details className="shared-booking-section" open={!own?.enabled}>
    <summary>Your booking availability {own?.enabled ? `· ${own.host.displayName}` : "· Calendar setup needed"}</summary>
    <form className="schedule-form" onSubmit={event => {
      event.preventDefault(); if (!canSave || !schedule || busy) return;
      void onSave({ expectedVersion: own?.host.version ?? 0, enabled: true, displayName,
        destinationCalendarId: destination, conflictCalendarIds: [...new Set(calendars.filter(calendar => calendar.conflicts || calendar.id === destination).map(calendar => calendar.id))].sort(),
        sourceAvailabilityScheduleId: schedule.id, schedule: { timeZone: schedule.timezone,
          preferredStart: schedule.preferredStart, preferredEnd: schedule.preferredEnd,
          bufferBeforeMinutes: schedule.bufferBeforeMinutes, bufferAfterMinutes: schedule.bufferAfterMinutes,
          minimumNoticeMinutes: schedule.minimumNoticeMinutes, bookingHorizonDays: schedule.bookingHorizonDays,
          windows: schedule.windows.map(({ day, enabled, start, end }) => ({ day, enabled, start, end })),
          overrides: (schedule.overrides ?? []).map(override => ({ date: override.date, label: override.label, available: override.available,
            timeZone: override.timezone ?? schedule.timezone, ...(override.available ? { start: override.start!, end: override.end! } : {}) })),
        } });
    }}>
      <p>Workspace members are hosts automatically. Your connected Google calendar and saved availability determine when you can be booked. These settings sync automatically when you open Booking pages.</p>
      <div className="shared-booking-fields">
        <label className="field"><span>Your public name</span><input required maxLength={160} value={displayName} onChange={event => setDisplayName(event.currentTarget.value)} /></label>
        <label className="field"><span>Your Google calendar</span><CalendarSelect required placeholder="Choose a calendar" value={destination} onValueChange={value => setDestination(value)}>{destinations.map(calendar => <SelectItem key={calendar.id} value={calendar.id}>{calendar.name}</SelectItem>)}</CalendarSelect></label>
        <label className="field"><span>Availability Schedule</span><CalendarSelect required placeholder="Choose a schedule" value={scheduleId} onValueChange={value => setScheduleId(value)}>{state.availability.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</CalendarSelect></label>
      </div>
      {!destinations.length || !state.availability.length ? <p>Connect a Google calendar in Settings and create an Availability Schedule to get started.</p> : null}
      <div className="shared-booking-actions"><Button disabled={busy || !canSave} type="submit">{busy ? "Syncing…" : "Save availability"}</Button></div>
    </form>
  </details>;
}

function WorkspaceProfileEditor({ data, busy, onSave, onCopy, focusRevision }: { readonly data: WorkspaceBookings; readonly busy: boolean; readonly focusRevision: number; readonly onSave: (input: WorkspaceBookingProfileInput) => Promise<void>; readonly onCopy: (url: string) => Promise<void> }) {
  const [slug, setSlug] = useState(data.definition?.profileSlug ?? "");
  const [name, setName] = useState(data.definition?.displayName ?? "");
  const [events, setEvents] = useState<readonly SharedEventType[]>(data.definition?.events ?? []);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing) nameInput.current?.focus();
    else if (restoreFocus.current || focusRevision > 0) { editButton.current?.focus(); restoreFocus.current = false; }
  }, [editing, focusRevision]);
  const cancelEditing = () => {
    setSlug(data.definition?.profileSlug ?? "");
    setName(data.definition?.displayName ?? "");
    setEvents(data.definition?.events ?? []);
    setDirty(false);
    restoreFocus.current = true;
    setEditing(false);
  };
  const addMeeting = () => {
    setEditing(true);
    setDirty(true);
    setEvents(current => [...current, { id: crypto.randomUUID(), slug: "", title: "Meet with us", description: "", durationMinutes: 30, hostIds: [], organizerId: "", location: "google-meet", approvalRequired: false }]);
  };
  const update = (id: string, change: Partial<SharedEventType>) => { setDirty(true); setEvents(current => current.map(event => event.id === id ? { ...event, ...change } : event)); };
  const payload = (published: boolean): WorkspaceBookingProfileInput => ({ expectedVersion: data.definition?.version ?? 0, profileSlug: data.publication?.current_slug ?? slug, displayName: name, events, published });
  const live = data.publication?.status === "published";
  const current = live && data.publication?.definition_version === data.definition?.version && data.publication?.hosts_current;
  const claimed = Boolean(data.publication);
  const profileUrl = claimed ? `${data.publicBaseUrl}/${encodeURIComponent(data.publication!.current_slug)}` : null;
  const hasMeetings = Boolean(data.definition?.events.length);
  const savePublished = claimed ? data.definition?.published ?? false : true;
  const hostErrors = (event: SharedEventType): readonly string[] => {
    const errors = event.hostIds.flatMap(id => {
      const host = data.hosts.find(item => item.principalId === id);
      if (!host) return ["A selected host is no longer in the workspace."];
      if (!host.calendarConnected) return [`${host.displayName} needs to connect a Google calendar in Calendar Settings.`];
      if (!host.availabilityReady) return [`${host.displayName} needs to open Booking pages to sync their booking availability.`];
      return [];
    });
    const organizer = data.hosts.find(host => host.principalId === event.organizerId);
    if (event.location === "zoom" && organizer && !organizer.zoomConnected) {
      errors.push(`${organizer.displayName} hasn’t connected Zoom. They can connect it in Calendar Settings, or you can choose another organizer or Google Meet.`);
    }
    return errors;
  };
  const publicationBlocked = events.some(event => hostErrors(event).length > 0);
  return <section className="shared-booking-section" aria-labelledby="workspace-profile-heading">
    <h3 id="workspace-profile-heading">Workspace booking profile</h3>
    {claimed ? <div className="workspace-profile-summary">
      <div className="workspace-profile-summary-heading">
        <div>
          <span className="workspace-name-claimed"><CheckCircle2 aria-hidden="true" /> Name claimed</span>
          <h4>{data.definition?.displayName || data.publication!.display_name}</h4>
        </div>
        {!editing ? <Button ref={editButton} type="button" variant="outline" disabled={busy} onClick={() => setEditing(true)}><Pencil aria-hidden="true" /> Edit profile</Button> : null}
      </div>
      <div className="workspace-profile-address">
        <LockKeyhole aria-hidden="true" />
        {live ? <a href={profileUrl!} target="_blank" rel="noreferrer">{profileUrl}</a> : <span>{profileUrl}</span>}
        {live ? <Button type="button" variant="outline" disabled={busy} onClick={() => void onCopy(profileUrl!)}><Copy aria-hidden="true" /> Copy link</Button> : null}
      </div>
      <p className="workspace-profile-reservation">This public name is reserved for your workspace and cannot be changed.</p>
      <div className="workspace-profile-readiness">
        <span className={`status-chip ${live && current && hasMeetings ? "status-confirmed" : "status-pending"}`}>
          {!live ? "Offline" : !current ? "Update needed" : hasMeetings ? "Accepting bookings" : "Setup needed"}
        </span>
        <p>{!live ? "Your name stays reserved while the profile is offline."
          : !current ? "Saved settings or host availability have changed. Refresh shared links to apply them."
          : !hasMeetings ? "Your name is ready. Add a shared meeting to start accepting bookings."
          : `${data.definition!.events.length} shared ${data.definition!.events.length === 1 ? "meeting is" : "meetings are"} available on your booking page.`}</p>
      </div>
    </div> : <p>Choose a public name for your workspace. You can add shared meetings after claiming it.</p>}
    {claimed && !editing ? <div className="workspace-profile-complete">
      {publicationBlocked ? <div className="shared-booking-validation" role="alert"><ul>{[...new Set(events.flatMap(hostErrors))].map(error => <li key={error}>{error}</li>)}</ul></div> : null}
      {hasMeetings ? <ul className="workspace-profile-meetings" aria-label="Shared meetings">
        {data.definition!.events.map(event => <li key={event.id}>
          <div><strong>{event.title}</strong><span>{event.durationMinutes} min · {event.hostIds.length} required {event.hostIds.length === 1 ? "host" : "hosts"}</span></div>
          {current && data.definition?.published ? <Button type="button" variant="outline" disabled={busy} onClick={() => void onCopy(`${profileUrl}/${encodeURIComponent(event.slug)}`)} aria-label={`Copy link for ${event.title}`}><Copy aria-hidden="true" /> Copy link</Button> : null}
        </li>)}
      </ul> : null}
      {!data.hosts.length ? <p className="workspace-profile-next-step">No workspace members are available. Refresh to reload the workspace host list.</p> : null}
      <div className="shared-booking-actions">
        <Button type="button" variant={!hasMeetings ? "default" : "outline"} disabled={busy || !data.hosts.length || events.length >= 20} onClick={addMeeting}><Plus aria-hidden="true" /> Add shared meeting</Button>
        {live && !current ? <Button type="button" disabled={busy || publicationBlocked} onClick={() => void onSave(payload(true))}><RefreshCw aria-hidden="true" /> Refresh shared links</Button> : null}
        {!live ? <Button type="button" disabled={busy || publicationBlocked} onClick={() => void onSave(payload(true))}>Publish profile</Button> : null}
        {live ? <Button type="button" variant="outline" disabled={busy} onClick={() => void onSave(payload(false))}>Take profile offline</Button> : null}
      </div>
    </div> : <form className="schedule-form workspace-profile-form" onSubmit={event => { event.preventDefault(); if (!busy && (!savePublished || !publicationBlocked)) void onSave(payload(savePublished)); }}>
      {claimed ? <h4>Edit workspace profile</h4> : null}
      <div className="shared-booking-fields">
        <label className="field"><span>Workspace display name</span><input ref={nameInput} name="workspace-display-name" autoComplete="organization" required disabled={busy} maxLength={160} value={name} onChange={event => { setName(event.currentTarget.value); setDirty(true); }} placeholder="Zephyr" /></label>
        {!claimed ? <label className="field"><span>Public workspace name</span><input name="workspace-profile-slug" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={2} maxLength={64} value={slug} onChange={event => { setSlug(event.currentTarget.value); setDirty(true); }} placeholder="zephyr" /><small>{data.publicBaseUrl}/{slug || "workspace-name"}</small></label> : null}
      </div>
      {!data.hosts.length ? <p>No workspace members are available. Refresh to reload the workspace host list.</p> : null}
      {events.map(event => <fieldset className="shared-booking-event" key={event.id} aria-describedby={hostErrors(event).length ? `shared-host-errors-${event.id}` : undefined}><legend>{event.title || "New shared meeting"}</legend>
        <div className="shared-booking-fields">
          <label className="field"><span>Meeting title</span><input required maxLength={160} value={event.title} onChange={e => update(event.id, { title: e.currentTarget.value })} /></label>
          <label className="field"><span>Link name</span><input required minLength={2} maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" readOnly={Boolean(current && data.definition?.events.some(item => item.id === event.id))} value={event.slug} onChange={e => update(event.id, { slug: e.currentTarget.value })} placeholder="meet-the-team" /></label>
          <label className="field"><span>Duration (minutes)</span><input type="number" required min={5} max={480} value={event.durationMinutes} onChange={e => update(event.id, { durationMinutes: Number(e.currentTarget.value) })} /></label>
        </div>
        <label className="field"><span>Description</span><textarea maxLength={2000} value={event.description} onChange={e => update(event.id, { description: e.currentTarget.value })} /></label>
        <fieldset className="shared-booking-hosts"><legend>Required hosts · everyone attends</legend>
          {data.hosts.map(host => <label className="shared-booking-check" key={host.principalId}><input type="checkbox" checked={event.hostIds.includes(host.principalId)} onChange={e => {
            const ids = e.currentTarget.checked ? [...event.hostIds, host.principalId] : event.hostIds.filter(id => id !== host.principalId);
            update(event.id, { hostIds: ids, organizerId: ids.includes(event.organizerId) ? event.organizerId : ids[0] ?? "" });
          }} />{host.displayName} <small>{host.availabilityReady ? "Calendar ready" : host.calendarConnected ? "Availability needed" : "Google calendar not connected"}{host.zoomConnected ? " · Zoom connected" : " · Zoom not connected"}</small></label>)}
          {event.hostIds.some(id => !data.hosts.some(host => host.principalId === id)) ? <p role="alert">A selected host is no longer in the workspace. Remove them to publish this meeting.</p> : null}
          {event.hostIds.filter(id => !data.hosts.some(host => host.principalId === id)).map(id => <button type="button" className="secondary-button" key={id} onClick={() => update(event.id, { hostIds: event.hostIds.filter(value => value !== id), organizerId: event.organizerId === id ? "" : event.organizerId })}>Remove unavailable host</button>)}
        </fieldset>
        <div className="shared-booking-fields">
          <label className="field"><span>Organizer</span><CalendarSelect required placeholder="Choose a required host" value={event.organizerId} onValueChange={value => update(event.id, { organizerId: value })}>{data.hosts.filter(host => event.hostIds.includes(host.principalId)).map(host => <SelectItem key={host.principalId} value={host.principalId}>{host.displayName}</SelectItem>)}</CalendarSelect></label>
          <label className="field"><span>Meeting room</span><CalendarSelect value={event.location} onValueChange={value => update(event.id, { location: value as SharedEventType["location"] })}><SelectItem value="google-meet">Google Meet</SelectItem><SelectItem value="zoom">Organizer’s Zoom</SelectItem></CalendarSelect></label>
        </div>
        {hostErrors(event).length ? <div id={`shared-host-errors-${event.id}`} className="shared-booking-validation" role="alert"><ul>{hostErrors(event).map(error => <li key={error}>{error}</li>)}</ul></div> : null}
        <label className="shared-booking-check"><input type="checkbox" checked={event.approvalRequired} onChange={e => update(event.id, { approvalRequired: e.currentTarget.checked })} /> Require organizer approval</label>
        <div className="shared-booking-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setEvents(current => current.filter(item => item.id !== event.id)); setDirty(true); }}>Remove meeting</button>
          {current && !dirty && data.definition?.published ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void onCopy(`${profileUrl}/${encodeURIComponent(event.slug)}`)}><Copy aria-hidden="true" /> Copy shared link</button> : null}</div>
      </fieldset>)}
      <div className="shared-booking-actions">
        <Button type="button" variant="outline" disabled={busy || !data.hosts.length || events.length >= 20} onClick={addMeeting}><Plus aria-hidden="true" /> Add shared meeting</Button>
        {claimed ? <Button type="button" variant="outline" disabled={busy} onClick={cancelEditing}>Cancel</Button> : null}
        <Button type="submit" disabled={busy || events.some(event => !event.hostIds.length) || (savePublished && publicationBlocked)}>{busy ? "Saving…" : claimed ? "Save changes" : "Claim workspace name"}</Button>
      </div>
      {claimed ? <small>{savePublished ? "Saving updates your published profile and shared meetings." : "Saving keeps your profile offline. You can publish it when you’re ready."}</small> : <small>Your public name becomes permanent once claimed. Your display name can be edited later.</small>}
    </form>}
  </section>;
}
