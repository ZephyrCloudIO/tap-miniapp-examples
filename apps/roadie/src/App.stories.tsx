import type { MiniAppPlatformApi } from "@theaiplatform/miniapp-sdk";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RoadieApp } from "./App";

export function EmptyRoadieStory(props: {
  context: TapFederatedSurfaceMountContext;
  platform: MiniAppPlatformApi;
}) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <RoadieApp context={props.context} platform={props.platform} />
    </QueryClientProvider>
  );
}
