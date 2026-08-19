import { useEffect, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@theaiplatform/miniapp-sdk/ui";
import type { MiniAppJsonValue } from "@theaiplatform/miniapp-sdk/sdk";
import { getTrrApi } from "../host";

interface SurvivalCounts {
  horizonLabel: string;
  state: "ok" | "no-data";
  snapshotCount: number;
  deadCount: number;
}

interface AggregateResult {
  state: "ok" | "withheld" | "no-data";
  cells: MiniAppJsonValue[];
}

interface DeathCauses {
  state: "ok" | "no-data";
  totalDeaths: number;
  causes: { deathMode: string; deaths: number }[];
}

/** Flatten a TRR cell into displayable primitive fields. Cells are opaque
 *  host-versioned JSON; we show the cohort label plus any numbers. */
function cellFields(cell: MiniAppJsonValue): Record<string, string> {
  if (cell === null || typeof cell !== "object" || Array.isArray(cell)) {
    return { value: String(cell) };
  }
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(cell)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields[key] = String(value);
    }
  }
  return fields;
}

/** Workspace-level TRR analytics from the host (SDK 0.8.0 `sdk.trr`).
 *  Renders nothing outside the host; degrades to hints when the trr.read
 *  grant is withheld or no data exists yet. */
export function WorkspaceTrrPanel() {
  const [survival, setSurvival] = useState<SurvivalCounts | null>(null);
  const [ecrt, setEcrt] = useState<AggregateResult | null>(null);
  const [deathCauses, setDeathCauses] = useState<DeathCauses | null>(null);
  const [withheld, setWithheld] = useState(false);
  const [available] = useState(() => getTrrApi() !== undefined);

  useEffect(() => {
    const trr = getTrrApi();
    if (!trr) return;
    let cancelled = false;

    void (async () => {
      const [survivalResult, ecrtResult, deathResult] = await Promise.allSettled([
        trr.getSurvivalCounts({}),
        trr.getEcrt({ dimension: "model" }),
        trr.getDeathCauses({}),
      ]);
      if (cancelled) return;

      if (survivalResult.status === "fulfilled") setSurvival(survivalResult.value);
      if (ecrtResult.status === "fulfilled") {
        setEcrt(ecrtResult.value);
        if (ecrtResult.value.state === "withheld") setWithheld(true);
      }
      if (deathResult.status === "fulfilled") setDeathCauses(deathResult.value);

      // A rejected read usually means the trr.read grant is missing.
      if (survivalResult.status === "rejected" && ecrtResult.status === "rejected") {
        setWithheld(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace TRR Analytics</CardTitle>
      </CardHeader>
      <CardContent style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {withheld && (
          <Alert>
            <AlertTitle>TRR analytics withheld</AlertTitle>
            <AlertDescription>
              Grant the trr.read permission to see workspace retention analytics here.
            </AlertDescription>
          </Alert>
        )}

        {survival && survival.state === "ok" && (
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            <strong>{survival.snapshotCount}</strong> snapshots,{" "}
            <span className="metric-negative">{survival.deadCount} dead</span> at the{" "}
            {survival.horizonLabel} horizon
          </p>
        )}

        {ecrt && ecrt.state === "ok" && ecrt.cells.length > 0 && (
          <>
            <h4 style={{ margin: 0, fontSize: "0.8125rem" }}>Effective cost per retained unit, by model</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cohort</TableHead>
                  <TableHead>Values</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ecrt.cells.map((cell, index) => {
                  const fields = cellFields(cell);
                  const { cohortLabel, ...rest } = fields;
                  return (
                    <TableRow key={index}>
                      <TableCell>{cohortLabel ?? `cell ${index + 1}`}</TableCell>
                      <TableCell className="metric-neutral">
                        {Object.entries(rest)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(" · ") || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}

        {deathCauses && deathCauses.state === "ok" && deathCauses.causes.length > 0 && (
          <p style={{ margin: 0, fontSize: "0.8125rem" }} className="metric-neutral">
            Death modes (all-time, {deathCauses.totalDeaths} total):{" "}
            {deathCauses.causes.map((c) => `${c.deathMode} ×${c.deaths}`).join(" · ")}
          </p>
        )}

        {!withheld &&
          survival?.state === "no-data" &&
          ecrt?.state === "no-data" && (
            <p style={{ margin: 0, fontSize: "0.875rem" }} className="metric-neutral">
              No workspace TRR data yet — run comparisons to build retention history.
            </p>
          )}
      </CardContent>
    </Card>
  );
}
