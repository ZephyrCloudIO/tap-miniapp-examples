export const reactHookRuntimePattern =
  /\.useRef=function\([^)]*\)\{return [A-Za-z_$][\w$]*\.H\.useRef\(/gu;

export function countReactHookRuntimes(sources) {
  return sources.reduce(
    (count, source) =>
      count + [...source.matchAll(reactHookRuntimePattern)].length,
    0,
  );
}

export function assertSingleReactHookRuntime(sources) {
  const runtimeCount = countReactHookRuntimes(sources);
  if (runtimeCount !== 1) {
    throw new Error(
      `Vanta Companion must contain exactly one React hook runtime; found ${runtimeCount}. ` +
        "Duplicate runtimes leave SDK UI hooks attached to an inactive dispatcher.",
    );
  }
}
