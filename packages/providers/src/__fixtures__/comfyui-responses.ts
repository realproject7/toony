// Named fixtures: representative ComfyUI HTTP API response bodies, captured in
// the shape ComfyUI's documented stable API returns. Used by the protocol tests
// to prove /prompt parsing, /history image-descriptor extraction, and /view URL
// construction WITHOUT a live server. These are illustrative shapes only — no
// real endpoint, filesystem path, or credential appears here.

/** POST /prompt success: returns a queued prompt id. */
export function promptAcceptedResponse(): unknown {
  return {
    prompt_id: "f1e2d3c4-0000-4000-8000-aaaabbbbcccc",
    number: 1,
    node_errors: {},
  };
}

/** POST /prompt rejection: ComfyUI refused the graph (e.g. bad node input). */
export function promptRejectedResponse(): unknown {
  return {
    error: {
      type: "prompt_outputs_failed_validation",
      message: "Prompt outputs failed validation",
    },
    node_errors: {
      "6": { errors: [{ message: "Required input is missing", details: "text" }] },
    },
  };
}

/** GET /history/{id} before the prompt has finished: empty (not yet in history). */
export function historyPendingResponse(): unknown {
  return {};
}

/**
 * GET /history/{id} after completion: a SaveImage node (id "9") exposes one
 * output image descriptor. The descriptor is { filename, subfolder, type }.
 */
export function historyCompleteResponse(promptId: string): unknown {
  return {
    [promptId]: {
      prompt: [],
      outputs: {
        "9": {
          images: [
            {
              filename: "toony_00001_.png",
              subfolder: "",
              type: "output",
            },
          ],
        },
      },
      status: {
        status_str: "success",
        completed: true,
        messages: [],
      },
    },
  };
}

/**
 * GET /history/{id} with an output image that lives in a subfolder — exercises
 * /view URL construction with a non-empty subfolder.
 */
export function historyCompleteInSubfolderResponse(promptId: string): unknown {
  return {
    [promptId]: {
      outputs: {
        "9": {
          images: [{ filename: "panel.webp", subfolder: "episode-1", type: "output" }],
        },
      },
      status: { status_str: "success", completed: true },
    },
  };
}

/** GET /history/{id} where only a temp preview exists: still pending. */
export function historyTempOnlyResponse(promptId: string): unknown {
  return {
    [promptId]: {
      outputs: {
        "10": {
          images: [{ filename: "preview.png", subfolder: "", type: "temp" }],
        },
      },
      status: { status_str: "success" },
    },
  };
}

/** GET /history/{id} for a prompt that errored during execution. */
export function historyErrorResponse(promptId: string): unknown {
  return {
    [promptId]: {
      outputs: {},
      status: {
        status_str: "error",
        completed: false,
        messages: [["execution_error", { exception_message: "CUDA out of memory" }]],
      },
    },
  };
}
