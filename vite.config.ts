import { crx, defineManifest } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import pkg from "./package.json";

const manifest = defineManifest({
	manifest_version: 3,
	description:
		"画面サイズを固定して、Webページ全体を1枚のPNGに。保存とクリップボードへのコピーまで1クリックで行います。",
	name: "CaptGrab",
	version: pkg.version,
	icons: {
		16: "src/icons/icon-16.png",
		32: "src/icons/icon-32.png",
		48: "src/icons/icon-48.png",
		128: "src/icons/icon-128.png",
	},
	action: {
		default_icon: {
			16: "src/icons/icon-16.png",
			32: "src/icons/icon-32.png",
			48: "src/icons/icon-48.png",
			128: "src/icons/icon-128.png",
		},
		default_title: "CaptGrab",
		default_popup: "src/popup/index.html",
	},
	background: {
		service_worker: "src/background/index.ts",
	},
	options_ui: {
		page: "src/options/index.html",
		open_in_tab: true,
	},
	commands: {
		_execute_action: {
			suggested_key: { default: "Alt+Shift+S" },
			description: "ページ全体を撮影する",
		},
	},
	permissions: ["debugger", "storage", "clipboardWrite", "downloads"],
});

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
