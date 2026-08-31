export const CAMPAIGN_TOKEN_KEY = "yellowdogs-chronicles-token";

export function createCampaignApiClient({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  tokenKey = CAMPAIGN_TOKEN_KEY,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Campaign API requires fetch");

  let token = String(storage?.getItem?.(tokenKey) ?? "");

  const request = async (url, options = {}) => {
    const response = await fetchImpl(url, {
      method: options.method || "GET",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "请求失败");
    return value;
  };

  return {
    request,
    hasToken: () => Boolean(token),
    setToken(value) {
      token = String(value ?? "");
      if (token) storage?.setItem?.(tokenKey, token);
      else storage?.removeItem?.(tokenKey);
    },
    clearToken() {
      token = "";
      storage?.removeItem?.(tokenKey);
    },
  };
}
