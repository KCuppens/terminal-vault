import { createRoot } from "react-dom/client";

import { App } from "./App";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/dejavu-mono/latin-400.css";
import "@fontsource/dejavu-mono/latin-700.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<App />);
