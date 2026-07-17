# Family Task Board

**Status:** Approved
**Audience:** Consumer
**Data approach:** Application-owned API integrated with TAP platform capabilities

## Product idea

Family Task Board is a shared household application for chores, schedules, activities, rewards, and a family star economy. Parents and children get role-appropriate views, while Chloe provides conversational access to the same structured household state.

The example should show that a TAP miniapp can be a complete, multi-user product—not merely a chat interface.

## Core experience

Parents can:

- Create one-time and recurring chores.
- Assign chores to one child, multiple children, or a rotation.
- Mark chores as required or extra credit.
- Set due dates, star values, reminders, and approval requirements.
- Review submitted chores and see household progress.
- Award bonus stars with a note.
- Deduct stars with a required reason and confirmation.
- Define rewards in a family shop.
- Approve rewards and mark them consumed.

Children can:

- See a simple view of required chores, extra-credit opportunities, and activities for today.
- Mark chores complete and optionally submit a note or photo.
- Earn stars for approved work.
- Review their star balance and transaction history.
- Exchange stars with another child after both children confirm the transfer.
- Purchase parent-defined items from the family shop.
- See purchased rewards that are waiting to be used.

## Chloe interactions

Children can ask:

- “What do I need to do today?”
- “When should I do my chores around soccer practice?”
- “What can I do to earn three more stars?”
- “How many stars do I have?”
- “Give Mia three stars for helping me clean up.”
- “Can I buy 30 minutes of screen time?”

Parents can ask:

- “Who did their chores already?”
- “What is still outstanding tonight?”
- “Who has soccer today?”
- “Give Mia two bonus stars for helping her brother.”
- “Take one star from Noah for not putting his bike away.”
- “Add cleaning the playroom as a five-star extra-credit task.”
- “What rewards are waiting to be used?”
- “Mark Noah’s screen time as consumed.”

## Star ledger and exchanges

Stars are tracked in an append-only ledger. Transactions include chore earnings, bonuses, deductions, child-to-child transfers, purchases, refunds, and adjustments.

A transfer between children follows a two-party confirmation flow:

1. The sender proposes an amount and note.
2. The sender confirms the proposal.
3. The receiving child accepts or declines it.
4. Stars move only after both children have confirmed.
5. Parents can review the exchange history.

Parents may configure a transfer limit or require parental approval above a threshold.

## Family shop

Parents define rewards such as:

- A favorite snack
- Screen time
- Choosing the family movie
- Staying up later
- Picking dinner
- A one-on-one activity with a parent
- Ice cream or another outing
- A larger reward that children can save toward together

Each item may have a price, description, image, availability schedule, inventory, per-child limit, expiration, eligibility rules, and approval requirement.

Purchasing and consuming are separate actions:

`requested → approved → ready → consumed`

Alternate states include `declined`, `cancelled`, `expired`, and `refunded`. A parent marks a reward consumed after the snack or activity is actually used.

## Calendar-aware planning

Chloe combines chores with sports, school, appointments, and family activities. The daily plan should account for deadlines and available time rather than presenting an isolated task list.

Example response:

> You have soccer practice at 5:30. Before then, you need to feed Pepper and put away your laundry. You can also earn two extra stars by watering the plants.

## Roles and safeguards

- Children can update their own work but cannot change chore values or directly edit balances.
- Parents manage chores, shop inventory, approvals, and star adjustments.
- Chloe may freely answer read-only questions.
- Consequential changes require confirmation from the authorized person.
- Deductions require a parent, a reason, and confirmation.
- Star transfers require confirmation from both participating children.
- The ledger preserves the actor, reason, timestamp, and related task or reward.

## Application API

The example backend should provide resources for:

- Households, members, guardians, and roles
- Chores, recurrence, assignments, submissions, and approvals
- Calendar events and activities
- Star accounts and immutable ledger entries
- Transfer proposals and confirmations
- Shop items, inventory, purchases, approvals, and consumption
- Notifications and activity history

The API should ship with resettable demo households and deterministic sample data.

## TAP capabilities demonstrated

- Desktop and mobile UI surfaces
- Role-based authorization and consequential-action consent
- Structured tools for querying and changing application state
- Chloe/specialist interaction over shared data
- Multi-party approval workflows
- Events and notifications
- Persistent state and lifecycle checkpoints
- External HTTP integration
- Auditable transactions

## Public example value

This is a relatable application with enough depth to demonstrate permissions, agent-assisted planning, multi-user state, transactional workflows, and a custom API. It gives developers a concrete blueprint for building consumer products on TAP.
