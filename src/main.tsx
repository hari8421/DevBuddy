import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";

import App from "./App.tsx";
import "./index.css";

/**
 * LogLens runs entirely in the browser: no accounts, no backend. The only
 * global provider is the theme switcher.
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
