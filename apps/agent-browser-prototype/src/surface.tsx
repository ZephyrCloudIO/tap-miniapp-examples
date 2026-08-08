import "@theaiplatform/miniapp-sdk/ui/styles.css";
import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from "@theaiplatform/miniapp-sdk/surface";
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import { installMiniAppAppearanceSync } from "@theaiplatform/miniapp-sdk/web";
import { createRoot } from "react-dom/client";
import { AgentBrowserApp } from "./app";
import type {
  AuthorizeDeclaredMcpTool,
  CallDeclaredMcpTool,
  DeclaredMcpToolResult,
} from "./remote-browser-mcp";
import "./styles.css";

export const surfaceTarget = "desktop" as const;

export function hostDeclaredMcpToolCaller(): CallDeclaredMcpTool | undefined {
  try {
    const callDeclaredTool = sdk.mcpTools?.v1.callDeclaredTool;
    if (!callDeclaredTool) return undefined;
    return async (options): Promise<DeclaredMcpToolResult> =>
      await callDeclaredTool(options);
  } catch {
    return undefined;
  }
}

export function hostDeclaredMcpToolAuthorizer():
  | AuthorizeDeclaredMcpTool
  | undefined {
  try {
    const authorizeDeclaredTool = sdk.mcpTools?.v1.authorizeDeclaredTool;
    if (!authorizeDeclaredTool) return undefined;
    return async (options) => await authorizeDeclaredTool(options);
  } catch {
    return undefined;
  }
}

export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const stopAppearanceSync = installMiniAppAppearanceSync();
  const root = createRoot(container);
  root.render(
    <AgentBrowserApp
      hostContext={context}
      callDeclaredTool={hostDeclaredMcpToolCaller()}
      authorizeDeclaredTool={hostDeclaredMcpToolAuthorizer()}
    />,
  );
  void context.events.publish("agent-browser.surface.mounted", {
    contributionId: context.contributionId,
    instanceId: context.instanceId,
  });

  let mounted = true;
  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      stopAppearanceSync();
      root.unmount();
      void context.events.publish("agent-browser.surface.unmounted", {
        contributionId: context.contributionId,
        instanceId: context.instanceId,
      });
    },
  };
}

export default Object.freeze({ mount, surfaceTarget });
