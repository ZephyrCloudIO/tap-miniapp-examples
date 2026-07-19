import { describe, expect, it } from "@rstest/core";
import {
  buildSpecialistSummaryPrompt,
  extractTimelineCandidates,
  parseSpecialistSummary,
  specialistResponseText,
} from "./conversation";

describe("conversation boundary", () => {
  it("narrows only readable timeline rows", () => {
    const runtimeId = crypto.randomUUID();
    const candidates = extractTimelineCandidates([
      { messageId: runtimeId, body: "A participant-authored runtime message", author: { displayName: "Runtime participant" }, sequence: 4 },
      null,
      { id: crypto.randomUUID(), unsupported: true },
    ]);
    expect(candidates).toEqual([{ id: runtimeId, text: "A participant-authored runtime message", author: "Runtime participant", sequence: 4, timestamp: null }]);
  });

  it("includes only explicitly supplied excerpts in the specialist request", () => {
    const selected = [{ id: crypto.randomUUID(), text: "Selected runtime excerpt", author: "Participant", sequence: 1, timestamp: null }];
    const prompt = buildSpecialistSummaryPrompt("Runtime channel", "Runtime period", selected);
    expect(prompt).toContain("Selected runtime excerpt");
    expect(prompt).toContain("Return one JSON object");
    expect(prompt).not.toContain("audio data");
  });

  it("parses a real specialist text part and safely falls back to an editable draft", () => {
    const response = specialistResponseText([{ type: "text", content: JSON.stringify({ safeSummary: "Safe runtime summary", themes: "Theme", emotionalArc: "Hopeful", privateDetailsRemoved: "Names", candidateConcepts: "Concept", exclusions: "Secrets" }) }]);
    expect(parseSpecialistSummary(response).safeSummary).toBe("Safe runtime summary");
    expect(parseSpecialistSummary("Plain runtime result").safeSummary).toBe("Plain runtime result");
  });
});
