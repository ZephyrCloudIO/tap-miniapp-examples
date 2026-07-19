import { createRoot } from "react-dom/client";
import { HealthLedgerApp } from "./app";
import "./styles.css";
const root = document.getElementById("root");
if (!root) throw new Error("Preview root is missing.");
createRoot(root).render(<HealthLedgerApp preview />);
