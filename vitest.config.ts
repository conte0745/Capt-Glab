import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/unit/**/*.test.ts"],
		restoreMocks: true,
		unstubGlobals: true,
		// vitest は型を見ずに実行するので、型の誤りがビルドまで見つからないことがある
		typecheck: {
			enabled: true,
			include: ["tests/unit/**/*.test.ts"],
			tsconfig: "./tsconfig.json",
		},
	},
});
