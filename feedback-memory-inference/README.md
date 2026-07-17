# Feedback Memory Inference Services

Local, vendor-independent inference sidecars for the Feedback Memory Engine TypeScript SDK.

These services implement the **exact HTTP contracts** consumed by:

| TypeScript provider | Port | Health | Inference endpoint |
|---------------------|------|--------|--------------------|
| `BartIntentProvider` | 8001 | `GET /health` | `POST /v1/intent/classify` |
| `OllamaMetadataExtractionProvider` | 8002 | `GET /health` | `POST /v1/metadata/extract` |
| `MiniLMEmbeddingProvider` | 8003 | `GET /health` | `POST /v1/embeddings/embed` |

ChromaDB runs on `http://127.0.0.1:8000` via native Python (`run_chroma.sh`).

No paid APIs. No API keys. All models run locally.

## Prerequisites

- Python 3.9+
- Node.js 18+ (for engine demo / MCP tests)
- ~3 GB disk for HuggingFace model downloads (first run)

## Starting FME Services

ChromaDB runs natively via `run_chroma.sh` — no Docker needed.

```bash
cd feedback-memory-inference
chmod +x run_*.sh stop_all.sh verify_all.sh
```

| Action | Command |
|--------|---------|
| Start | `./run_all.sh` |
| Stop | `./stop_all.sh` |
| Verify | `./verify_all.sh` |

`./run_all.sh` starts ChromaDB plus all three inference sidecars. First startup downloads models and may take several minutes.

Individual services:

```bash
./run_chroma.sh     # :8000
./run_intent.sh     # :8001
./run_metadata.sh   # :8002
./run_embedding.sh  # :8003
```

## Quick Start

### 1. Start all services

```bash
cd feedback-memory-inference
chmod +x run_*.sh stop_all.sh verify_all.sh
./run_all.sh
```

### 2. Verify the full stack

In a second terminal (with all services running):

```bash
cd feedback-memory-inference
./verify_all.sh
```

Or manually:

```bash
curl http://127.0.0.1:8000/api/v2/heartbeat
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:8002/health
curl http://127.0.0.1:8003/health

cd ..
npm run build:hook
```

Hook shell: `.cursor/hooks/capture-feedback.sh` → `dist/hook/demo/processPrompt.js`

## Service Details

### Intent (8001)

- Model: `facebook/bart-large-mnli`
- Zero-shot labels: `WRITE`, `READ`, `ANSWER_ONLY`
- Request body matches `BartIntentProvider` (`text`, `model_id`, `candidate_labels`, `multi_label`)
- Response: `{ "labels": [{ "label", "score" }] }`

### Metadata (8002)

- Default provider: **Ollama** (`qwen3:3b` via `localhost:11434`)
- Fallback provider: **rule-based** (`METADATA_PROVIDER=rule-based`)
- Request body matches `OllamaMetadataExtractionProvider`
- Response: `{ category, summary, technologies, topics, concepts, confidence }`

Use rule-based extraction without Ollama:

```bash
export METADATA_PROVIDER=rule-based
./run_metadata.sh
```

### Embedding (8003)

- Model: `sentence-transformers/all-MiniLM-L6-v2`
- Dimensions: 384
- Request: `{ text, model_id, purpose, normalize }`
- Response: `{ embedding: number[], dimensions: 384 }`

The TypeScript client reads the `embedding` field and applies L2 normalization when configured.

## TypeScript configuration (already wired)

| Service | Config file | Default URL |
|---------|-------------|-------------|
| Intent | `config/intent.config.ts` | `http://127.0.0.1:8001` |
| Metadata | `config/metadata.config.ts` | `http://127.0.0.1:8002` |
| Embedding | `config/embedding.config.ts` | `http://127.0.0.1:8003` |
| Chroma | `config/vector-store.config.ts` | `http://127.0.0.1:8000` |

## Cursor Hook

The production hook runs compiled output. After changing engine source:

```bash
cd fme
npm run build:hook
```

Hook shell: `.cursor/hooks/capture-feedback.sh` → `dist/hook/demo/processPrompt.js`

## Logs

When using `run_all.sh`, service logs are written to `feedback-memory-inference/logs/` (`chroma.log`, `intent.log`, `metadata.log`, `embedding.log`).

## Limitations

- First model load is slow and requires network access to HuggingFace Hub.
- BART-MNLI intent scores depend on phrasing; threshold tuning is in `intent.config.ts`.
- Rule-based metadata extraction covers common feedback patterns; Ollama optional for richer extraction.
