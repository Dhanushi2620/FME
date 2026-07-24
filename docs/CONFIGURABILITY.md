# FME Configurability — Config → Factory → Provider

## Overview

FME uses a three-layer pattern to make every AI component swappable without touching pipelines.

| Layer | Role |
|-------|------|
| **Config** | Selects **WHAT** to use |
| **Factory** | Builds **WHICH** class |
| **Provider** | Runs **HOW** with that config |

Pipelines, hooks, ChromaDB, and rules never change when you swap a provider.

```
metadata.config.ts          →  id: "qwen" | "openai" | …
        ↓
MetadataProviderFactory.ts  →  new Ollama… / new OpenAI…
        ↓
*MetadataExtractionProvider →  HTTP call / LLM inference
        ↓
MetadataExtractionService / pipelines  (unchanged)
```

---

## The Three Layers

### Layer 1 — Config (`src/config/metadata.config.ts`)

This is the **primary** file you change to switch providers.

```typescript
export const METADATA_CONFIG: MetadataExtractionConfig = {
  provider: {
    id: "qwen", // ← change this only (after the id is registered)
    options: DEFAULT_QWEN_METADATA_OPTIONS,
  },
  thresholds: {
    minConfidence: 0.7,
  },
};
```

**Typed provider ids today** (`MetadataExtractionProviderId`):

| Id | Meaning |
|----|---------|
| `"qwen"` | Ollama qwen2.5:3b via metadata sidecar `:8002` (**current default**) |
| `"cursor-agent"` | Same Ollama provider class; agent-oriented options |
| `"gemma"` | Reserved in config types (wire in factory when implemented) |
| `"claude"` | Reserved in config types (wire in factory when implemented) |
| `"custom"` | Open-ended options bag for experiments |

**Related (not a TS factory id):** set `METADATA_PROVIDER=rule-based` on the **Python** metadata sidecar (`:8002`) for a zero-dependency fallback without Ollama.

To add `"openai"`, also extend the `MetadataExtractionProviderId` union and `MetadataExtractionProviderOptionsMap` in the same config file.

---

### Layer 2 — Factory (`src/composition/MetadataProviderFactory.ts`)

Maps provider id → concrete class. Add **one line** to support a new provider.

```typescript
const METADATA_PROVIDER_REGISTRY = {
  "cursor-agent": (config) => new OllamaMetadataExtractionProvider(config),
  qwen: (config) => new OllamaMetadataExtractionProvider(config),
  // openai: (config) => new OpenAIMetadataExtractionProvider(config),
};
```

Factory comment (source of truth):

> To add a new provider:  
> 1. Implement `MetadataExtractionProvider` under `providers/extraction/<name>/`.  
> 2. Add one entry here mapping the config id to `new Provider(config)`.  
> 3. No changes required in services, pipelines, hooks, or MCP.

Callers receive the **interface** only — never a concrete class from business logic.

---

### Layer 3 — Provider (`src/providers/extraction/ollama/OllamaMetadataExtractionProvider.ts`)

Reads everything from injected config — hardcodes nothing about which model id or URL is “the product default” outside config.

```typescript
constructor(
  config: MetadataExtractionConfig,
  private readonly extractionClient: OllamaMetadataExtractionClient = new HttpOllamaMetadataExtractionClient()
) {
  this.providerId = config.provider.id;
  // options / inference.serviceUrl / modelId come from config.provider.options
}
```

The provider implements:

```typescript
extractMetadata(input: MetadataExtractionInput): Promise<MetadataExtractionResult>;
```

Contract: `src/contracts/extraction/MetadataExtractionProvider.ts`.

**Default path today:** TypeScript provider → HTTP `POST http://127.0.0.1:8002/v1/metadata/extract` → Python sidecar → Ollama `:11434`.

---

## Example — Adding OpenAI (ChatGPT) as Provider

### Step 1 — Create new provider file

Create: `src/providers/extraction/openai/OpenAIMetadataExtractionProvider.ts`

