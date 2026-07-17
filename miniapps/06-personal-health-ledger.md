# Personal Health Ledger

**Status:** Approved
**Audience:** Consumer
**Data approach:** Private personal records, inventory, research monitoring, and official safety data
**Product boundary:** Tracking and evidence support, not diagnosis or prescribing

## Product idea

Personal Health Ledger helps someone privately track vitamins, supplements, prescribed medications, and peptides in one structured place. It records what they plan to take, what they actually took, inventory and orders, reconstitution events, subjective and objective results, and emerging research.

The miniapp should make it easier to understand a complex regimen and prepare accurate information for a clinician. It must not act as a prescriber, recommend an unapproved substance, provide individualized dosing, direct a user to a supplier, or turn preliminary research into medical advice.

## Outcomes

The app should help a user:

- Maintain an accurate list of active, paused, planned, and discontinued items.
- Record schedule, dose as prescribed or entered, route, and actual administrations.
- Know how much inventory remains and when it may run out.
- Track orders, shipments, receipts, lots, and expiration dates.
- Record reconstitution details from a clinician, pharmacy label, or manufacturer instructions.
- Relate regimen changes to symptoms, measurements, laboratory values, and other outcomes.
- Follow new papers, clinical trials, safety notices, and regulatory changes.
- Pull preclinical, mechanistic, and non-human research alongside human evidence.
- Search current web and X discussions through the existing Grok API integration.
- Separate peer-reviewed evidence from preprints, news, vendor claims, and community posts.
- Export a concise medication and supplement history for a health professional.

## Example interactions

- “What am I scheduled to take today?”
- “What did I actually take yesterday?”
- “How many doses remain in this vial based on my logged administrations?”
- “Which items will run out in the next two weeks?”
- “Record that my new order arrived today.”
- “Show the lot number and expiration date for the vial I am currently using.”
- “When was this vial reconstituted, and what label instructions did I record?”
- “What changed in my regimen before my sleep score improved?”
- “Find new human studies about this peptide.”
- “Show me new papers since my last review.”
- “Separate clinical evidence from anecdotal posts.”
- “Include animal and in-vitro research in this update.”
- “Use Grok to find what people are reporting about this peptide on X.”
- “Show me everything, including unapproved compounds.”
- “Prepare a summary for my appointment.”

## Research scope controls

The user controls what enters discovery and tracking. Regulatory status is a filter and factual attribute, not a moral judgment or an automatic exclusion.

The primary scope toggle supports:

- **Approved only:** show substances and products approved for the selected jurisdiction, while retaining relevant safety and regulatory updates.
- **Include unapproved:** include compounded products, investigational compounds, research peptides, gray-market substances, and newly discussed molecules.

Advanced evidence filters support any combination of:

- Human clinical evidence
- Registered human trials without results
- Animal research
- In-vitro and mechanistic research
- Preprints
- Regulatory and enforcement material
- Expert commentary
- Web posts, X posts, forums, and personal anecdotes

The user's chosen scope applies to search, feeds, watchlists, and summaries. The UI should not repeatedly interrupt an informed user merely because an item is unapproved. It should still display regulatory status, evidence stage, known safety signals, and major unknowns as concise factual fields that cannot be mistaken for approval or established safety.

Users may save multiple views, such as `FDA-approved only`, `all human evidence`, `preclinical watchlist`, and `X/community pulse`.

## Regimen model

Each tracked item should include:

- Canonical and user-facing name
- Category: vitamin, supplement, approved medication, compounded medication, peptide, or other
- Regulatory and evidence status by jurisdiction when known
- Form, route, and concentration as entered from the label or prescription
- Intended purpose in the user's own words
- Prescriber or clinician, when applicable
- Pharmacy or source record without promotional supplier recommendations
- Start, pause, resume, and stop dates
- Planned schedule
- Planned dose copied from an authoritative instruction or entered by the user
- Reminders and allowed reminder windows
- User notes and clinician questions
- Linked inventory lots, administrations, results, research, and documents

Every change is versioned. Editing a schedule creates a new effective period rather than rewriting prior history.

