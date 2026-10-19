import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("./", import.meta.url));
const server = await createServer({
  configFile: false,
  define: {
    "process.env": JSON.stringify({
      NEXT_PUBLIC_END_POINT: "http://127.0.0.1:43861",
    }),
  },
  root,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "next/navigation": fileURLToPath(
        new URL("./router.mjs", import.meta.url),
      ),
    },
  },
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: 43861,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
  },
});
await server.listen();
server.printUrls();