```typescript
import {
  MetadataExtractionInput,
  MetadataExtractionProvider,
  MetadataExtractionResult,
} from "../../../contracts/extraction";
import { MetadataExtractionConfig } from "../../../config/metadata.config";

export class OpenAIMetadataExtractionProvider
  implements MetadataExtractionProvider
{
  readonly providerId: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly config: MetadataExtractionConfig) {
    this.providerId = config.provider.id;
    this.apiKey = process.env.OPENAI_API_KEY || "";
    const options = config.provider.options as { inference?: { modelId?: string } };
    this.model = options.inference?.modelId || "gpt-4o-mini";
  }

  async extractMetadata(
    input: MetadataExtractionInput
  ): Promise<MetadataExtractionResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(input) },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    const data = await response.json();
    const content = data.choices[0].message.content;
    const parsed = JSON.parse(content);

    return {
      metadata: parsed,
      // map fields to ExtractedMetadata shape expected by the service
    };
  }
}
```

Also export from `src/providers/extraction/openai/index.ts` if you follow the existing package layout.

### Step 2 — Extend config types + add one line to factory

In `metadata.config.ts`, add `"openai"` to the id union and options map.

In `MetadataProviderFactory.ts`:

```typescript
import { OpenAIMetadataExtractionProvider } from "../providers/extraction/openai";

// inside METADATA_PROVIDER_REGISTRY:
openai: (config) => new OpenAIMetadataExtractionProvider(config),
```

### Step 3 — Change one line in config

```typescript
// Before
id: "qwen";

// After
id: "openai";
```

### Step 4 — Add API key to environment

```bash
export OPENAI_API_KEY=sk-your-key-here
```

Prefer loading via `dotenv` / `.env` (gitignored) — never commit the key.

### That is it. Nothing else changes.

| Area | Unchanged? |
|------|------------|
| READ pipeline | ✅ |
| WRITE pipeline | ✅ |
| CronService | ✅ |
| ChromaDB storage | ✅ |
| RuleEvaluator | ✅ |
| Hooks | ✅ |
| Buffer | ✅ |

---

## Cost Comparison

| Provider | Cost | Privacy | Quality | Speed |
|----------|------|---------|---------|-------|
| Ollama qwen2.5:3b (current) | $0 | 100% local | Good | ~8–15s |
| OpenAI gpt-4o-mini | ~$0.025/day* | Cloud ❌ | Better | ~2s |
| OpenAI gpt-4o | ~$0.25/day* | Cloud ❌ | Best | ~3s |
| Anthropic Claude Haiku | ~$0.02/day* | Cloud ❌ | Better | ~1s |
| rule-based fallback (sidecar) | $0 | 100% local | Basic | ~10ms |

\*Illustrative order-of-magnitude for light local batch usage — measure against your volume.

---

## Changing Other Settings Without Swapping Provider

### Change confidence threshold

In `src/config/metadata.config.ts`:

```typescript
thresholds: {
  minConfidence: 0.8, // was 0.7 — stricter filtering
}
```

### Change Ollama model (same provider)

```typescript
options: {
  inference: {
    modelId: "llama3.2:3b", // swap model, same provider class
    serviceUrl: "http://127.0.0.1:8002",
    timeoutMs: 25_000,
  },
  temperature: 0.1,
}
```

Ensure the model is available in Ollama (`ollama pull …`).

### Change batch interval

In `src/services/batch/CronService.ts`:

```typescript
const BATCH_INTERVAL_MS = 10 * 60 * 1000; // 10 min instead of 15
```

### Change dedup threshold

Default lives in `src/config/vector-store.config.ts`:

```typescript
export const DEFAULT_DEDUPLICATION_SIMILARITY_THRESHOLD = 0.95; // stricter than 0.92
```

Batch path also references `DEDUPLICATION_SIMILARITY_THRESHOLD` in `src/services/batch/BatchWriteService.ts` — keep them aligned if you change one.

---

## Same Pattern Elsewhere

| Concern | Config | Factory |
|---------|--------|---------|
| Metadata extraction | `metadata.config.ts` | `MetadataProviderFactory.ts` |
| Intent classification | `intent.config.ts` | `IntentProviderFactory.ts` |
| Embeddings | `embedding.config.ts` | `EmbeddingProviderFactory.ts` |
| Vector store | `vector-store.config.ts` | `VectorStoreProviderFactory.ts` |

---

## Summary

Three touches to add a new LLM provider:

1. **One new file** — implement `MetadataExtractionProvider`
2. **One line** — add to factory registry (+ type id in config)
3. **One line** — change `id` in `METADATA_CONFIG`

Zero pipeline changes.  
Zero hook changes.  
Zero ChromaDB changes.

---

*Related: [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md) §9 Configurability*
