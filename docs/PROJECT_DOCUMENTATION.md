# FME — Feedback Memory Engine
## Complete Project Documentation

---

## 1. What is FME? (For everyone)

FME gives Cursor AI a **persistent memory across sessions**.

When you correct Cursor, make a team decision, or catch a bad pattern — FME captures it automatically, stores it locally, and injects it silently into every future prompt.

No re-explaining. No lost context. Ever.

| Metric | Value |
|--------|-------|
| Developer wait time | ~500ms (READ only) |
| Background processing | ~60–100s (invisible) |
| Cloud cost | **$0** |
| Data leaves machine | **Never** |

---

## 2. The Problem FME Solves

Cursor AI has **no closed feedback loop**.

- Cursor AI forgets everything when a chat closes
- Every new session starts from zero
- Corrections, team decisions, anti-patterns — all lost
- Developers repeat the same feedback every session
- There is no mechanism to make feedback permanent

### Real testcase

```
Session 1: "never use localStorage for JWT tokens"
Cursor:    "Got it — using httpOnly cookies"
[Chat closed]

Session 2: Same question
Cursor:    "Use localStorage outbox" — forgot everything
```

Without FME, institutional knowledge lives only in chat history that disappears.

---

## 3. The Solution — How FME Works

FME closes the loop. Every prompt passes through this cycle silently:

1. Developer types a prompt in Cursor  
2. Hook captures instantly (`beforeSubmitPrompt`, ~0ms)  
3. BART classifies intent (background)  
4. Ollama extracts meaning (background)  
5. ChromaDB stores the memory (background)  
6. A rule is written to `.cursor/rules/` when warranted (background)  
7. Next prompt → ChromaDB searches relevant memories  
8. Memories are injected silently above the prompt  
9. Cursor AI answers with full team context  

```
Developer → Hook → Buffer → [Batch] → BART → Ollama → ChromaDB → Rules
                ↑                                              |
                └──────── enrichPrompt (READ) ←────────────────┘
```

---

## 4. Architecture — 4 Pipelines

### READ Pipeline (every prompt, blocking, ~500ms)

**Purpose:** Enrich the current prompt with relevant past memories before Cursor generates a reply.

**Flow:**

```
Hook fires
  → appendToBuffer (~0ms)
  → ChromaDB HNSW search
  → rankCandidates()
  → selectTopMemories()
  → enrichPrompt()
  → Cursor AI sees enriched context
  → afterAgentResponse captures AI reply
  → buffer updated with aiResponse
```

**Ranking formula:**

```
finalScore = 0.65K + 0.15T + 0.20C
```

| Signal | Symbol | Weight | Source |
|--------|--------|--------|--------|
| Keyword / vector similarity | K | 0.65 | ChromaDB HNSW score |
| Type bonus | T | 0.15 | Correction=1.0, AntiPattern=0.9, Decision=0.8, TaskLearning=0.7 |
| Conversation bonus | C | 0.20 | 1.0 if same session, else 0 |

**Selection:**

- Vector search: top **5** candidates (`vectorSearchTopK`)
- Vector floor: score ≥ **0.42** (`vectorSearchMinScore`)
- Final inject floor: `finalScore` ≥ **0.48** (`minFinalScore`)
- At most **5** memories injected

Config: `src/config/ranking.config.ts`, `src/config/retrieval.config.ts`, `src/config/selection.config.ts`.

---

### WRITE Pipeline (every 15 min, background)

**Purpose:** Turn buffered prompts into structured memories — without blocking the developer.

**Flow:**

```
appendToBuffer
  → CronService tick (every 15 min)
  → getUnprocessedBuffer()
  → markEntriesAsProcessed()
  → spawn runBatch.js (detached)
  → BART 5-way labels intent (all entries proceed)
  → groupByConversationId
  → one Ollama call per conversation group
  → ChromaDB dedup (similarity ≥ 0.92 → skip)
  → upsert memory
  → RuleEvaluator (fire-and-forget)
```

Developer never waits on WRITE. Hook `writeMs` stays **0** on the hot path; batch work runs in CronService / detached Node.

---

### RULE EVALUATION Pipeline (per memory, fire-and-forget)

**Purpose:** Promote strong memories into Cursor rules (`.mdc` files) and keep those rules healthy over time.

**Flow:**

