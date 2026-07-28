type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface NodeInvocation {
  inputs: Readonly<Record<string, JsonValue>>;
  config: Readonly<Record<string, JsonValue>>;
}

const WORKFLOW_ID = "examples-unofficial-suno-player.manual-brief";
const WORKFLOW_MANIFEST = [
  `id: ${WORKFLOW_ID}`,
  "name: Prepare a manual song brief",
  "description: Confirm that the governed, human-mediated brief path is ready without contacting an external provider.",
  "execution: dag",
  "states:",
  "  checkpoint:",
  "    node: examples-unofficial-suno-player.manual-brief-checkpoint",
  "    inputs: []",
  "    outcomes: [ready, error]",
  "  ready:",
  "    terminal: true",
  "    depends_on: [checkpoint]",
  "",
].join("\n");

export const node = ({ inputs, config }: NodeInvocation) => Object.freeze(
  Object.keys(inputs).length === 0 && Object.keys(config).length === 0
    ? { outcome: "ready" }
    : { outcome: "error" },
);

const files = Object.freeze([Object.freeze({
  path: `${WORKFLOW_ID}/${WORKFLOW_ID}.yaml`,
  content: WORKFLOW_MANIFEST,
  integrity: "sha256-5Id6gaM9hZJKUIc5fUQvMpDU1PAcNWwYDrAgffkm+Lc=",
})]);

export const workflow = Object.freeze({
  apiVersion: 1,
  workflowId: WORKFLOW_ID,
  files,
  integrity: "sha256-Yhp8R5Lqb4ZcPS6KQ0yBgxgtXROIA40BIz24QuqtoP4=",
});

export default Object.freeze({ workflow, node });
