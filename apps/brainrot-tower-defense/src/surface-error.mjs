const MAX_VISIBLE_ERROR_CHARS = 512;

function boundedMessage(value) {
  if (typeof value !== "string") return null;
  const message = value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return message ? message.slice(0, MAX_VISIBLE_ERROR_CHARS) : null;
}

export function asSurfaceMountError(error) {
  if (error instanceof Error) return error;
  const directMessage = boundedMessage(error);
  if (directMessage) return new Error(directMessage);
  if (typeof error === "object" && error !== null) {
    const objectMessage = boundedMessage(Reflect.get(error, "message"));
    if (objectMessage) return new Error(objectMessage);
  }
  return new Error("Brainrot Tower Defense failed to mount.");
}
