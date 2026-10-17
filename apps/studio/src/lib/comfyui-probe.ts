// Shared ComfyUI reachability probe (#154).
//
// Both the `/api/config` route and the settings page probe the operator's
// configured ComfyUI `/system_stats` for a coarse reachable/unreachable verdict.
// This is the SINGLE implementation both call — including the SSRF protocol guard
// (http/https only) the route had and the settings page previously LACKED, which
// the settings page now adopts as a strict security improvement (#154 item 8).

/** Coarse ComfyUI connection verdict for the status badge. */
export interface ConnectionStatus {
  state: "reachable" | "unreachable" | "unconfigured";
  detail?: string;
}

const PING_TIMEOUT_MS = 4_000;

/**
 * Probe the configured ComfyUI endpoint's `/system_stats`. Any network/HTTP error
 * is "unreachable"; an unset endpoint is "unconfigured". A non-http(s) endpoint is
 * "unreachable" without a fetch (the SSRF protocol guard).
 */
export async function probeComfyui(endpoint: string | null): Promise<ConnectionStatus> {
  if (endpoint === null) return { state: "unconfigured" };
  let base: URL;
  try {
    base = new URL(endpoint);
  } catch {
    return { state: "unreachable" };
  }
  // SSRF posture (#82): a server-side fetch of the OPERATOR's own local-first
  // ComfyUI endpoint (typically 127.0.0.1:8188), which they set and trust. As a
  // basic guard we only probe http/https (no file:, etc.) and keep the short
  // timeout below; we do NOT enumerate/block internal addresses, which would
  // break the common case of pointing at a LAN ComfyUI host.
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { state: "unreachable" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/system_stats", base), { signal: controller.signal });
    if (!response.ok) return { state: "unreachable" };
    // ComfyUI returns a JSON summary; surface a compact, safe detail if present.
    let detail: string | undefined;
    try {
      const stats = (await response.json()) as { system?: { comfyui_version?: unknown } };
      const version = stats.system?.comfyui_version;
      if (typeof version === "string" && version.length > 0) detail = `ComfyUI ${version}`;
    } catch {
      // A reachable endpoint that returns non-JSON is still reachable.
    }
    return { state: "reachable", detail };
  } catch {
    return { state: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
