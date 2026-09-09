import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@/lib/mdx",
        replacement: fileURLToPath(new URL("./src/lib/mdx.vinext.ts", import.meta.url)),
      },
      {
        find: "@/lib/search-index",
        replacement: fileURLToPath(
          new URL("./src/lib/search-index.vinext.ts", import.meta.url),
        ),
      },
    ],
  },
  plugins: [
    // vinext auto-injects @mdx-js/rollup with plugins from next.config
    vinext({
      cache: { cdn: cdnAdapter() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
