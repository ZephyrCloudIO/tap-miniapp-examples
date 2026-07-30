import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from "@theaiplatform/miniapp-sdk/surface";
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { RoadieApp } from "./App";
import "./styles.css";

export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
      mutations: {
        retry: false,
      },
    },
  });
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={queryClient}>
      <RoadieApp context={context} platform={sdk} />
    </QueryClientProvider>,
  );

  return {
    unmount() {
      root.unmount();
      queryClient.clear();
    },
  };
}
