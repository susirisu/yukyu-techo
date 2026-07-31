import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages で https://ユーザー名.github.io/リポジトリ名/ の形で公開する場合、
// base をリポジトリ名に合わせて書き換えてください（例: "/yukyu-techo/"）。
// 独自ドメインや Cloudflare Pages など、ルート直下（https://example.com/）で公開する場合は "/" のままでOKです。
export default defineConfig({
  plugins: [react()],
  base: "/yukyu-techo/",
});
