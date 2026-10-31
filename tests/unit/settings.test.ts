import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SETTINGS,
	isValidViewportSize,
	loadSettings,
	normalizeFolder,
} from "../../src/settings";

describe("normalizeFolder", () => {
	it.each([
		["", ""],
		["  ", ""],
		["CaptGrab", "CaptGrab"],
		["a/b", "a/b"],
		["/a//b/", "a/b"],
		["a\\b", "a/b"],
		[" a / b ", "a/b"],
		["スクリーンショット", "スクリーンショット"],
	])("%j は %j になる", (input, expected) => {
		expect(normalizeFolder(input)).toBe(expected);
	});

	it.each(["..", "a/../b", ".", "a:b", "a*", 'a"b', "a?", "a<b", "a|b", "a."])(
		"%j は使えない",
		(input) => {
			expect(normalizeFolder(input)).toBeNull();
		}
	);
});

describe("isValidViewportSize", () => {
	it.each([200, 1280, 7680])("%d は使える", (size) => {
		expect(isValidViewportSize(size)).toBe(true);
	});

	it.each([199, 7681, 0, -1, 100.5, NaN])("%d は使えない", (size) => {
		expect(isValidViewportSize(size)).toBe(false);
	});
});

describe("loadSettings", () => {
	function stubStorage(settings?: object) {
		vi.stubGlobal("chrome", {
			storage: { local: { get: vi.fn(async () => ({ settings })) } },
		});
	}

	it("未設定なら初期値を返す", async () => {
		stubStorage();
		await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
	});

	it("保存された値を優先し、足りない項目は初期値で補う", async () => {
		stubStorage({ clipboard: false, viewport: { mode: "custom" } });

		const settings = await loadSettings();

		expect(settings.clipboard).toBe(false);
		expect(settings.download).toBe(true);
		expect(settings.viewport).toEqual({
			mode: "custom",
			width: 1280,
			height: 800,
		});
	});
});
