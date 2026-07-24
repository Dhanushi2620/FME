# FME Configurability — Config → Factory → Provider

## Overview

FME uses one **common** three-layer pattern for every swappable AI / infra component.

| Layer | Role |
|-------|------|
| **Config** | Selects **WHAT** to use (`provider.id` + options) |
| **Factory** | Builds **WHICH** class from that id |
| **Provider** | Runs **HOW** using only the injected config |

Pipelines, hooks, services, and MCP never import concrete provider classes.  
Swap a backend by changing config (+ registering a new provider if needed) — not by rewriting READ/WRITE/rules.

```
*.config.ts                 →  provider.id = "…"
        ↓
*ProviderFactory.ts         →  registry[id](config)
        ↓
*Provider (interface)       →  HTTP / local model / cloud API
        ↓
Services / pipelines        →  unchanged
```

This doc explains the **common pattern first**, then walks through **metadata extraction as a concrete example**. The same steps apply to intent, embeddings, and vector store.

---

## Where the Pattern Applies (common)

| Concern | Config | Factory | Contract | Default id today |
|---------|--------|---------|----------|------------------|
| **Metadata extraction** | `src/config/metadata.config.ts` | `MetadataProviderFactory.ts` | `MetadataExtractionProvider` | `"qwen"` |
| **Intent classification** | `src/config/intent.config.ts` | `IntentProviderFactory.ts` | `IntentDetectionProvider` | `"bart-mnli"` |
| **Embeddings** | `src/config/embedding.config.ts` | `EmbeddingProviderFactory.ts` | `EmbeddingProvider` | `"minilm-l6-v2"` |
| **Vector store** | `src/config/vector-store.config.ts` | `VectorStoreProviderFactory.ts` | `VectorStoreProvider` | `"chromadb"` |

Every factory follows the same recipe:

1. Implement the contract under `src/providers/<area>/<name>/`
2. Add one registry line in the factory
3. Set `provider.id` in the matching config
4. **No** changes to pipelines, hooks, ChromaDB call sites, or rule evaluation logic

---

## The Three Layers (common)

### Layer 1 — Config

Each concern has a config object shaped like:

```typescript
{
  provider: {
    id: "<provider-id>",      // ← switch implementation here
    options: { /* provider-specific */ },
  },
  // optional shared knobs (thresholds, etc.)
}
```

You change **`id`** (and matching `options`) to select a different backend.  
You do **not** change services that call `createXProvider()`.

### Layer 2 — Factory

Maps `id` → constructor. Business code only sees the interface:

```typescript
const REGISTRY = {
  "current-default": (config) => new CurrentProvider(config),
  // "new-backend": (config) => new NewProvider(config),
};

export const createXProvider = (config = X_CONFIG) => {
  const factory = REGISTRY[config.provider.id];
  if (!factory) throw new UnknownXProviderError(config.provider.id);
  return factory(config);
};
```

### Layer 3 — Provider

Implements the contract. Reads URLs, model ids, timeouts, API keys from **injected config / env** — not from hardcoded product defaults scattered in pipelines.

---

## Example: Metadata Extraction

> Metadata is one application of the pattern — not the only configurable piece.  
> Today the default metadata backend happens to be the local sidecar + Ollama (`id: "qwen"`). You can swap that for OpenAI, Claude, rule-based, etc. the same way you would swap intent or embeddings.

### Layer 1 — `metadata.config.ts`

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

**Typed metadata provider ids** (`MetadataExtractionProviderId`):

| Id | Meaning |
|----|---------|
| `"qwen"` | Local metadata sidecar `:8002` (default; often backed by Ollama) |
| `"cursor-agent"` | Same extraction provider class; agent-oriented options |
| `"gemma"` | Reserved in config types (wire in factory when implemented) |
| `"claude"` | Reserved in config types (wire in factory when implemented) |
| `"custom"` | Open-ended options bag for experiments |

**Sidecar-only fallback (not a TS factory id):** set `METADATA_PROVIDER=rule-based` on the Python service on `:8002` for zero-dependency extraction without a local LLM.

To add `"openai"`, extend the id union + options map in `metadata.config.ts`, then register it in the factory.

Default Qwen options (illustrative — still just **config**, not a pipeline hardcode):

```typescript
inference: {
  serviceUrl: "http://127.0.0.1:8002",
  timeoutMs: 25_000,
  modelId: "qwen2.5:3b",
}
```

### Layer 2 — `MetadataProviderFactory.ts`

```typescript
const METADATA_PROVIDER_REGISTRY = {
  "cursor-agent": (config) => new OllamaMetadataExtractionProvider(config),
  qwen: (config) => new OllamaMetadataExtractionProvider(config),
  // openai: (config) => new OpenAIMetadataExtractionProvider(config),
};
```

Factory guidance (same wording as intent / embedding / vector-store factories):

> 1. Implement the provider interface under `providers/extraction/<name>/`.  
> 2. Add one entry mapping the config id to `new Provider(config)`.  
> 3. No changes required in services, pipelines, hooks, or MCP.

### Layer 3 — Provider

