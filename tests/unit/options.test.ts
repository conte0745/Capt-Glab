// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

function setup(initial?: number) {
	const store: Record<string, number | undefined> = {
		"image-name-count": initial,
	};
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: (key: string, callback: (data: object) => void) =>
					callback({ [key]: store[key] }),
				remove: (key: string, callback: () => void) => {
					delete store[key];
					callback();
				},
			},
		},
	});
	document.body.innerHTML = `<span id="storageValues"></span><button id="reset-count"></button>`;
	return store;
}

const shown = () => document.getElementById("storageValues")!.textContent;

describe("options", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	async function load() {
		await import("../../src/options/index");
		document.dispatchEvent(new Event("DOMContentLoaded"));
	}

	it("保存されているカウントを表示する", async () => {
		setup(12);
		await load();
		expect(shown()).toBe("12");
	});

	it("カウントがなければ1を表示する", async () => {
		setup();
		await load();
		expect(shown()).toBe("1");
	});

	it("リセットするとカウントを削除して1を表示する", async () => {
		const store = setup(12);
		await load();

		document.getElementById("reset-count")!.click();

		expect(store["image-name-count"]).toBeUndefined();
		expect(shown()).toBe("1");
	});
});
