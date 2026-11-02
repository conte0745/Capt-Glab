import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifestBase from "./manifest.json";
import pkg from "./package.json";

// version は package.json だけで管理する
const manifest = { ...manifestBase, version: pkg.version } as ManifestV3Export;

export default defineConfig({
	build: {
		rollupOptions: {
			input: {
				viewer: "src/viewer/index.html",
			},
		},
	},
	plugins: [crx({ manifest })],
});
