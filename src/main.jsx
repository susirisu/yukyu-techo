import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// GitHub Pagesのようにサブフォルダ（例: /yukyu-techo/）で公開される環境でも
// 正しいパスで登録できるよう、Viteのbase設定を使ってsw.jsのURLを組み立てる
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch(() => {});
  });
}
