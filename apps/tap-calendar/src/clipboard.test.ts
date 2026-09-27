/** @rstest-environment jsdom */

import { describe, expect, it, rs } from "@rstest/core";
import { copyTextToClipboard } from "./clipboard";

const bookingUrl = "https://cal.with-tap.ai/zack/30-min";

const documentWithCopyResult = (result: boolean): {
  readonly document: Document;
  readonly execCommand: ReturnType<typeof rs.fn>;
} => {
  const targetDocument = document.implementation.createHTMLDocument("Clipboard test");
  const execCommand = rs.fn((command: string) => {
    expect(command).toBe("copy");
    expect(targetDocument.querySelector("textarea")?.value).toBe(bookingUrl);
    return result;
  });
  Object.defineProperty(targetDocument, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  return { document: targetDocument, execCommand };
};

describe("clipboard copy", () => {
  it("copies the exact text with the modern Clipboard API", async () => {
    const writeText = rs.fn(async () => undefined);
    const legacy = documentWithCopyResult(true);

    await expect(copyTextToClipboard(bookingUrl, {
      clipboard: { writeText },
      document: legacy.document,
    })).resolves.toBe("clipboard-api");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(bookingUrl);
    expect(legacy.execCommand).not.toHaveBeenCalled();
  });

  it("uses the legacy copy path when the modern Clipboard API is missing", async () => {
    const legacy = documentWithCopyResult(true);

    await expect(copyTextToClipboard(bookingUrl, {
      clipboard: null,
      document: legacy.document,
    })).resolves.toBe("legacy-copy");

    expect(legacy.execCommand).toHaveBeenCalledTimes(1);
    expect(legacy.document.querySelector("textarea")).toBeNull();
  });

  it("uses the legacy copy path when the modern Clipboard API rejects", async () => {
    const writeText = rs.fn(async () => {
      throw new Error("Clipboard access denied");
    });
    const legacy = documentWithCopyResult(true);

    await expect(copyTextToClipboard(bookingUrl, {
      clipboard: { writeText },
      document: legacy.document,
    })).resolves.toBe("legacy-copy");

    expect(writeText).toHaveBeenCalledWith(bookingUrl);
    expect(legacy.execCommand).toHaveBeenCalledTimes(1);
    expect(legacy.document.querySelector("textarea")).toBeNull();
  });

  it("reports failure when neither clipboard path can copy the text", async () => {
    const writeText = rs.fn(async () => {
      throw new Error("Clipboard unavailable");
    });
    const legacy = documentWithCopyResult(false);

    await expect(copyTextToClipboard(bookingUrl, {
      clipboard: { writeText },
      document: legacy.document,
    })).rejects.toThrow("Clipboard access is unavailable.");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(legacy.execCommand).toHaveBeenCalledTimes(1);
    expect(legacy.document.querySelector("textarea")).toBeNull();
  });
});
