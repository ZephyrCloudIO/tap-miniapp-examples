import { copyTextToClipboard } from "./clipboard";
import { useEffect, useState } from "react";
import { Users, Plus, Copy, RefreshCw } from "lucide-react";
import type { CalendarState } from "./domain";
import type { CalendarGatewayClient } from "./gateway";
import type { SharedEventType, SharedHostInput, WorkspaceBookings, WorkspaceBookingProfileInput } from "./workspace-bookings";

const message = (error: unknown): string => error instanceof Error ? error.message : "The shared booking settings could not be loaded.";

export function WorkspaceBookingPanel({ gateway, state, authorize }: { readonly gateway: CalendarGatewayClient; readonly state: CalendarState; readonly authorize: (action: "calendar.manage" | "calendar.publish" | "calendar.approve") => Promise<void> }) {
  const [data, setData] = useState<WorkspaceBookings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    void gateway.workspaceBookings().then(value => { if (active) setData(value); }).catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [gateway]);
  const refresh = async () => { setData(await gateway.workspaceBookings()); };
  const perform = async (operation: () => Promise<void>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); await refresh(); setNotice(success); }
    catch (cause) { setError(message(cause)); await refresh().catch(() => undefined); }
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
      <HostEnrollment key={`${gateway.principalId}:${data.self?.host.version ?? 0}`} data={data} state={state} busy={busy}
        onSave={input => perform(async () => { await authorize("calendar.manage"); await gateway.saveSharedHost(input); }, input.enabled ? "Your shared availability is saved. A workspace admin can now publish or refresh links that include you." : "Shared bookings disabled. Existing meetings remain on your calendar.")} />
      {data.canManage ? <WorkspaceProfileEditor key={`${data.definition?.version ?? 0}:${data.publication?.publication_generation ?? 0}`} data={data} busy={busy}
        onSave={input => perform(async () => { await authorize("calendar.publish"); await gateway.saveWorkspaceBookingProfile(input); }, input.published ? "Workspace booking links published." : "Workspace booking links unpublished.")}
        onCopy={url => perform(async () => { await copyTextToClipboard(url); }, "Booking link copied.")} />
        : <p>A workspace owner or admin can create shared links after each host enables shared bookings.</p>}
    </> : null}
  </section>;
}

