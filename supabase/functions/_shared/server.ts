// Edge-only helpers; credentials and raw provider errors never reach browsers.
export class HttpError extends Error {
  constructor(_status: number, message: string) { super(message); }
}
export const env = (name: string) => Deno.env.get(name)?.trim() || "";
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
export async function rpc(name: string, body: Record<string, unknown>, timeout = 8000): Promise<any> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const url = env("SUPABASE_URL");
  if (!key || !url) throw new Error("Missing backend credentials.");
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error("Email service request failed.");
  return response.json();
}
export const service = (action: string, payload: Record<string, unknown> = {}) => rpc("shop_service", { p_action: action, p_payload: payload });