## Administration and dosage tracking

The administration log records what occurred rather than assuming completion from a reminder.

An entry may include:

- Item and inventory lot
- Planned and actual time
- Dose and unit as entered
- Route and optional site
- Taken, skipped, delayed, partial, or uncertain status
- Reason for variation
- Immediate note or reaction
- Source of instruction: prescription, pharmacy label, manufacturer, clinician, or self-entered

The UI should clearly distinguish a planned dose from a recorded administration. It should warn about unit mismatches or impossible inventory arithmetic but must not choose a dose or modify a medical instruction.

Voice or conversational logging should read the structured interpretation back for confirmation before saving quantities, units, or routes.

## Inventory and orders

Inventory is tracked by discrete lot or container rather than only by product name.

Each inventory record may include:

- Quantity received and current estimated quantity
- Unit, form, vial or container size, and count
- Lot or batch number
- Manufacture and expiration dates
- Pharmacy, manufacturer, or seller as factual provenance
- Prescription or order reference
- Received condition and packaging notes
- Storage instructions copied from an authoritative source
- Opened, reconstituted, discarded, or depleted dates
- Linked certificate, label photo, prescription, or receipt

Order tracking should include ordered, confirmed, shipped, delivered, partially received, cancelled, returned, and disputed states. The app can estimate a run-out date from the user's actual log and notify them, but it should not automatically reorder prescription or unapproved products.

## Reconstitution record

Reconstitution tracking is an auditable record, not an instruction generator.

The user can record:

- Product, vial, lot, and labeled amount
- Reconstitution date and time
- Diluent identity, lot, and volume as documented by the user
- Resulting concentration calculated from confirmed entered values
- Person who performed or supervised it
- Authoritative instruction source
- Storage requirements copied from that source
- Beyond-use or discard date from the pharmacy, manufacturer, or clinician
- Visual inspection notes
- Administrations drawn from that vial
- Remaining estimated volume and discrepancy notes

The app may perform transparent unit conversion and arithmetic after the user confirms every input. It must display the formula and original values, refuse ambiguous units, and never infer a reconstitution recipe, diluent, storage condition, beyond-use date, or dose.

If a user asks how to reconstitute or dose a substance, the specialist should direct them to the dispensing pharmacy or qualified clinician and help prepare specific questions.

## Results tracking

The user can define outcomes before or during a regimen period:

- Symptoms and side effects
- Mood, energy, sleep, appetite, pain, and recovery
- Weight, measurements, blood pressure, heart rate, or other device readings
- Laboratory values with unit, reference range, laboratory, and collection time
- Photos or documents with explicit privacy controls
- Training, diet, illness, travel, and other confounding events
- User-defined goals and perceived benefit

The app can visualize changes over time and identify temporal associations. It must not claim that an item caused an improvement or adverse effect merely because one followed the other.

Comparison views should show concurrent regimen changes and confounders. Reports use language such as “occurred after,” “correlated with,” or “the user reported,” not unsupported causal conclusions.

## Research and discovery

Users can follow substances, mechanisms, conditions, outcomes, authors, journals, or saved searches.

Preferred official sources include:

- PubMed and PubMed Central through NCBI E-utilities
- ClinicalTrials.gov through its data API
- FDA safety communications and compounding risk alerts
- openFDA drug labels, adverse-event reports, and recall data
- Other jurisdiction-specific regulators added through reviewed connectors
- xAI Grok Web Search and X Search for current commentary and anecdotal discovery

The research monitor can notify users about:

- New peer-reviewed papers
- New systematic reviews or meta-analyses
- New or updated clinical trials and posted results
- Safety communications, recalls, or enforcement actions
- Regulatory-status changes
- New substances matching a saved scientific query
- New posts from explicitly followed sources
- New X posts, threads, and linked discussions discovered through Grok

### Evidence hierarchy

Every result is labeled by source type:

1. Regulatory safety information and approved labeling
2. Clinical guidelines and systematic reviews
3. Randomized controlled human trials
4. Observational human studies
5. Case reports
6. Registered trials without results
7. Preprints
8. Animal studies
9. In-vitro, ex-vivo, and mechanistic research
10. Expert commentary
11. Vendor material, social posts, forums, and personal anecdotes

The ordering is a display framework, not an automatic quality score. Study design, population, dose, route, comparator, sample size, conflicts, and applicability still require review.

### Non-human and mechanistic evidence

The research monitor should intentionally retrieve relevant non-human work instead of treating it as a footnote. For each result, capture:

- Species, strain, sex, age, and sample size
- In-vivo, in-vitro, ex-vivo, or computational design
- Tissue, cell line, assay, or disease model
- Route, exposure, concentration, and duration
- Comparator and measured endpoints
- Proposed mechanism
- Replication and methodological limitations
- Whether comparable human exposure or pharmacokinetic data exist

Summaries must not silently translate an animal or cell-culture exposure into a human dose. They should explain what the study establishes mechanistically, what remains unknown, and whether later human evidence supports or contradicts it.

### New posts and community sources

Users may explicitly follow blogs, newsletters, forums, feeds, authors, or communities. These posts appear in a separate anecdotal or commentary feed and are never merged with clinical findings.

The app should preserve author, publication date, source link, edits when detectable, and any disclosed conflicts. It must not recommend vendors, facilitate acquisition of unapproved drugs, or treat popularity as evidence.

### Grok anecdotal discovery

The preferred anecdotal-discovery path uses TAP's existing xAI/Grok API integration with Grok's server-side Web Search and X Search tools.

Grok should search for:

- First-person reports
- Emerging terminology and alternate compound names
- Frequently reported perceived effects
- Frequently reported adverse experiences
- Dosing and route claims as observations to catalog, not instructions to adopt
- Product-quality or contamination discussions
- Links from posts to papers, trial records, regulatory material, or laboratory reports
- Disagreements and counterexamples

Every extracted claim should retain the post or page URL, author or handle, publication time, retrieval time, quoted excerpt within permitted limits, and engagement context when available. Deleted or inaccessible sources remain marked unavailable rather than silently disappearing from prior summaries.

Grok output is a discovery and synthesis layer, not the evidence record itself. The app stores the returned citations and retrieves primary linked sources separately when possible.

Anecdotal summaries should report patterns carefully—for example, “12 retrieved posts described X”—without implying prevalence, incidence, representativeness, or causality. Search and ranking algorithms create substantial selection bias.

The user can configure followed accounts, keywords, date range, included or excluded domains, X-only versus broader web search, refresh cadence, and maximum search spend.

### New peptides watchlist

“New peptides” means newly indexed research subjects, trial interventions, regulatory entries, or user-followed scientific terms—not a catalog encouraging use.

Each entry should summarize:

- Alternate names and identifiers
- Proposed mechanism
- Research stage
- Human evidence, if any
- Routes and populations actually studied
- Regulatory status by selected jurisdiction
- Known safety signals and major unknowns
- Whether the evidence concerns an approved product, compounded product, or research substance
- Links to primary sources

The specialist should explicitly say when human exposure or safety data are absent or limited.

## Research summaries

The health research specialist can summarize a paper but must:

- Retrieve and cite the primary source.
- Distinguish abstract-only access from full-text review.
- Describe study design, population, intervention, comparator, duration, outcomes, and limitations.
- Report absolute numbers when available rather than only relative effects.
- Identify animal, in-vitro, preprint, retracted, corrected, or observational evidence.
- Avoid extrapolating between routes, formulations, populations, or doses.
- Avoid translating a study dose into an individualized recommendation.
- Disclose when a paper does not answer the user's practical question.

## Personal health specialist

The packaged specialist helps users retrieve and organize their own records, monitor evidence, and prepare questions for clinicians.

### Preferred model and provider

The specialist's preferred model provider is the existing TAP xAI/Grok API integration. The manifest should express a Grok model preference rather than hard-coding an eternal model ID; at runtime, the integration resolves an allowed current model from xAI's model catalog and workspace policy.

The preferred research configuration enables:

- Grok reasoning for synthesis
- `web_search` for current pages and linked sources
- `x_search` for X posts, users, and threads
- Returned citations and server-side tool-usage receipts
- TAP function tools for reading the private ledger and saving reviewed results

Private health records must be minimized before being sent to xAI. Research queries should use the substance and scientific question without attaching identity, full regimen, medical history, or personal outcomes unless the user explicitly approves that disclosure for the particular request.

If Grok or its search tools are unavailable, the specialist may fall back to another workspace-approved model for ledger operations and official-source research. The UI should disclose the active model and which external search tools were used.

It may:

- Log a confirmed administration.
- Summarize regimen and inventory history.
- Find discrepancies or missing records.
- Estimate inventory depletion from confirmed entries.
- Summarize research with citations and evidence labels.
- Prepare a clinician-facing timeline or question list.
- Highlight that a symptom followed a change and recommend discussing it with a clinician.

It must not:

- Diagnose a condition.
- Select, initiate, stop, or alter a substance or dose.
- Generate a peptide cycle or stacking protocol.
- Recommend a supplier or acquisition method.
- Provide reconstitution or injection instructions.
- Present community reports as clinical evidence.
- Guarantee safety because no interaction or adverse event was found.
- Override a prescription, label, pharmacist, or clinician.

### Tone

The specialist should be direct, technical, and fact-first. It should not moralize about an informed adult's decision to track an unapproved or gray-market substance. It should answer the question asked, label what is known and unknown, show sources, and let the user make decisions.

Concise regulatory status and serious safety data remain part of the factual record. The specialist should avoid repetitive boilerplate warnings, but it must not suppress a known serious signal, fabricate reassurance, or blur the difference between approved, investigational, compounded, and gray-market products.

### Task-specific prompt: administration logging

1. Resolve the exact item, formulation, concentration, lot, dose, unit, route, date, and time.
2. Compare with the active plan only to identify discrepancies, not to reject the user's record.
3. Read back the structured entry and request confirmation.
4. Save it as an observed event with source attribution.
5. Update inventory through transparent arithmetic and flag discrepancies.

### Task-specific prompt: research update

1. Use the user's saved query and last-reviewed timestamp.
2. Search authoritative sources first and retrieve stable identifiers.
3. Deduplicate versions, corrections, and cross-indexed records.
4. Label evidence type, human applicability, route, and regulatory status.
5. Summarize findings and limitations without dosage advice.
6. Separate primary evidence, commentary, and anecdote.
7. Apply the user's approved-only/unapproved and evidence-type filters exactly.
8. Use Grok Web Search and X Search for anecdotal discovery when enabled, preserving returned citations.

### Task-specific prompt: anecdotal pulse

1. Read the user's substance terms, aliases, time window, followed sources, and search-budget limit.
2. Use Grok X Search and Web Search; preserve every returned source citation.
3. Extract first-person claims, reported effects, adverse experiences, route and dose claims, product-quality concerns, and links to primary material.
4. Deduplicate reposts and distinguish firsthand reports from repetition or commentary.
5. Summarize recurring and contradictory themes without estimating population prevalence.
6. Keep anecdotes separate from clinical and preclinical evidence.
7. Do not convert reported protocols into personalized dosing recommendations.

### Task-specific prompt: results review

1. Establish the outcome and time period selected by the user.
2. Retrieve contemporaneous administrations, regimen changes, illness, sleep, diet, training, and other recorded confounders.
3. Show the timeline and data completeness.
4. Describe associations without assigning causality.
5. Identify questions or records worth taking to a clinician.

### Task-specific prompt: appointment summary

1. Confirm the date range and intended clinician.
2. Include current regimen, recent changes, actual adherence, inventory or product provenance, reported effects, adverse events, and relevant results.
3. Separate prescribed, clinician-supervised, self-directed, and discontinued items.
4. Include exact units and dates; preserve uncertainty.
5. Produce a concise report plus an appendix with detailed logs and citations.

## Safety and escalation