```
Memory stored
  → Promotion Check (TypeScript, no model):
       conf ≥ 0.95          → promote any category
       AntiPattern/Decision ≥ 0.85 → create Rule
       TaskLearning ≥ 0.85  → create Skill
       below threshold      → skip
  → MiniLM embeds memory summary + each .mdc file
  → cosine similarity in TypeScript
  → similarity > 0.70 → EXISTING RULE FOUND
       → applyTimeDecay: max(0.40, score − months×0.01)
       → Ollama evaluateExistingRule()
            CONFIRM:    score + conf×0.05
            EXTEND:     score + conf×0.08
            CONTRADICT: score − conf×0.30
            OBSOLETE:   delete .mdc file
       → delete if score < 0.40 or OBSOLETE
  → similarity ≤ 0.70 → NO EXISTING RULE
       → Ollama generates rule text
       → buildFrontmatter() → write .mdc under .cursor/rules/
```

Implemented in `src/services/evaluation/RuleEvaluator.ts`.

---

### SKILL CREATION Pipeline (every 24 hrs)

**Purpose:** Extract reusable step-by-step workflows from conversation history.

**Flow:**

```
CronService 24hr tick
  → readBuffer() (all entries)
  → groupByConversationId
  → build conversation string
  → Ollama hasSkill extraction
  → confidence ≥ 0.70
  → generate globs from technologies[]
  → write *-skill.mdc to .cursor/rules/
  → cleanup old buffer entries
```

Implemented in `src/services/batch/CronService.ts` (`SKILL_INTERVAL_MS = 24h`).

---

## 5. Tech Stack — Why Each Was Chosen

| Component | Technology | Port | RAM | Why chosen |
|-----------|------------|------|-----|------------|
| Intent Classification | BART-MNLI | :8001 | ~177MB | Zero-shot NLI, no training needed, 5-way classification, local and free, understands meaning not just keywords |
| Metadata Extraction | Ollama qwen2.5:3b | :11434 | ~2.5GB | $0 cost, 100% local, good enough for structured JSON, temperature=0.1 for deterministic output, no data leaves machine |
| Vector Storage | ChromaDB | :8000 | ~25MB | Local, free, HNSW search, handles own embeddings, fast approximate nearest-neighbor search |
| Rule Similarity | MiniLM all-MiniLM-L6-v2 | :8003 | ~15MB | Used in Rule Evaluation for `.mdc` comparison; ~87MB disk, ~50ms per embedding, free and local |
| Metadata Sidecar | Python FastAPI | :8002 | ~42MB | Bridges TypeScript hook to Ollama; builds extraction prompts |
| Batch Scheduler | CronService (Node.js) | — | ~54MB | Every 15 min WRITE batch; every 24 hr skills + cleanup; uses `last_batch.json` to avoid duplicate work |

**Totals:** ~3.1GB RAM · ~3.5GB disk · **$0** cloud cost

---

## 6. BART — 5 Intent Categories

Batch classification uses five feedback categories (plus drop noise):

### Correction

- **What:** A specific past mistake being fixed  
- **Example:** “I used MD5 for passwords in auth.ts — change it to bcrypt”  
- **Key:** past-oriented, specific location, explicit fix  

### Decision

- **What:** A team-level architectural choice  
- **Example:** “we decided to use PostgreSQL for all database operations — never MongoDB”  
- **Key:** team-level, project-wide, forward-looking  

### AntiPattern

- **What:** A universal bad practice to permanently avoid  
- **Example:** “never store JWT tokens in localStorage — always use httpOnly cookies”  
- **Key:** universal rule, preventive, any project  

### TaskLearning

- **What:** A step-by-step workflow to always follow  
- **Example:** “when adding API endpoint: route → controller → Zod schema → register app.ts”  
- **Key:** procedural, reusable, scoped to a module  

### NotMemoryWorthy

- **What:** A question with no team decision  
- **Example:** “what is the difference between SQL and NoSQL?”  
- **Key:** question only; safely dropped — keeps ChromaDB clean  

---

## 7. Services Architecture

| Service | Port | Technology | Purpose | RAM |
|---------|------|------------|---------|-----|
| ChromaDB | 8000 | Python | Vector storage + HNSW search | ~25MB |
| BART-MNLI | 8001 | Python FastAPI | 5-way intent classification | ~177MB |
| Metadata Sidecar | 8002 | Python FastAPI | Ollama extraction bridge | ~42MB |
| MiniLM | 8003 | Python FastAPI | Rule similarity embeddings | ~15MB |
| Ollama | 11434 | Go binary | qwen2.5:3b LLM inference | ~2.5GB |
| CronService | — | Node.js | Batch scheduler (15m / 24h) | ~54MB |

All services: **local**, no cloud, no API keys, **$0** cost.

