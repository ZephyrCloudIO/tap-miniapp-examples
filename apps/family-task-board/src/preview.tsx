import { createRoot } from "react-dom/client";
import { FamilyTaskBoardApp } from "./app";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Preview root is missing.");

createRoot(rootElement).render(<FamilyTaskBoardApp preview />);
