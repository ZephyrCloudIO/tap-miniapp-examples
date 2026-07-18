import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import type { Actor, Investigation, PlatformBindings } from "./domain";

export interface PlatformContext {
  preview: boolean;
  workspaceId?: string;
  channelId?: string;
  conversationId?: string;
  events?: TapFederatedSurfaceMountContext["events"];
}

export interface PlatformStatus {
  actor: Actor;
  connected: boolean;
  presenceCount: number;
  workflows: Array<{ id: string; name: string; type: string }>;
  error?: string;
}

export const previewActor: Actor = { id: "preview-lead", displayName: "Alex Morgan" };

export async function bootstrapPlatform(context: PlatformContext): Promise<PlatformStatus> {
  if (context.preview) return { actor: previewActor, connected: false, presenceCount: 1, workflows: [] };
  try {
    const profilePromise = sdk.auth?.getUserProfile();
    const workflowsPromise = sdk.workflows.list(context.workspaceId ? { workspaceId: context.workspaceId } : undefined);
    const presencePromise = context.workspaceId
      ? sdk.presence.join({ namespace: "pyre", room: context.workspaceId, state: { view: "investigations" } })
      : undefined;
    const [profile, workflows, presence] = await Promise.all([profilePromise, workflowsPromise, presencePromise]);
    const actor: Actor = profile
      ? { id: profile.sub, displayName: profile.name || profile.preferredUsername || profile.email || "TAP user" }
      : presence
        ? { id: presence.selfParticipantId, displayName: presence.participants.find((p) => p.participantId === presence.selfParticipantId)?.displayName || "TAP user" }
        : { id: "workspace-user", displayName: "Workspace user" };
    return { actor, connected: true, presenceCount: presence?.participants.length || 1, workflows: workflows.workflows };
  } catch (error) {
    return { actor: { id: "workspace-user", displayName: "Workspace user" }, connected: false, presenceCount: 1, workflows: [], error: String(error) };
  }
}

export function subscribePresence(context: PlatformContext, listener: (count: number) => void): () => void {
  if (context.preview || !context.workspaceId) return () => undefined;
  return sdk.presence.subscribe({ namespace: "pyre", room: context.workspaceId }, (snapshot) => listener(snapshot.participants.length));
}

export async function provisionInvestigation(
  investigation: Investigation,
  context: PlatformContext,
): Promise<PlatformBindings> {
  if (context.preview) throw new Error("TAP workspace provisioning is available only in packaged execution.");
  const project = await sdk.projects.create({
    workspaceId: context.workspaceId,
    id: investigation.id,
    name: `Pyre — ${investigation.title}`,
    discoverable: false,
  });
  const channel = await sdk.channels.create({
    workspaceId: context.workspaceId,
    name: `pyre-${investigation.id.slice(-8)}`,
    description: `Evidence-driven investigation: ${investigation.title}`,
    projectId: project.projectId,
    visibility: "private",
  });
  await sdk.projects.update({ workspaceId: context.workspaceId, projectId: project.projectId, channelIds: [channel.roomId] });
  await sdk.channels.sendMessage({
    workspaceId: context.workspaceId,
    channelId: channel.roomId,
    clientMessageId: `pyre-intake-${investigation.id}`,
    name: "Pyre investigation created",
    content: investigation.statement,
    body: `**Pyre investigation created**\n\n${investigation.statement}\n\nImpact: ${investigation.impact}`,
    messageContent: { type: "pyre.investigation", incidentId: investigation.id, revision: investigation.revision },
  });
  let vfsRoot: string | undefined;
  if (sdk.vfs && context.conversationId) {
    await sdk.vfs.provisionProjectChat({ conversationId: context.conversationId, projectId: project.projectId });
    vfsRoot = `/pyre/${investigation.id}`;
    await sdk.vfs.mkdir(context.conversationId, `${vfsRoot}/evidence`);
    await sdk.vfs.mkdir(context.conversationId, `${vfsRoot}/reports`);
    await sdk.vfs.mkdir(context.conversationId, `${vfsRoot}/receipts`);
    await sdk.vfs.writeFile(
      context.conversationId,
      `${vfsRoot}/incident.json`,
      new TextEncoder().encode(JSON.stringify(investigation, null, 2)),
    );
  }
  return {
    projectId: project.projectId,
    channelId: channel.roomId,
    vfsConversationId: context.conversationId,
    vfsRoot,
  };
}

