import {
  mount as mountWasm,
  set_host_authority as setHostAuthority
} from "./ui.mjs";

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

export async function mount(container, context) {
  await waitForAuthority(context?.hostAuthority);
  const mounted = await mountWasm(container, context);
  let granted = Boolean(context.hostAuthority.getSnapshot());
  setHostAuthority(granted);
  const unsubscribeAuthority = context.hostAuthority.subscribe(() => {
    const next = context.hostAuthority.getSnapshot();
    if (next !== granted) {
      granted = next;
      setHostAuthority(next);
    }
  });
  return {
    async unmount() {
      unsubscribeAuthority();
      await mounted.unmount();
    }
  };
}
