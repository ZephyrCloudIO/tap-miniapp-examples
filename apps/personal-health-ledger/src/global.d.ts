declare global { interface Window { __HEALTH_LEDGER_PREVIEW__?: { setRole(role: "owner" | "viewer"): void; reset(): void; }; } }
export {};
