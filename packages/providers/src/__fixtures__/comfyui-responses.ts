// Named fixtures: ComfyUI HTTP API response bodies used by the protocol tests to
// prove /prompt parsing, /history image-descriptor extraction, and /view URL
// construction WITHOUT a live server.
//
// The POST /prompt rejection bodies below are RECORDED, not written by hand.
// Each is the verbatim HTTP 400 body a local ComfyUI 0.25.0 server returned on
// 2026-09-20, provoked by POSTing a graph that fails validation: a checkpoint
// name the machine does not have, an out-of-range value, an unknown sampler, a
// removed required input, an uninstalled node type. ComfyUI never queues or
// executes a graph it rejects, so recording these ran no work on the server.
//
// Seven bodies were recorded and five are kept here. The two left out (an empty
// graph, and a POST with no `prompt` key) both came back with `node_errors: {}`,
// the shape promptRejectedWithoutNodeErrorsResponse already covers. The V3
// combo recording uses an invalid AlignYourStepsScheduler model_type, linked
// through SamplerCustom and VAEDecode to SaveImage. Missing required sampler
// and VAE inputs also guarantee rejection. The queue remained empty.
//
// The recorded legacy option lists have a single entry, because the recording
// machine has one checkpoint installed. A one-entry list cannot distinguish
// "list them all" from "list the first", so the legacy multi-value case uses a
// synthetic body in the protocol test. The V3 recording has three real options.
//
// ONE redaction was applied: the recording machine's real installed checkpoint
// filename was replaced with "base-model-v1.safetensors" wherever it appeared,
// because it identifies that machine's model library while the tests only need
// some valid-values list to be present. Nothing else was altered. No endpoint,
// filesystem path, or credential appears in these bodies.
//
// The /history and /view fixtures further down are illustrative shapes.

/** POST /prompt success: returns a queued prompt id. */
export function promptAcceptedResponse(): unknown {
  return {
    prompt_id: "f1e2d3c4-0000-4000-8000-aaaabbbbcccc",
    number: 1,
    node_errors: {},
  };
}

/**
 * POST /prompt rejection: the graph names a checkpoint the server does not have.
 * The single most likely first-run failure of a pack that ships its own graph,
 * and the case that shows valid values reaching the user.
 */
export function promptRejectedResponse(): unknown {
  return {
    error: {
      type: "prompt_outputs_failed_validation",
      message: "Prompt outputs failed validation",
      details: "",
      extra_info: {},
    },
    node_errors: {
      "4": {
        errors: [
          {
            type: "value_not_in_list",
            message: "Value not in list",
            details: "ckpt_name: 'model.safetensors' not in ['base-model-v1.safetensors']",
            extra_info: {
              input_name: "ckpt_name",
              input_config: [
                ["base-model-v1.safetensors"],
                {
                  tooltip: "The name of the checkpoint (model) to load.",
                },
              ],
              received_value: "model.safetensors",
            },
          },
        ],
        dependent_outputs: ["9"],
        class_type: "CheckpointLoaderSimple",
      },
    },
  };
}

/**
 * POST /prompt rejection recorded from a V3 combo input. The scheduler offers
 * three built-in model types. Other missing inputs keep the graph invalid even
 * if its model_type is corrected; no inference or image write was possible.
 */
export function promptRejectedV3ComboResponse(): unknown {
  return {
    error: {
      type: "prompt_outputs_failed_validation",
      message: "Prompt outputs failed validation",
      details: "",
      extra_info: {},
    },
    node_errors: {
      "12": {
        errors: [
          {
            type: "value_not_in_list",
            message: "Value not in list",
            details: "model_type: 'SDXL_TURBO' not in ['SD1', 'SDXL', 'SVD']",
            extra_info: {
              input_name: "model_type",
              input_config: [
                "COMBO",
                {
                  multiselect: false,
                  options: ["SD1", "SDXL", "SVD"],
                },
              ],
              received_value: "SDXL_TURBO",
            },
          },
        ],
        dependent_outputs: ["15"],
        class_type: "AlignYourStepsScheduler",
      },
      "13": {
        errors: [
          {
            type: "required_input_missing",
            message: "Required input is missing",
            details: "sampler",
            extra_info: {
              input_name: "sampler",
            },
          },
          {
            type: "required_input_missing",
            message: "Required input is missing",
            details: "negative",
            extra_info: {
              input_name: "negative",
            },
          },
          {
            type: "required_input_missing",
            message: "Required input is missing",
            details: "latent_image",
            extra_info: {
              input_name: "latent_image",
            },
          },
          {
            type: "required_input_missing",
            message: "Required input is missing",
            details: "positive",
            extra_info: {
              input_name: "positive",
            },
          },
          {
            type: "required_input_missing",
            message: "Required input is missing",
            details: "model",
            extra_info: {
              input_name: "model",
            },
          },
        ],
        dependent_outputs: ["15"],
        class_type: "SamplerCustom",
      },
      "14": {
        errors: [
          {
            type: "required_input_missing",
            message: "Required input is missing",
            details: "vae",
            extra_info: {
              input_name: "vae",
            },
          },
        ],
        dependent_outputs: ["15"],
        class_type: "VAEDecode",
      },
    },
  };
}

