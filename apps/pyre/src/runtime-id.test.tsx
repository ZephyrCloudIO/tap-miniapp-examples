import { describe, expect, it } from "@rstest/core";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Investigation } from "./domain";
import {
  PyreRuntimeIdProvider,
  useAuditMutation,
  useRuntimeId,
} from "./runtime-id";

const auditSeed = {
  audit: [],
  revision: 1,
  updatedAt: "2026-07-24T12:00:00.000Z",
} as unknown as Investigation;

function Probe({ prefix }: { prefix: string }) {
  return <span>{useRuntimeId()(prefix)}</span>;
}

function AuditProbe() {
  const auditMutation = useAuditMutation();
  const next = auditMutation(
    auditSeed,
    "fixture-actor",
    "fixture.updated",
    "fixture",
    "fixture-id",
    "Fixture update",
  );
  return <span>{next.audit[0]?.id}</span>;
}

describe("Pyre runtime ID scope", () => {
  it("isolates direct and audited IDs to their surface React trees", () => {
    const markup = renderToStaticMarkup(
      <PyreRuntimeIdProvider randomUUID={() => "outer"}>
        <AuditProbe />
        <PyreRuntimeIdProvider randomUUID={() => "inner"}>
          <Probe prefix="evidence" />
        </PyreRuntimeIdProvider>
        <Probe prefix="question" />
      </PyreRuntimeIdProvider>,
    );

    expect(markup).toBe(
      "<span>audit_outer</span><span>evidence_inner</span><span>question_outer</span>",
    );
  });
});
