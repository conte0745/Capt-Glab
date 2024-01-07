import { crx, defineManifest } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";

const manifest = defineManifest({
	manifest_version: 3,
	description: "You can get screen shot",
	name: "Capt Grab",
	version: "0.1.0",
	icons: {
		256: "src/icons/logo.png",
	},
	action: {
		default_icon: "src/icons/logo.png",
		default_title: "Capt Grab",
	},
	background: {
		service_worker: "src/background/index.ts",
	},
	content_scripts: [
		{
			matches: ["<all_urls>"],
			js: ["src/content_scripts.ts"],
		},
	],
	options_ui: {
		page: "src/options/index.html",
		open_in_tab: false,
	},
	permissions: ["activeTab", "storage"],
});

export default defineConfig({
	build: {
		rollupOptions: {
			input: {
				popup: "./src/popup/index.html",
			},
		},
	},
	plugins: [crx({ manifest })],
});