Health checks (inference stack):

```bash
curl http://127.0.0.1:8000/api/v2/heartbeat
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:8002/health
curl http://127.0.0.1:8003/health
```

---

## 8. Key Technical Decisions

**Q: Why BART for classification, not GPT-4?**  
A: BART-MNLI runs locally ($0). Zero-shot NLI needs no training data. ~177MB fits easily in RAM. ~1,100ms warm is acceptable for background processing. GPT-4 would cost ~$30/month and send codebase context to the cloud.

**Q: Why Ollama qwen2.5:3b, not a larger model?**  
A: 3B parameters ≈ 2.5GB RAM, runs on Mac CPU without a GPU, and is good enough for structured JSON extraction with `temperature=0.1`. Larger models typically need 8GB+ GPU RAM.

**Q: Why ChromaDB, not Pinecone?**  
A: ChromaDB runs locally ($0, private). Pinecone is cloud-only and costly. For &lt; 100K memories, ChromaDB HNSW (~100–400ms) is fast enough.

**Q: Why MiniLM only in Rule Evaluation, not READ/WRITE?**  
A: ChromaDB owns embeddings for READ/WRITE memory search. MiniLM is needed in Rule Evaluation because `.mdc` files live on disk — ChromaDB cannot search them. MiniLM embeds both the memory and each `.mdc`; TypeScript computes cosine similarity.

**Q: Why group by `conversationId` before Ollama?**  
A: Ten buffer entries from two sessions become **two** Ollama calls, not ten. Saves ~60–70% of Ollama calls. Same session = shared context = better extraction quality.

**Q: Why `temperature=0.1`?**  
A: Near-deterministic output. The same developer prompt should produce stable category, summary, and confidence. `temperature=0` can cause repetitive loops; `0.1` is stable.

**Q: Why 0.92 dedup threshold?**  
A: Very high — only near-identical text is skipped. Two slightly different phrasings of the same decision can both be stored and reinforce rules over time.

**Q: Why 0.40 floor in time decay?**  
A: Time alone should **never** delete a rule. A security rule from two years ago can still be valid. Only CONTRADICT (or OBSOLETE) can push a score below 0.40 and trigger deletion. The floor prevents accidental deletion of stable rules.

**Q: Why a 15-minute cron interval?**  
A: Too short (1 min) → too many Ollama calls. Too long (1 hour) → a 9:00 correction may not be stored before a 9:30 new task. Fifteen minutes stores corrections before the developer’s next context switch.

---

## 9. Configurability — Config → Factory → Provider

FME uses a three-step pattern so models can be swapped without rewriting pipelines.

### Step 1 — Config (`src/config/metadata.config.ts`)

Change the active provider id and options:

```ts
export const METADATA_CONFIG = {
  provider: {
    id: "qwen", // switch to "openai", "claude", etc. once registered
    options: DEFAULT_QWEN_METADATA_OPTIONS,
  },
  thresholds: DEFAULT_METADATA_EXTRACTION_THRESHOLDS,
};
```

Default Qwen options point at the local sidecar: `http://127.0.0.1:8002` (which talks to Ollama on `:11434`).

### Step 2 — Factory (`src/composition/MetadataProviderFactory.ts`)

Register one constructor line for the new provider:

```ts
openai: (config) => new OpenAIMetadataExtractionProvider(config),
```

### Step 3 — Provider

Implement `MetadataExtractionProvider` under `src/providers/extraction/<name>/`.  
The provider reads **everything** from injected config — no hardcoded URLs in business logic.

### To add ChatGPT (example)

| Change | Effort |
|--------|--------|
| Create `OpenAIMetadataExtractionProvider.ts` | 1 new file |
| Add `"openai": (config) => new …` in factory | 1 line |
| Set `id: "openai"` in config | 1 line |
| Pipelines, hooks, ChromaDB, rules | **Zero changes** |

Same pattern exists for intent (`IntentProviderFactory`), embeddings (`EmbeddingProviderFactory`), and vector store (`VectorStoreProviderFactory`).

---

## 10. Rule File Format

Rules live under `.cursor/rules/*.mdc` and use YAML frontmatter + Markdown body.

```markdown
---
description: "Always use PostgreSQL for database storage"
alwaysApply: false
globs: ["src/**/*.ts"]
fme_score: 0.950
fme_created: "2026-07-15"
fme_last_updated: "2026-07-16"
fme_reinforcement_count: 2
fme_contradiction_count: 0
---

# Why this rule exists
…

# Rule
…

# Checklist
…
```

