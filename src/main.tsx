import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { TextProvider } from "./contexts/TextContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TextProvider>
      <App />
    </TextProvider>
  </React.StrictMode>,
);
