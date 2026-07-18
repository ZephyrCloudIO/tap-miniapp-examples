import "@theaiplatform/miniapp-sdk/ui/styles.css";
import { installMiniAppAppearanceSync } from "@theaiplatform/miniapp-sdk/web";
import { createRoot } from "react-dom/client";
import { PlayerApp } from "./app";
import "./styles.css";
installMiniAppAppearanceSync();
const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<PlayerApp preview />);
