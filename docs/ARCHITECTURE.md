# Toony Architecture

Status: Founding draft

## Core Thesis

Toony is cut-first, transition-first, and lettering-first. The canonical object
is the episode reading sequence, not markdown.

```yaml
sequence:
  - type: cut
    id: cut-001
  - type: transition
    id: tr-001
  - type: cut
    id: cut-002
```

Markdown can be generated as a support artifact for export targets, but it is
not the source of truth for webtoon production.

## Local-First Model

Projects are ordinary folders that agents and humans can inspect, edit, validate,
and export without a server account.

## Language

The default project language is English, but language is project-level
configurable.

```json
{
  "defaultLanguage": "en",
  "supportedLanguages": ["en", "ko", "ja"],
  "dialogueLanguage": "en",
  "promptLanguage": "en"
}
```

## Provider-Neutral Image Workflow

Toony core must not make one provider's policy or capability limits the product
boundary. It must support constrained cloud models, Grok/xAI-style providers,
local or remote ComfyUI, custom providers, manual import, and agent-produced
image files.

Toony is not an image-generation model. It coordinates project structure,
prompts, assets, validation, lettering, and export.

## Export Targets

Platform export:

- ordered JPG or PNG files
- configurable width
- compression options

Stitched export:

- one long JPG or PNG
- preserves cuts, gutters, transitions, and lettering

PlotLink-ready export:

- WebP images
- max 20 images per episode
- max 1MB per image
- reading order preserved
- generated markdown between 500 and 10,000 characters
- manifest included

Toony prepares PlotLink-ready content only. It does not upload or publish.
