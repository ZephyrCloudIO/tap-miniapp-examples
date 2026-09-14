# TAP Calendar

TAP Calendar owns personal scheduling, availability, and the public surfaces through which guests request time.

## Public scheduling

**Booking Profile**:
An organizer identity and its collection of Event Types. A Booking Profile has one globally unique Profile Namespace.

**Profile Namespace**:
The globally unique first path segment of a Booking Profile’s public URL. Publishing a Booking Profile claims its Profile Namespace even when the profile has no Event Types.
_Avoid_: Username, profile slug

**Event Type**:
A reusable kind of appointment offered by a Booking Profile, including its duration, location, approval policy, and availability.

**Booking Page**:
The guest-visible scheduling surface for one active Event Type.

**Publication**:
The server-confirmed public state of a Booking Profile and its active Booking Pages. A published Booking Profile may have zero Booking Pages.
_Avoid_: Claim, reservation
