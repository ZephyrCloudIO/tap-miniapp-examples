import { createRoot } from "react-dom/client";
import { ModelArenaApp } from "./app";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Preview root is missing.");

createRoot(rootElement).render(<ModelArenaApp preview />);
