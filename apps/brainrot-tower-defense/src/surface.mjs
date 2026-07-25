import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import {
  mount as mountWasm,
  set_host_authority as setHostAuthority,
  set_interaction_authority as setInteractionAuthority
} from "./ui.mjs";

const PLAY_ACTION = "brainrot-td.play";

function waitForAuthority(authority) {
  if (!authority || typeof authority.getSnapshot !== "function" || typeof authority.subscribe !== "function") {
    throw new Error("TAP host authority is unavailable");
  }
  if (authority.getSnapshot()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = authority.subscribe(() => {
      if (authority.getSnapshot()) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function isAllowed(actionId) {
  const decision = await sdk.authorization.check({
    actionId,
    autonomy: "do"
  });
  return decision.allowed;
}

export async function mount(container, context) {
  await waitForAuthority(context?.hostAuthority);
  const playGranted = await isAllowed(PLAY_ACTION);
  const mounted = await mountWasm(container, context);
  let granted = Boolean(context.hostAuthority.getSnapshot());
  const applyAuthority = (hostGranted) => {
    setInteractionAuthority(hostGranted && playGranted);
    setHostAuthority(hostGranted);
  };
  applyAuthority(granted);
  const unsubscribeAuthority = context.hostAuthority.subscribe(() => {
    const next = context.hostAuthority.getSnapshot();
    if (next !== granted) {
      granted = next;
      applyAuthority(next);
    }
  });
  return {
    async unmount() {
      unsubscribeAuthority();
      await mounted.unmount();
    }
  };
}