function HostEnrollment({ data, state, busy, onSave }: { readonly data: WorkspaceBookings; readonly state: CalendarState; readonly busy: boolean; readonly onSave: (input: SharedHostInput) => Promise<void> }) {
  const own = data.self;
  const calendars = state.accounts.filter(account => account.provider === "google" && account.status === "connected").flatMap(account => account.calendars);
  const destinations = calendars.filter(calendar => calendar.writable);
  const [displayName, setDisplayName] = useState(own?.host.displayName ?? "");
  const [destination, setDestination] = useState(own?.host.destinationCalendarId ?? destinations.find(calendar => calendar.destination)?.id ?? destinations[0]?.id ?? "");
  const [scheduleId, setScheduleId] = useState(own?.host.sourceAvailabilityScheduleId ?? state.availability[0]?.id ?? "");
  const [consent, setConsent] = useState(own?.enabled ?? false);
  const schedule = state.availability.find(item => item.id === scheduleId);
  const canSave = Boolean(schedule && destinations.some(calendar => calendar.id === destination) && displayName.trim() && consent);
  return <details className="shared-booking-section" open={!own?.enabled}>
    <summary>Your shared availability {own?.enabled ? `· Enabled as ${own.host.displayName}` : "· Not enabled"}</summary>
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
      <p>Choose your connected Google calendar and availability. Each host completes this once. After changing an Availability Schedule, save it here and ask an admin to refresh the shared links.</p>
      <div className="shared-booking-fields">
        <label className="field"><span>Your public name</span><input required maxLength={160} value={displayName} onChange={event => setDisplayName(event.currentTarget.value)} /></label>
        <label className="field"><span>Your Google calendar</span><select required value={destination} onChange={event => setDestination(event.currentTarget.value)}><option value="" disabled>Choose a calendar</option>{destinations.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
        <label className="field"><span>Availability Schedule</span><select required value={scheduleId} onChange={event => setScheduleId(event.currentTarget.value)}><option value="" disabled>Choose a schedule</option>{state.availability.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      {!destinations.length || !state.availability.length ? <p>Connect a Google calendar in Settings and create an Availability Schedule to get started.</p> : null}
      <label className="shared-booking-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.currentTarget.checked)} /> Allow this workspace’s owners and admins to include me in shared bookings using this availability and my Google Conflict Calendars.</label>
      <div className="shared-booking-actions"><button className="primary-button" disabled={busy || !canSave} type="submit">{own?.enabled ? "Save shared availability" : "Enable shared bookings"}</button>
        {own?.enabled ? <button className="secondary-button" disabled={busy} type="button" onClick={() => void onSave({ expectedVersion: own.host.version, enabled: false })}>Disable shared bookings</button> : null}</div>
    </form>
  </details>;
}

function WorkspaceProfileEditor({ data, busy, onSave, onCopy }: { readonly data: WorkspaceBookings; readonly busy: boolean; readonly onSave: (input: WorkspaceBookingProfileInput) => Promise<void>; readonly onCopy: (url: string) => Promise<void> }) {
  const [slug, setSlug] = useState(data.definition?.profileSlug ?? "");
  const [name, setName] = useState(data.definition?.displayName ?? "");
  const [events, setEvents] = useState<readonly SharedEventType[]>(data.definition?.events ?? []);
  const [dirty, setDirty] = useState(false);
  const update = (id: string, change: Partial<SharedEventType>) => { setDirty(true); setEvents(current => current.map(event => event.id === id ? { ...event, ...change } : event)); };
  const payload = (published: boolean): WorkspaceBookingProfileInput => ({ expectedVersion: data.definition?.version ?? 0, profileSlug: slug, displayName: name, events, published });
  const live = data.publication?.status === "published";
  const current = live && data.publication?.definition_version === data.definition?.version && data.publication?.hosts_current;
  const profileUrl = live ? `${data.publicBaseUrl}/${encodeURIComponent(data.publication!.current_slug)}` : null;
  return <div className="shared-booking-section">
    <h3>Workspace booking profile</h3>
    <p>Claim a workspace name such as <strong>zephyr</strong>, then choose the people who must attend each meeting. The organizer owns the calendar invitation and meeting room.</p>
    {profileUrl ? <p>Published profile: <a href={profileUrl} target="_blank" rel="noreferrer">{profileUrl}</a></p> : null}
    {live && !current ? <p role="status">Shared settings changed. Publish / refresh shared links to apply the current host availability and meeting settings.</p> : null}
    <form className="schedule-form" onSubmit={event => { event.preventDefault(); if (!busy) void onSave(payload(true)); }}>
      <div className="shared-booking-fields">
        <label className="field"><span>Workspace display name</span><input required maxLength={160} value={name} onChange={event => { setName(event.currentTarget.value); setDirty(true); }} placeholder="Zephyr" /></label>
        <label className="field"><span>Public workspace name</span><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={2} maxLength={64} readOnly={Boolean(data.publication)} value={slug} onChange={event => { setSlug(event.currentTarget.value); setDirty(true); }} placeholder="zephyr" /><small>{data.publicBaseUrl}/{slug || "workspace-name"}</small></label>
      </div>
      {!data.hosts.length ? <p>No hosts are enrolled yet. Each person can enable shared bookings above from their own account.</p> : null}
      {events.map(event => <fieldset className="shared-booking-event" key={event.id}><legend>{event.title || "New shared meeting"}</legend>
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
          }} />{host.displayName} <small>{host.email}</small></label>)}
          {event.hostIds.some(id => !data.hosts.some(host => host.principalId === id)) ? <p role="alert">A selected host is unavailable. Remove them or ask them to enable shared bookings again.</p> : null}
          {event.hostIds.filter(id => !data.hosts.some(host => host.principalId === id)).map(id => <button type="button" className="secondary-button" key={id} onClick={() => update(event.id, { hostIds: event.hostIds.filter(value => value !== id), organizerId: event.organizerId === id ? "" : event.organizerId })}>Remove unavailable host</button>)}
        </fieldset>
        <div className="shared-booking-fields">
          <label className="field"><span>Organizer</span><select required value={event.organizerId} onChange={e => update(event.id, { organizerId: e.currentTarget.value })}><option value="" disabled>Choose a required host</option>{data.hosts.filter(host => event.hostIds.includes(host.principalId)).map(host => <option key={host.principalId} value={host.principalId}>{host.displayName}</option>)}</select></label>
          <label className="field"><span>Meeting room</span><select value={event.location} onChange={e => update(event.id, { location: e.currentTarget.value as SharedEventType["location"] })}><option value="google-meet">Google Meet</option><option value="zoom">Organizer’s Zoom</option></select></label>
        </div>
        <label className="shared-booking-check"><input type="checkbox" checked={event.approvalRequired} onChange={e => update(event.id, { approvalRequired: e.currentTarget.checked })} /> Require organizer approval</label>
        <div className="shared-booking-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setEvents(current => current.filter(item => item.id !== event.id)); setDirty(true); }}>Remove meeting</button>
          {current && !dirty && data.definition?.published ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void onCopy(`${profileUrl}/${encodeURIComponent(event.slug)}`)}><Copy aria-hidden="true" /> Copy shared link</button> : null}</div>
      </fieldset>)}
      <div className="shared-booking-actions">
        <button type="button" className="secondary-button" disabled={busy || events.length >= 20} onClick={() => { setDirty(true); setEvents(current => [...current, { id: crypto.randomUUID(), slug: "", title: "Meet with us", description: "", durationMinutes: 30, hostIds: [], organizerId: "", location: "google-meet", approvalRequired: false }]); }}><Plus aria-hidden="true" /> Add shared meeting</button>
        <button type="submit" className="primary-button" disabled={busy || events.some(event => !event.hostIds.length)}>{live ? "Publish / refresh shared links" : "Claim name and publish"}</button>
        {live ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void onSave({ ...data.definition!, expectedVersion: data.definition!.version, published: false })}>Unpublish shared links</button> : null}
      </div>
      <small>Only confirmed publications produce live links. Refresh shared links after a host updates their shared availability.</small>
    </form>
  </div>;
}