The app should provide prominent access to emergency and poison-control resources appropriate to the user's configured jurisdiction. It must not attempt to manage an emergency conversationally.

Users can record adverse events and mark severity, timing, item, lot, and action taken. Serious or worsening symptoms should trigger a clear recommendation to seek appropriate professional or emergency help rather than waiting for an agent response.

The app may link users to official reporting systems such as FDA MedWatch. It should not submit a report, contact a clinician, or alert another person without the user's confirmation except where an explicitly configured emergency workflow and applicable law permit it.

Regulatory warnings must remain visible on affected items and should not be dismissible as ordinary notifications.

## Privacy and security

Health, medication, order, and research-interest data are highly sensitive.

- Records are private to the user by default.
- Sharing is explicit, scoped, revocable, and recorded.
- Health data must not enter public or workspace-wide knowledge plots.
- A private personal Knowledge Garden plot may contain curated summaries; raw logs and documents remain in protected storage.
- Secrets and pharmacy credentials remain host-managed.
- Data is encrypted in transit and at rest.
- Exports and backups are user-controlled.
- The user can delete records subject to clearly explained audit and backup behavior.
- Analytics must not expose regimen, condition, substance, or research-query content.
- No advertising or sale of health profiles.

The design should not claim HIPAA compliance merely because it uses security controls. Applicable regulatory obligations depend on deployment, entities, contracts, and data flows.

## Data import and export

The first version should support:

- Manual entry and conversational confirmation
- Label, receipt, and document attachment
- CSV import and export
- A printable or HTML clinician summary
- A complete machine-readable personal archive

Future integrations may include pharmacies, laboratories, health records, wearables, and health-data platforms only through supported APIs and explicit user authorization.

## TAP capabilities demonstrated

- Private structured personal data
- Conversational logging with confirmation
- Inventory, lots, orders, and derived run-out estimates
- Versioned schedules and administration history
- Reconstitution records without procedural advice
- Research and regulatory API workflows
- Grok-preferred specialist using Web Search and X Search
- Scheduled literature and safety monitoring
- Approved-only/unapproved and human/preclinical/anecdotal scope controls
- Evidence-aware specialist prompts
- Sensitive knowledge and artifact permissions
- Interactive longitudinal charts
- Exportable clinician reports
- Reminders, lifecycle checkpoints, and retained state

## Implementation phases

### Phase 1: ledger

- Regimen, schedule, and administration tracking
- Inventory, lots, expiration, and orders
- Reconstitution records
- Reminders and run-out estimates
- Private export and appointment summary

### Phase 2: outcomes

- Symptoms, measurements, labs, and confounders
- Timeline comparison and visualization
- Adverse-event records and safety links
- Personal Health specialist

### Phase 3: research monitor

- PubMed and ClinicalTrials.gov saved searches
- FDA and openFDA safety monitoring
- Source-tiered human, animal, in-vitro, preprint, and peptide watchlists
- Grok Web Search and X Search anecdotal monitoring
- Scheduled summaries and reviewed personal Knowledge Garden entries

## Public example value

Personal Health Ledger demonstrates how TAP can combine private longitudinal data, inventory, reminders, research APIs, evidence-aware agents, and visual analysis in a sensitive consumer application. Its safeguards also provide a reference for building useful health software without quietly turning an assistant into an unlicensed prescriber.

## References

- [NCBI developer APIs](https://www.ncbi.nlm.nih.gov/home/develop/api/)
- [ClinicalTrials.gov data API](https://clinicaltrials.gov/data-api/about-api)
- [openFDA APIs](https://open.fda.gov/apis/)
- [FDA information on compounded-drug risks](https://www.fda.gov/drugs/human-drug-compounding/understanding-risks-compounded-drugs)
- [FDA bulk substances that may present significant safety risks](https://www.fda.gov/drugs/human-drug-compounding/certain-bulk-drug-substances-use-compounding-may-present-significant-safety-risks)
- [xAI Web Search documentation](https://docs.x.ai/developers/tools/web-search)
- [xAI tool overview, including X Search](https://docs.x.ai/developers/tools/overview)
