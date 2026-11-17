import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPaid, openPaymentPage } from "../../src/payment";

let local: Record<string, unknown>;
let sync: Record<string, unknown>;
let manifest: object;
const fetch = vi.fn();
const create = vi.fn();

beforeEach(() => {
	local = {};
	sync = {};
	manifest = {};
	fetch.mockReset();
	create.mockReset();
	const area = (store: () => Record<string, unknown>) => ({
		get: async (key: string) => ({ [key]: store()[key] }),
		set: async (items: object) => Object.assign(store(), items),
	});
	vi.stubGlobal("fetch", fetch);
	vi.stubGlobal("chrome", {
		runtime: { getManifest: () => manifest },
		storage: { local: area(() => local), sync: area(() => sync) },
		tabs: { create },
	});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isPaid", () => {
	it("購入ページを開いたことがなければ、通信せずに未購入と返す", async () => {
		expect(await isPaid()).toBe(false);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("一度購入を確認できたら、以後は通信しない", async () => {
		local["payment-paid"] = true;

		expect(await isPaid()).toBe(true);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("購入済みと返ってきたら覚えておく", async () => {
		sync["payment-api-key"] = "KEY";
		fetch.mockResolvedValue(Response.json({ paid: true }));

		expect(await isPaid()).toBe(true);
		expect(fetch.mock.calls[0][0]).toBe(
			"https://extensionpay.com/extension/captgrab/api/v2/user?api_key=KEY"
		);
		expect(local["payment-paid"]).toBe(true);
	});

	it("未購入なら覚えずに、次回も確認する", async () => {
		sync["payment-api-key"] = "KEY";
		fetch.mockResolvedValue(Response.json({ paid: false }));

		expect(await isPaid()).toBe(false);
		expect(local["payment-paid"]).toBeUndefined();
	});

	it.each([
		["通信できない", () => fetch.mockRejectedValue(new Error("offline"))],
		["サーバーのエラー", () => fetch.mockResolvedValue(new Response("", { status: 500 }))],
	])("%s ときは未購入として扱う", async (_, fail) => {
		sync["payment-api-key"] = "KEY";
		fail();

		expect(await isPaid()).toBe(false);
	});
});

describe("openPaymentPage", () => {
	it.each([
		["ストア版は本番の決済にする", { update_url: "https://clients2.google.com" }, {}],
		["ストア以外から読み込んだ版はテスト用の決済にする", {}, { development: true }],
	])("%s", async (_, installed, body) => {
		manifest = installed;
		fetch.mockResolvedValue(Response.json("KEY"));

		await openPaymentPage();

		expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
		expect(sync["payment-api-key"]).toBe("KEY");
	});

	it("鍵があれば発行し直さない", async () => {
		sync["payment-api-key"] = "KEY";

		await openPaymentPage();

		expect(fetch).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledWith({
			url: "https://extensionpay.com/extension/captgrab/choose-plan?api_key=KEY",
		});
	});
});
