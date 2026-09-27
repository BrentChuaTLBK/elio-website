export function resendMarketing(key: string) {
  let previous = 0;
  async function request(path: string, method = "GET", body?: unknown, allowMissing = false): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 600 - (Date.now() - previous))));
    previous = Date.now();
    const response = await fetch(`https://api.resend.com${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
    });
    if (allowMissing && response.status === 404) return null;
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(response.status === 401 || response.status === 403
      ? "Broadcast access unavailable. Configure RESEND_BROADCAST_API_KEY with full access."
      : `Resend marketing request failed (${response.status}). The campaign was not sent through the email API.`);
    return result;
  }
  async function list(path: string): Promise<any[]> {
    const rows: any[] = []; let after = "";
    for (let page = 0; page < 1000; page++) {
      const result = await request(`${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
      if (!Array.isArray(result.data)) throw new Error("Invalid marketing list response.");
      rows.push(...result.data);
      if (!result.has_more) return rows;
      const next = result.data.at(-1)?.id;
      if (!next || next === after) throw new Error("Marketing pagination did not advance.");
      after = next;
    }
    throw new Error("Marketing pagination exceeded the safety limit.");
  }
  return { request, list };
}

