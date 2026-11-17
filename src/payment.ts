// ExtensionPay (https://extensionpay.com) で買い切りの購入を管理する。
// 公式ライブラリは AGPL なので同梱せず、必要な通信だけを自分で行う
const EXTENSION_ID = "captgrab";
const BASE_URL = `https://extensionpay.com/extension/${EXTENSION_ID}`;

// 購入先のアカウントと結び付く鍵なので、同じ Google アカウントの Chrome で共有する
const API_KEY = "payment-api-key";
// 買い切りなので、一度購入を確認できたら以後は通信しない
const PAID_KEY = "payment-paid";

/** 購入済みかを返す。購入ページを開いたことがなければ通信しない */
export async function isPaid(): Promise<boolean> {
	const { [PAID_KEY]: paid } = await chrome.storage.local.get(PAID_KEY);
	if (paid === true) {
		return true;
	}
	const apiKey = await storedApiKey();
	if (!apiKey) {
		return false;
	}
	try {
		const response = await fetch(
			`${BASE_URL}/api/v2/user?api_key=${encodeURIComponent(apiKey)}`,
			{ headers: { Accept: "application/json" } }
		);
		if (!response.ok) {
			throw new Error(`購入状況を確認できませんでした: ${response.status}`);
		}
		const user = (await response.json()) as { paid?: boolean };
		if (user.paid === true) {
			await chrome.storage.local.set({ [PAID_KEY]: true });
			return true;
		}
		return false;
	} catch (error) {
		// 通信できないときは、未購入として撮影を続ける
		console.error(error);
		return false;
	}
}

/** 購入ページを新しいタブで開く */
export async function openPaymentPage(): Promise<void> {
	const apiKey = await apiKeyForPage();
	await chrome.tabs.create({
		url: `${BASE_URL}/choose-plan?api_key=${encodeURIComponent(apiKey)}`,
	});
}

/** 別の Chrome で購入した人が、メールアドレスで購入を引き継ぐページを開く */
export async function openLoginPage(): Promise<void> {
	const apiKey = await apiKeyForPage();
	await chrome.tabs.create({
		url: `${BASE_URL}/reactivate?api_key=${encodeURIComponent(apiKey)}&back=choose-plan&v2`,
	});
}

/** 保存済みの鍵を返す。まだなければ null */
async function storedApiKey(): Promise<string | null> {
	const { [API_KEY]: apiKey } = await chrome.storage.sync.get(API_KEY);
	return typeof apiKey === "string" ? apiKey : null;
}

/** 購入ページに渡す鍵を返す。初めてなら発行してもらって保存する */
async function apiKeyForPage(): Promise<string> {
	const stored = await storedApiKey();
	if (stored) {
		return stored;
	}
	// ストア以外から読み込んだ拡張は、ExtensionPay のテスト用の決済になる
	const development = !("update_url" in chrome.runtime.getManifest());
	const response = await fetch(`${BASE_URL}/api/new-key`, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify(development ? { development: true } : {}),
	});
	if (!response.ok) {
		throw new Error(`購入ページを開けませんでした: ${response.status}`);
	}
	const apiKey = (await response.json()) as string;
	await chrome.storage.sync.set({ [API_KEY]: apiKey });
	return apiKey;
}
