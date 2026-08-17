# Research communication and conferencing delivery contracts

Type: research
Status: resolved

## Question

What current first-party APIs, account requirements, guest limitations, consent rules, delivery semantics, and lifecycle callbacks govern email, SMS, WhatsApp, Telegram, Google Meet, Microsoft Teams, Zoom, Webex, GoTo Meeting, TAP-native meeting rooms, and TAP Voice Huddles?

## Answer

TAP must own durable reminder timing, consent, retries, deduplication, normalized delivery history, and reconciliation. Cloudflare Email Service is suitable for transactional email, but its documented later-delivery state is retrieved through logs/GraphQL polling rather than push callbacks. SMS and WhatsApp require channel-specific consent; WhatsApp requires approved templates outside its customer-service window. Telegram requires user-initiated bot binding and provides no delivery/read receipt.

Google Meet and Teams should be calendar-backed; Zoom, Webex, and GoTo use separate meeting resources. Guest access is determined by host, license, and tenant policy and must be capability-checked. GoTo has no documented Meeting webhook contract. Provider callbacks are signed, deduplicated hints followed by API reconciliation.

Current TAP voice is a live authenticated workspace audio session, so scheduled TAP Voice Huddles require a new Booking-to-room binding. No schedulable TAP-native video-room contract was found, making that a new host primitive. Both remain unavailable to External Guests.

Research artifact: `research/tap-calendar-communication-conferencing-contracts` at `caf6e40ded9e733a4c43f271a7e84fc2e2546d89`, file `docs/research/calendar-miniapp/communication-conferencing-contracts.md`.

Remaining decisions are owned by downstream tickets: communication sender tenancy and legal launch matrix, email delivery-SLA adequacy, conferencing authorization modes, whether uncertain guest access blocks publication, GoTo production supportability, TAP push/wake and meeting-room contracts, and whether attendance artifacts are in scope.