Example default implementation: `OllamaMetadataExtractionProvider`  
Contract method: `extractMetadata(input) → MetadataExtractionResult`  
(`src/contracts/extraction/MetadataExtractionProvider.ts`)

```typescript
constructor(
  config: MetadataExtractionConfig,
  private readonly extractionClient = new HttpOllamaMetadataExtractionClient()
) {
  this.providerId = config.provider.id;
  // serviceUrl / modelId / timeout come from config.provider.options
}
```

**One possible runtime path (current default):**  
TypeScript provider → `POST :8002/v1/metadata/extract` → sidecar → local LLM on `:11434`.  

**Another possible path (after you add a provider):**  
TypeScript provider → OpenAI / Anthropic HTTPS API directly.  

Both are still “config → factory → provider.” Only the provider class and `id` change.

---

## Worked Example — Add OpenAI as a Metadata Provider

Same three steps you would use for any concern (intent, embedding, vector store).

### Step 1 — New provider file

`src/providers/extraction/openai/OpenAIMetadataExtractionProvider.ts`

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
    const options = config.provider.options as {
      inference?: { modelId?: string };
    };
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
      metadata: parsed, // map to ExtractedMetadata
    };
  }
}
```

### Step 2 — One factory line (+ config type id)

```typescript
openai: (config) => new OpenAIMetadataExtractionProvider(config),
```

### Step 3 — One config line

```typescript
// Before
id: "qwen";

// After
id: "openai";
```

### Step 4 — Secrets via env (never commit)

```bash
export OPENAI_API_KEY=sk-your-key-here
```

### Unchanged

| Area | Unchanged? |
|------|------------|
| READ pipeline | ✅ |
| WRITE pipeline | ✅ |
| CronService | ✅ |
| Vector store usage | ✅ |
| RuleEvaluator | ✅ |
| Hooks / buffer | ✅ |

---

## Same Steps for Other Concerns (quick)

### Intent — switch classifier

```typescript
// intent.config.ts
provider: { id: "bart-mnli", options: { /* … */ } }

// IntentProviderFactory.ts
"bart-mnli": (config) => new BartIntentProvider(config),
// "custom-nli": (config) => new CustomIntentProvider(config),
```

### Embeddings — switch embedder

```typescript
// embedding.config.ts
provider: { id: "minilm-l6-v2", options: { /* … */ } }

// EmbeddingProviderFactory.ts
"minilm-l6-v2": (config) => new MiniLMEmbeddingProvider(config),
```

### Vector store — switch persistence backend

```typescript
// vector-store.config.ts
provider: { id: "chromadb", options: { /* … */ } }

// VectorStoreProviderFactory.ts
chromadb: (config) => new ChromaDbVectorStoreProvider(config),
// qdrant: (config) => new QdrantVectorStoreProvider(config),
```

---

## Cost Comparison (metadata backends — illustrative)

When you use the **metadata** slot as the example, different `id`s imply different cost/privacy tradeoffs:

| Metadata backend (example) | Cost | Privacy | Quality | Speed |
|----------------------------|------|---------|---------|-------|
| Local sidecar + small LLM (`qwen` today) | $0 | 100% local | Good | ~8–15s |
| OpenAI gpt-4o-mini | ~$0.025/day* | Cloud ❌ | Better | ~2s |
| OpenAI gpt-4o | ~$0.25/day* | Cloud ❌ | Best | ~3s |
| Anthropic Claude Haiku | ~$0.02/day* | Cloud ❌ | Better | ~1s |
| Sidecar `rule-based` fallback | $0 | 100% local | Basic | ~10ms |

\*Order-of-magnitude for light batch usage — measure against your volume.

Intent / embedding / vector-store swaps have their own cost profiles (e.g. ChromaDB local vs a hosted vector DB).

---

## Tuning Without Swapping Provider

These knobs stay inside config (or a single constant) — still no pipeline rewrite.

### Metadata confidence threshold

```typescript
// metadata.config.ts
thresholds: { minConfidence: 0.8 } // was 0.7
```

### Metadata model / URL (same provider id)

```typescript
options: {
  inference: {
    modelId: "llama3.2:3b", // different model, same provider class
    serviceUrl: "http://127.0.0.1:8002",
    timeoutMs: 25_000,
  },
  temperature: 0.1,
}
```

### Batch interval

```typescript
// CronService.ts
const BATCH_INTERVAL_MS = 10 * 60 * 1000; // 10 min instead of 15
```

### Dedup threshold

```typescript
// vector-store.config.ts
export const DEFAULT_DEDUPLICATION_SIMILARITY_THRESHOLD = 0.95; // was 0.92
```

Keep `BatchWriteService`’s mirrored constant aligned if you change this.

---

## Summary

**Common rule for every FME concern:**

1. **One new file** — implement the area’s provider interface  
2. **One line** — register it in that area’s factory (+ type id in config)  
3. **One line** — set `provider.id` in that area’s `*.config.ts`

**Metadata** is the worked example in this doc because extraction is where people most often ask “can I plug in ChatGPT?” — not because Ollama is the only configurable thing.

Zero pipeline changes. Zero hook changes. Zero service rewrites.

---

*Related: [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md) §9 · [DATA_SHAPES.md](./DATA_SHAPES.md)*