/**
 * POST /prompt rejection with several nodes at fault, one of them carrying two
 * failing fields. `sampler_name` is the elided-list case: ComfyUI drops
 * input_config for option lists longer than 20 entries, so that line has an
 * offending value but no valid values to show.
 */
export function promptRejectedMultipleNodesResponse(): unknown {
  return {
    error: {
      type: "prompt_outputs_failed_validation",
      message: "Prompt outputs failed validation",
      details: "",
      extra_info: {},
    },
    node_errors: {
      "4": {
        errors: [
          {
            type: "value_not_in_list",
            message: "Value not in list",
            details: "ckpt_name: 'model.safetensors' not in ['base-model-v1.safetensors']",
            extra_info: {
              input_name: "ckpt_name",
              input_config: [
                ["base-model-v1.safetensors"],
                {
                  tooltip: "The name of the checkpoint (model) to load.",
                },
              ],
              received_value: "model.safetensors",
            },
          },
        ],
        dependent_outputs: ["9"],
        class_type: "CheckpointLoaderSimple",
      },
      "3": {
        errors: [
          {
            type: "value_bigger_than_max",
            message: "Value 100000 bigger than max of 10000",
            details: "steps",
            extra_info: {
              input_name: "steps",
              input_config: [
                "INT",
                {
                  default: 20,
                  min: 1,
                  max: 10000,
                  tooltip: "The number of steps used in the denoising process.",
                },
              ],
              received_value: 100000,
            },
          },
          {
            type: "value_not_in_list",
            message: "Value not in list",
            details: "sampler_name: 'not_a_real_sampler' not in (list of length 44)",
            extra_info: {
              input_name: "sampler_name",
              input_config: null,
              received_value: "not_a_real_sampler",
            },
          },
        ],
        dependent_outputs: ["9"],
        class_type: "KSampler",
      },
    },
  };
}

/**
 * POST /prompt rejection for a missing required input: extra_info carries only
 * input_name, with no received_value to report.
 */
export function promptRejectedMissingInputResponse(): unknown {
  return {
    error: {
      type: "prompt_outputs_failed_validation",
      message: "Prompt outputs failed validation",
      details: "",
      extra_info: {},
    },
    node_errors: {
      "4": {
        errors: [
          {
            type: "value_not_in_list",
            message: "Value not in list",
            details: "ckpt_name: 'model.safetensors' not in ['base-model-v1.safetensors']",
            extra_info: {
              input_name: "ckpt_name",
              input_config: [
                ["base-model-v1.safetensors"],
                {
                  tooltip: "The name of the checkpoint (model) to load.",
                },
              ],
              received_value: "model.safetensors",
            },
          },
        ],
        dependent_outputs: ["9"],
        class_type: "CheckpointLoaderSimple",
      },
      "6": {
        errors: [
          {
            type: "required_input_missing",
            message: "Required input is missing",
            details: "text",
            extra_info: {
              input_name: "text",
            },
          },
        ],
        dependent_outputs: ["9"],
        class_type: "CLIPTextEncode",
      },
    },
  };
}

/**
 * POST /prompt rejection with an EMPTY node_errors: ComfyUI refuses the graph as
 * a whole for an uninstalled node type and puts the detail in error.message.
 * The message for this shape must stay exactly as it was.
 */
export function promptRejectedWithoutNodeErrorsResponse(): unknown {
  return {
    error: {
      type: "missing_node_type",
      message: "Node 'ToonyNotARealNodeType' not found. The custom node may not be installed.",
      details: "Node ID '#10'",
      extra_info: {
        node_id: "10",
        class_type: "ToonyNotARealNodeType",
        node_title: "ToonyNotARealNodeType",
      },
    },
    node_errors: {},
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
