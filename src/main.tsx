import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { Showcase } from "./ui/Showcase";
import "./styles.css";
import "./ui/tokens.css";
import "./ui/primitives.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.replace(/\/$/, "") === "/ui" ? <Showcase /> : <App />}
  </React.StrictMode>,
);
