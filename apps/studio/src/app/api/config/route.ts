// Workspace settings endpoint for the Studio settings page (issue #52).
//
// The studio is local-first and account-free. This route is the single server
// read/write path for the SHARED workspace config `<workspaceRoot>/.toony/
// config.json` — the same file the CLI and agents resolve generation settings
// from (`@toony/project-io`'s readConfig/writeConfig). The settings page edits
// the ComfyUI endpoint/checkpoint/workflow here; env vars still override the file
// at generation time, so this is "lower-priority but durable" configuration.
//
// Path safety: there is NO path input. The target is always the workspace root
// resolved server-side by `@/lib/workspace` (from TOONY_WORKSPACE_DIR / the
// back-compat single-project parent / the default). The untrusted body only
// supplies the three config string fields, which are validated and normalized to
// strings-or-null before being handed to project-io — they are never joined into
// a filesystem path. Nothing private is committed: `.toony/` is gitignored and
// holds no secrets (the ComfyUI endpoint is the operator's own local address).
//
// GET also reports connection status: it pings the configured endpoint's
// `/system_stats` (ComfyUI's documented health endpoint) server-side with a short
// timeout and reports reachable / not-reachable plus, when ComfyUI returns it,
// the loaded-checkpoint hint. The browser never talks to ComfyUI directly.

import { readConfig, type ToonyConfig, writeConfig } from "@toony/project-io";
import { workspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** How long to wait for ComfyUI's /system_stats before calling it unreachable. */
const PING_TIMEOUT_MS = 4_000;

interface SavePayload {
  comfyui: {
    endpoint: string;
    checkpoint: string;
    workflow: string;
  };
}

/** Connection probe outcome for the status badge. */
interface ConnectionStatus {
  state: "reachable" | "unreachable" | "unconfigured";
  /** Present only when reachable and the endpoint reported a system summary. */
  detail?: string;
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/** A non-empty trimmed string, or null. Mirrors project-io's normalization. */
function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSavePayload(value: unknown): value is SavePayload {
  if (typeof value !== "object" || value === null) return false;
  const comfy = (value as Record<string, unknown>).comfyui;
  if (typeof comfy !== "object" || comfy === null) return false;
  const c = comfy as Record<string, unknown>;
  // Each field must be a string (possibly empty → cleared); never another type.
  return (
    typeof c.endpoint === "string" &&
    typeof c.checkpoint === "string" &&
    typeof c.workflow === "string"
  );
}

/**
 * Probe the configured ComfyUI endpoint's `/system_stats`. Returns a coarse
 * reachable/unreachable verdict; any network/HTTP error is "unreachable" (the
 * page shows that without treating it as a server error). An unset endpoint is
 * "unconfigured" so the badge can prompt the operator to set one.
 */
async function probeConnection(endpoint: string | null): Promise<ConnectionStatus> {
  if (endpoint === null) return { state: "unconfigured" };
  let base: URL;
  try {
    base = new URL(endpoint);
  } catch {
    return { state: "unreachable" };
  }
  const url = new URL("/system_stats", base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { state: "unreachable" };
    // ComfyUI returns a JSON summary; surface a compact, safe detail if present.
    let detail: string | undefined;
    try {
      const stats = (await response.json()) as {
        system?: { comfyui_version?: unknown; os?: unknown };
      };
      const version = stats.system?.comfyui_version;
      if (typeof version === "string" && version.length > 0) {
        detail = `ComfyUI ${version}`;
      }
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

/** Read the workspace config and probe the configured endpoint. */
export async function GET(): Promise<Response> {
  let config: ToonyConfig;
  try {
    config = await readConfig(workspaceRoot());
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return Response.json({ ok: false, error: reason }, { status: 500 });
  }
  const connection = await probeConnection(config.comfyui.endpoint);
  return Response.json({ ok: true, config, connection });
}

/** Persist edited settings to the workspace `.toony/config.json`. */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("request body must be valid JSON");
  }
  if (!isSavePayload(payload)) {
    return badRequest(
      "request body must be { comfyui: { endpoint: string, checkpoint: string, workflow: string } }",
    );
  }

  const endpoint = cleanString(payload.comfyui.endpoint);
  // Validate the endpoint is a real URL when set; reject garbage before writing.
  if (endpoint !== null) {
    try {
      // eslint-disable-next-line no-new
      new URL(endpoint);
    } catch {
      return badRequest("the ComfyUI endpoint must be a valid URL (e.g. http://127.0.0.1:8188)");
    }
  }

  const config: ToonyConfig = {
    comfyui: {
      endpoint,
      checkpoint: cleanString(payload.comfyui.checkpoint),
      workflow: cleanString(payload.comfyui.workflow),
    },
  };

  try {
    await writeConfig(workspaceRoot(), config);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return Response.json({ ok: false, error: reason }, { status: 500 });
  }

  const connection = await probeConnection(config.comfyui.endpoint);
  return Response.json({ ok: true, config, connection });
}