| Field | Meaning |
|-------|---------|
| `description` | What Cursor AI reads — one clear line |
| `alwaysApply` | `true` = loaded every prompt; `false` = context / glob based |
| `globs` | Which files activate this rule |
| `fme_score` | Health score (≥ ~0.85 healthy; &lt; 0.40 → delete) |
| `fme_created` | Original creation date (never changes) |
| `fme_last_updated` | Updated on every evaluation (drives time decay) |
| `fme_reinforcement_count` | Times CONFIRM / EXTEND happened |
| `fme_contradiction_count` | Times CONTRADICT happened |

Skill files (`*-skill.mdc`) use a similar frontmatter and are produced by the 24-hour skill job.

---

## 11. Performance — Real Measured Numbers

Measured from PERF logs, README benchmarks, and terminal output.

### Developer experience

| Metric | Typical value |
|--------|----------------|
| Hook fires | ~0ms (sync buffer write) |
| READ pipeline | ~30–500ms (search + rank + inject) |
| `writeMs` on hot path | **0** (WRITE never blocks) |
| `totalMs` | ~500ms average |
| Proven enriched run | `readMs=1324`, `writeMs=0`, `totalMs=1440`, `enriched=true` |

### Model / service performance

| Component | Latency |
|-----------|---------|
| BART cold start | ~3,426ms (first call, model load) |
| BART warm | ~1,100ms per classification |
| Ollama cold start | ~20s (model load into memory) |
| Ollama warm extraction | ~8–15s per call |
| MiniLM embed | ~50ms |
| ChromaDB upsert | ~1–2s |
| Background batch (full) | ~60–100s (invisible) |

### Resource footprint

| Resource | Approx. |
|----------|---------|
| Total RAM | ~3.1GB |
| Total disk (models) | ~3.5GB |
| Cloud / API cost | **$0** |

---

## 12. Data Locations (on disk)

| Artifact | Path | Role |
|----------|------|------|
| Prompt buffer | `.cursor/hooks/prompt_buffer.json` | Queued developer ↔ AI turns |
| Hook log | `.cursor/hooks/feedback-memory-hook.log` | READ/WRITE diagnostics + PERF |
| Metadata analysis log | `.cursor/hooks/ollama_metadata.log` | Human-readable extraction dump |
| Batch cursor | `.cursor/hooks/last_batch.json` | Prevents duplicate batch runs |
| Rules & skills | `.cursor/rules/*.mdc` | Cursor-visible persistent guidance |
| Vector memories | ChromaDB data dir (local service :8000) | Embeddings + metadata for HNSW |

Nothing in this list is sent to a cloud LLM provider when using the default Ollama stack.

---

## 13. Getting Started (summary)

```bash
# One-time setup
./setup.sh

# macOS: auto-start on login
bash scripts/setup-launchd.sh

# Manual start / verify
cd feedback-memory-inference
./run_all.sh
./verify_all.sh

# After TypeScript hook changes
cd .. && npm run build:hook
```

See root `README.md` for Windows notes, LaunchD commands, and service restart recipes.

---

## 14. Source Map (where to look in code)

| Concern | Primary paths |
|---------|----------------|
| Cursor hook | `src/integration/cursor/`, `.cursor/hooks/` |
| READ pipeline | `src/pipelines/read/ReadPipeline.ts`, `src/retrieval/` |
| WRITE / batch | `src/services/batch/BatchWriteService.ts`, `CronService.ts` |
| Rule / skill eval | `src/services/evaluation/RuleEvaluator.ts` |
| Metadata config | `src/config/metadata.config.ts` |
| Provider factory | `src/composition/MetadataProviderFactory.ts` |
| Ollama metadata provider | `src/providers/extraction/ollama/` |
| Python sidecars | `feedback-memory-inference/` |

---

## 15. Glossary

| Term | Definition |
|------|------------|
| **Memory** | Structured feedback stored in ChromaDB (category, summary, tech, topics, confidence) |
| **Enrichment** | Injecting retrieved memories into the prompt before the model replies |
| **Rule** | A `.mdc` file under `.cursor/rules/` promoted from strong memories |
| **Skill** | A workflow-oriented `.mdc` extracted from conversation patterns |
| **Dedup** | Skipping upsert when an existing memory is ≥ 0.92 similar |
| **Time decay** | Slowly lowering `fme_score` after 30 days of inactivity, floored at 0.40 |
| **Sidecar** | Local FastAPI service bridging Node to Python models |

---

*Document version: 2026-07-24 · Project: Feedback Memory Engine (FME)*
