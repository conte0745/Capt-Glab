import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/e2e",
	// 撮影の待機時間を実測するテストがあるため、並列にしない
	workers: 1,
	timeout: 60_000,
	reporter: "list",
});
