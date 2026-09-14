import { createRoot } from "react-dom/client";
import { TapCalendarApp } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("TAP Calendar preview root is missing.");
createRoot(root).render(<TapCalendarApp preview />);
