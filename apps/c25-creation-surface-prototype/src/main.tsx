import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CreationSurfacePrototype } from "./prototype";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Prototype root element is missing.");

createRoot(root).render(
  <StrictMode>
    <CreationSurfacePrototype />
  </StrictMode>,
);
