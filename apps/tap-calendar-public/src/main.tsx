import { createRoot } from "react-dom/client";
import { PublicBookingApp } from "./app";
import "./styles.css";

const root = globalThis.document.getElementById("root");
if (!root) throw new Error("TAP Calendar public root is missing.");
createRoot(root).render(<PublicBookingApp />);
