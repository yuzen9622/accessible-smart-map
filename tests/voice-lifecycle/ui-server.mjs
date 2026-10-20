import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import { createServer } from "vite";

const port = 43862;
const server = await createServer({
  configFile: false,
  define: {
    "process.env": JSON.stringify({
      NEXT_PUBLIC_END_POINT: `http://127.0.0.1:${port}`,
    }),
  },
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "next/navigation": fileURLToPath(
        new URL("./router.mjs", import.meta.url),
      ),
    },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
  },
});
await server.listen();
server.printUrls();