export async function installSpecialist(investigation: Investigation, context: PlatformContext): Promise<string> {
  if (context.preview) throw new Error("The Pyre specialist can be installed only in packaged execution.");
  if (!sdk.specialist?.upsertManaged) throw new Error("This TAP host does not expose managed specialist installation.");
  if (!investigation.bindings.channelId) throw new Error("Create the investigation channel before installing the specialist.");
  const managed = await sdk.specialist.upsertManaged({
    id: "pyre-investigation-specialist",
    slug: "pyre-investigator",
    name: "Pyre Investigator",
    publisher: "The AI Platform Examples",
    description: "Neutral incident facilitator and evidence analyst.",
    icon: "flame",
    category: "operations",
    version: "0.1.0",
    systemPrompt: "You are Pyre, a neutral and blameless incident facilitator. Retrieve current investigation state before status claims. Label facts, hypotheses, inferences, and recommendations. Cite evidence for material claims. Surface contradictions. Never invent timestamps, impact, causes, owners, or publication success. Ask one focused causal question at a time. Never publish or notify without explicit human approval.",
    prompts: {
      intake: "Extract supplied facts only; draft an observable statement; identify missing time, impact, scope, ownership, and sources.",
      timeline: "Normalize timestamps, retain originals, deduplicate with provenance, mark conflicts and gaps, and request review.",
      why: "Restate supported claim and evidence, ask one causal question, keep answers hypothetical until supported, and ask what would falsify them.",
      evidence: "Assess exact claim, source completeness and access, support or contradiction, alternatives, gaps, and transparent confidence.",
      actions: "Link actions to reviewed factors, define owner, acceptance, verification, required evidence, side effects, and rollback.",
      report: "Use reviewed state and cited evidence, preserve uncertainty and dissent, use blameless language, and require approval.",
      notes: "Extract candidate facts, events, evidence, hypotheses, decisions, questions, and actions with message provenance; request confirmation for material interpretations.",
      briefing: "Respect requesting participant permissions; summarize status, impact, timeline, hypotheses, evidence gaps, decisions, questions, and actions.",
    },
    tasks: [
      { id: "incident-intake", name: "Incident intake" },
      { id: "timeline-construction", name: "Timeline construction" },
      { id: "facilitate-why", name: "Facilitate a Why" },
      { id: "evidence-assessment", name: "Evidence assessment" },
      { id: "corrective-actions", name: "Corrective actions" },
      { id: "incident-report", name: "Incident report" },
      { id: "channel-notes", name: "Channel note taking" },
      { id: "participant-briefing", name: "New participant briefing" },
    ],
    constraints: { approvalRequired: ["causal-conclusion", "action-acceptance", "report-approval", "publication"] },
    tags: ["incident-response", "root-cause-analysis", "evidence", "blameless"],
    supportsLocal: true,
    requiresNetwork: false,
  });
  await sdk.specialist.joinToChannel(investigation.bindings.channelId, managed.specialistId);
  return managed.specialistId;
}

export async function postCheckpoint(investigation: Investigation, context: PlatformContext): Promise<string> {
  if (!investigation.bindings.channelId) throw new Error("This investigation is not attached to a TAP channel.");
  const result = await sdk.channels.sendMessage({
    workspaceId: context.workspaceId,
    channelId: investigation.bindings.channelId,
    clientMessageId: `pyre-checkpoint-${investigation.id}-r${investigation.revision}`,
    name: "Pyre checkpoint",
    content: `Revision ${investigation.revision}`,
    body: `**Pyre checkpoint — revision ${investigation.revision}**\n\n${investigation.statement}\n\nEvidence: ${investigation.evidence.length} · Timeline events: ${investigation.timeline.length} · Causal claims: ${investigation.whys.length} · Open actions: ${investigation.actions.filter((action) => action.status !== "verified").length}`,
    messageContent: { type: "pyre.checkpoint", incidentId: investigation.id, revision: investigation.revision },
  });
  return result.messageId;
}

export async function captureEvidenceFile(
  investigation: Investigation,
  context: PlatformContext,
  evidenceId: string,
  filename: string,
  bytes: Uint8Array,
  receipt: object,
): Promise<{ vfsPath: string; receiptPath: string }> {
  if (!sdk.vfs || !investigation.bindings.vfsConversationId || !investigation.bindings.vfsRoot) {
    throw new Error("VFS evidence capture requires a provisioned project conversation in packaged TAP execution.");
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const vfsPath = `${investigation.bindings.vfsRoot}/evidence/${evidenceId}-${safeName}`;
  const receiptPath = `${investigation.bindings.vfsRoot}/receipts/${evidenceId}.json`;
  await sdk.vfs.writeFile(investigation.bindings.vfsConversationId, vfsPath, bytes);
  await sdk.vfs.writeFile(
    investigation.bindings.vfsConversationId,
    receiptPath,
    new TextEncoder().encode(JSON.stringify(receipt, null, 2)),
  );
  return { vfsPath, receiptPath };
}

export async function invokeCollectionWorkflow(
  workflowId: string,
  investigation: Investigation,
  payload: Record<string, unknown>,
): Promise<{ runId?: string | null; message: string }> {
  const result = await sdk.workflows.invokeSaved({
    workflowId,
    payload: { incidentId: investigation.id, vfsRoot: investigation.bindings.vfsRoot || null, ...payload },
  });
  if (!result.success) throw new Error(result.error || result.message || "The collection workflow failed.");
  return { runId: result.runId, message: result.message };
}
