import type { ServerContext } from "@modelcontextprotocol/server";
import type {
  BrowserParticipant,
  RpcResult,
} from "./control-plane";
import type { RemoteBrowserMcpProps } from "./oauth";
import { hashSecret } from "./security";

export const REMOTE_BROWSER_PARTICIPANT_META_KEY =
  "io.zephyr-cloud/remote-browser-participant" as const;

type PackageConsumerClass = "miniapp" | "specialist" | "workflow" | "other";

type McpConsumerIdentity =
  | {
    readonly kind: "package-contribution";
    readonly installationId: string;
    readonly contributionId: string;
    readonly consumerClass: PackageConsumerClass;
  }
  | { readonly kind: "specialist"; readonly specialistId: string }
  | { readonly kind: "chat"; readonly surfaceId: string }
  | { readonly kind: "workflow"; readonly workflowId: string }
  | { readonly kind: "platform-service"; readonly serviceId: string };

const MAX_HOST_ID_LENGTH = 512;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

function invalid(message: string): RpcResult<never> {
  return {
    ok: false,
    error: {
      status: 401,
      code: "participant_attestation_invalid",
      message,
    },
  };
}

function object(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  return Object.keys(candidate).every((key) => allowedKeys.includes(key))
    ? candidate
    : null;
}

function hostId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_HOST_ID_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function parseConsumer(value: unknown): McpConsumerIdentity | null {
  const tagged = object(value, [
    "kind",
    "installationId",
    "contributionId",
    "consumerClass",
    "specialistId",
    "surfaceId",
    "workflowId",
    "serviceId",
  ]);
  if (!tagged || typeof tagged.kind !== "string") return null;
  if (tagged.kind === "package-contribution") {
    const exact = object(value, [
      "kind",
      "installationId",
      "contributionId",
      "consumerClass",
    ]);
    const installationId = hostId(exact?.installationId);
    const contributionId = hostId(exact?.contributionId);
    const consumerClass = exact?.consumerClass;
    if (
      !installationId ||
      !contributionId ||
      (consumerClass !== "miniapp" &&
        consumerClass !== "specialist" &&
        consumerClass !== "workflow" &&
        consumerClass !== "other")
    ) {
      return null;
    }
    return {
      kind: "package-contribution",
      installationId,
      contributionId,
      consumerClass,
    };
  }
  const field = {
    specialist: "specialistId",
    chat: "surfaceId",
    workflow: "workflowId",
    "platform-service": "serviceId",
  }[tagged.kind];
  if (!field) return null;
  const exact = object(value, ["kind", field]);
  const id = hostId(exact?.[field]);
  if (!id) return null;
  if (tagged.kind === "specialist") {
    return { kind: "specialist", specialistId: id };
  }
  if (tagged.kind === "chat") return { kind: "chat", surfaceId: id };
  if (tagged.kind === "workflow") return { kind: "workflow", workflowId: id };
  return { kind: "platform-service", serviceId: id };
}

function consumerAllowedForParticipant(
  kind: BrowserParticipant["kind"],
  principalId: string,
  consumer: McpConsumerIdentity,
): boolean {
  if (kind === "human") {
    return consumer.kind === "package-contribution" &&
      consumer.consumerClass === "miniapp";
  }
  if (consumer.kind === "specialist") {
    return consumer.specialistId === principalId;
  }
  return consumer.kind !== "package-contribution" ||
    consumer.consumerClass === "specialist" ||
    consumer.consumerClass === "workflow";
}

/**
 * Parses the identity that the TAP host overwrites on every tools/call request.
 * This metadata is not an end-user argument: deployments must ensure the host,
 * rather than an arbitrary MCP client, owns the OAuth channel and replaces the
 * reserved key before dispatch.
 */
export async function browserParticipantFromContext(
  context: ServerContext,
  props: RemoteBrowserMcpProps,
): Promise<RpcResult<BrowserParticipant>> {
  const metadata = context.mcpReq._meta?.[REMOTE_BROWSER_PARTICIPANT_META_KEY];
  if (metadata === undefined) {
    return invalid("Host-attested Remote Browser participant metadata is required.");
  }
  const attestation = object(metadata, [
    "version",
    "workspaceId",
    "requestingUserId",
    "participant",
    "consumer",
  ]);
  const participant = object(attestation?.participant, [
    "kind",
    "principalId",
    "instanceId",
  ]);
  const workspaceId = hostId(attestation?.workspaceId);
  const requestingUserId = hostId(attestation?.requestingUserId);
  const principalId = hostId(participant?.principalId);
  const instanceId = participant?.instanceId;
  const kind = participant?.kind;
  const consumer = parseConsumer(attestation?.consumer);
  if (
    attestation?.version !== 1 ||
    !workspaceId ||
    !requestingUserId ||
    (kind !== "human" && kind !== "agent") ||
    !principalId ||
    typeof instanceId !== "string" ||
    !SHA256_HEX.test(instanceId) ||
    !consumer
  ) {
    return invalid("Host-attested Remote Browser participant metadata is malformed.");
  }
  if (
    workspaceId !== props.owner.workspaceId ||
    requestingUserId !== props.userId
  ) {
    return invalid("Host-attested Remote Browser participant metadata does not match OAuth.");
  }
  if (kind === "human" && principalId !== props.userId) {
    return invalid("A human Remote Browser participant must match the requesting OAuth user.");
  }
  if (!consumerAllowedForParticipant(kind, principalId, consumer)) {
    return invalid("The attested MCP consumer cannot assume this browser participant kind.");
  }
  if (
    consumer.kind === "package-contribution" &&
    consumer.installationId !== props.owner.installationId
  ) {
    return invalid("The attested package consumer does not match the OAuth installation.");
  }

  const consumerKey = JSON.stringify(consumer);
  const digest = await hashSecret(JSON.stringify([
    1,
    workspaceId,
    requestingUserId,
    kind,
    principalId,
    instanceId,
    consumerKey,
    props.owner.packageId,
    props.owner.installationId,
    props.owner.contributionId,
  ]));
  return {
    ok: true,
    value: {
      participantId: `rp_${digest}`,
      owner: props.owner,
      requestingUserId,
      kind,
      principalId,
      instanceId,
      consumerKind: consumer.kind,
      consumerKey,
    },
  };
}
