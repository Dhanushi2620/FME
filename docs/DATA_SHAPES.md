# FME — Data Shapes & Schemas

Every data structure as it flows through the FME pipeline from hook → buffer → BART → Ollama → ChromaDB → enrichment → rules.

```
Cursor JSON
  → BufferEntry
  → ClassifiedEntry (BART)
  → GroupStatementMetadata[] (Ollama)
  → ExtractedMetadata
  → VectorMemoryRecord (ChromaDB)
  → VectorSearchHit → RankedCandidate → PromptEnrichment
  → .mdc rules / skills
```

---

## 1. Hook Input — What Cursor sends to FME

Shape received by `.cursor/hooks/capture-feedback.sh` (stdin JSON), then read by `src/demo/processPrompt.ts`:

```json
{
  "conversation_id": "b3acb5e2-4608-434b-be2e-437681",
  "generation_id": "ee5f2c5f-3a91-43f0-9144-cd016",
  "prompt": "never use localStorage for JWT tokens"
}
```

| Field | Description |
|-------|-------------|
| `conversation_id` | UUID assigned by Cursor per chat session. Same for all prompts in one chat window. Changes when the developer opens a new chat. Mapped internally to `conversationId`. |
| `generation_id` | UUID per individual prompt. Unique per message — used as ChromaDB document id and for self-exclusion during READ search. Mapped internally to `messageId` / `generationId`. |
| `prompt` | Raw developer prompt text. This is what BART classifies and what becomes `developerText` in the buffer. |

**Internal hook input** (`BeforeSubmitPromptInput`):

```typescript
{
  text: string;           // from prompt
  conversationId: string; // from conversation_id
  messageId: string;      // from generation_id
}
```

**Hook stdout** (fail-open always continues):

```json
{
  "continue": true,
  "updated_input": {
    "prompt": "1. [AntiPattern] Never store JWT in localStorage...\n\n---\n\nnever use localStorage for JWT tokens"
  }
}
```

When no memories match, `updated_input.prompt` is the original text unchanged.

---

## 2. Buffer Entry — `prompt_buffer.json`

Shape after `appendToBuffer()` (`src/services/batch/BufferManager.ts` → `.cursor/hooks/prompt_buffer.json`):

```json
{
  "conversationId": "b3acb5e2-4608-434b-be2e-437681",
  "generationId": "ee5f2c5f-3a91-43f0-9144-cd016",
  "developerText": "never use localStorage for JWT tokens — always use httpOnly cookies",
  "aiResponse": "Understood — I will use httpOnly cookies for all token storage. localStorage is not safe for JWT.",
  "timestamp": "2026-07-20T05:30:00.000Z",
  "batchProcessed": false
}
```

| Field | Description |
|-------|-------------|
| `developerText` | What the developer typed (from hook `prompt`) |
| `aiResponse` | What Cursor AI replied — filled by `afterAgentResponse` / `updateAiResponse`. Empty string until that fires. Updated in-place on the same `generationId`. |
| `batchProcessed` | `false` until CronService claims the entry. Set to `true` **immediately** before spawning `runBatch.js` so restarts do not double-process. Old processed entries are cleaned up on the 24h job. |
| `timestamp` | When the buffer write happened (ISO or IST string depending on writer) |

Related files:

- `.cursor/hooks/last_batch.json` → `{ "timestamp": 1721723456789 }`
- `.cursor/hooks/batch_snapshot.json` → snapshot of `BufferEntry[]` for a run

---

## 3. BART Classification Output

Shape returned by `POST /v1/intent/classify` on `:8001` (batch path, 5-way hypotheses):

```json
{
  "labels": [
    {
      "label": "This text describes a general coding anti-pattern or bad practice the entire team should permanently avoid.",
      "score": 0.731
    },
    {
      "label": "This text states a technical engineering correction about code, architecture, or tooling — not a simple editing request.",
      "score": 0.142
    },
    {
      "label": "This text states a team decision or commitment the whole team should follow going forward.",
      "score": 0.089
    },
    {
      "label": "This text explains a step-by-step technical procedure or workflow to follow in this project.",
      "score": 0.024
    },
    {
      "label": "This text asks a question or seeks information — it does not state any rule, decision, correction, or procedure.",
      "score": 0.014
    }
  ]
}
```

**Request body** (batch):

```json
{
  "text": "never use localStorage for JWT tokens — always use httpOnly cookies",
  "candidate_labels": [
    "This text states a technical engineering correction about code, architecture, or tooling — not a simple editing request.",
    "This text states a team decision or commitment the whole team should follow going forward.",
    "This text describes a general coding anti-pattern or bad practice the entire team should permanently avoid.",
    "This text explains a step-by-step technical procedure or workflow to follow in this project.",
    "This text asks a question or seeks information — it does not state any rule, decision, correction, or procedure."
  ]
}
```

**How FME uses this:**

1. Takes `labels[0]` — highest score = predicted category  
2. Maps long label text → short category name:

| Label contains | Category |
|----------------|----------|
| anti-pattern / permanently avoid | `AntiPattern` |
| engineering correction | `Correction` |
| team decision | `Decision` |
| procedure / workflow | `TaskLearning` |
| asks a question | `NotMemoryWorthy` |

3. Uses `labels[0].score` as BART confidence  
4. Keep filter before Ollama: not `NotMemoryWorthy`, confidence ≥ ~0.5, and category ∈ FeedbackCategory  

> Note: a **LEGACY** 3-way path (`WRITE` / `READ` / `ANSWER_ONLY`) exists in `intent.config.ts` for `BartIntentProvider`. The live Cursor hook always buffers + READ; batch classification uses the 5-way labels above.

---

## 4. Classified Buffer Entry (after BART)

In-memory shape in `BatchWriteService` (`ClassifiedEntry` = `BufferEntry` + BART fields):

```json
{
  "conversationId": "b3acb5e2-4608-434b-be2e-437681",
  "generationId": "ee5f2c5f-3a91-43f0-9144-cd016",
  "developerText": "never use localStorage for JWT tokens — always use httpOnly cookies",
  "aiResponse": "Understood — I will use httpOnly cookies...",
  "timestamp": "2026-07-20T05:30:00.000Z",
  "batchProcessed": false,
  "bartLabel": "This text describes a general coding anti-pattern or bad practice the entire team should permanently avoid.",
  "confidence": 0.731,
  "category": "AntiPattern"
}
```

Entries are then **grouped by `conversationId`** before Ollama.

---

## 5. Ollama User Prompt Input

Per conversation group, TypeScript builds a conversation string + extraction prompt (`buildConversationContext` + `buildGroupExtractionPrompt`).

### 5a. Conversation context string

```text
Turn 1:
Developer: never use localStorage for JWT tokens — always use httpOnly cookies
Cursor AI: Understood — I will use httpOnly cookies for all token storage.

Turn 2:
Developer: also apply this in the auth middleware
Cursor AI: Updated the middleware to set httpOnly cookies.
```

### 5b. Full user message (truncated)

```text
Here is a complete developer conversation:

Turn 1:
Developer: never use localStorage for JWT tokens — always use httpOnly cookies
Cursor AI: Understood — I will use httpOnly cookies for all token storage.

From this conversation, extract metadata for these
specific memory-worthy statements that were identified:

Statement 1: 'never use localStorage for JWT tokens — always use httpOnly cookies' — Category: AntiPattern (from BART)

For EACH statement, extract:
- summary: ...
- technologies: [...]
- topics: [...]
- confidence: 0.0-1.0

Do NOT re-classify the category — it is already known.

Return a JSON array where each element is an object with curly braces:
[
  {
    "summary": "descriptive summary here",
    "technologies": ["Tech1", "Tech2"],
    "topics": ["Topic1", "Topic2"],
    "confidence": 0.95
  }
]
```

### 5c. Ollama HTTP request (`POST /api/chat` on `:11434`)

```json
{
  "model": "qwen2.5:3b",
  "stream": false,
  "options": {
    "temperature": 0.1,
    "num_ctx": 8192
  },
  "messages": [
    {
      "role": "system",
      "content": "IMPORTANT CONTEXT: You are analyzing conversations from Cursor IDE..."
    },
    {
      "role": "user",
      "content": "<conversation + statements block from above>"
    }
  ]
}
```

---

## 6. Ollama Extraction Output

Shape returned by Ollama per statement (JSON array, **1:1** with kept statements in the group):

```json
[
  {
    "summary": "Storing JWT tokens in localStorage is a security anti-pattern. Always use httpOnly cookies for token storage to prevent XSS attacks.",
    "technologies": ["JWT", "localStorage", "httpOnly cookies"],
    "topics": ["Security", "Authentication"],
    "confidence": 0.91
  },
  {
    "summary": "The team decided to always validate all request bodies using Zod schemas before they reach the controller layer to ensure type safety and security.",
    "technologies": ["Zod"],
    "topics": ["Validation", "Security", "API"],
    "confidence": 0.88
  }
]
```

| Field | Description |
|-------|-------------|
| `summary` | Standalone sentence(s) — no prior context needed to understand. Written by Ollama following the system/user prompt rules. Explains **WHY**, not just WHAT. This text is **embedded** and later **injected** into future prompts. |
| `technologies` | Specific tools, libraries, frameworks. Used to generate glob patterns for `.mdc` rules. Must not be empty if any technology was mentioned in the conversation. |
| `topics` | Broad domain categories (1–3 per memory). Used for search relevance and organization. |
| `confidence` | Ollama’s certainty about this extraction (`[0, 1]`, clamped in TypeScript). Used in promotion checks (≥ **0.85** → create rule / skill for qualifying categories; ≥ **0.95** can promote any category). Used in score formulas (e.g. CONFIRM: `score + conf×0.05`). |

Parsed as `GroupStatementMetadata`:

```typescript
{
  summary: string;
  technologies: string[];
  topics: string[];
  concepts: string[];   // optional; default []
  confidence: number;   // clamped to [0, 1]
}
```

Ollama wire envelope:

```json
{
  "message": {
    "content": "[ { \"summary\": \"...\", \"technologies\": [...], \"topics\": [...], \"confidence\": 0.91 } ]"
  }
}
```

**Category is not returned by Ollama** — BART’s category is merged when building `ExtractedMetadata` before persist / rule eval.

Batch quality gate: entries with `confidence` below ~**0.6** (`METADATA_QUALITY_THRESHOLD`) are skipped before Chroma upsert.

---

## 7. ExtractedMetadata — Canonical Memory Shape

Contract: `src/contracts/extraction/MetadataExtractionProvider.ts`

After merge (BART category + Ollama fields):

```json
{
  "category": "AntiPattern",
  "summary": "Storing JWT tokens in localStorage is a security anti-pattern. Always use httpOnly cookies for token storage to prevent XSS attacks.",
  "technologies": ["JWT", "localStorage", "httpOnly cookies"],
  "topics": ["Security", "Authentication"],
  "concepts": [],
  "confidence": 0.91
}
```

| Field | Rules |
|-------|-------|
| `category` | `Correction` \| `Decision` \| `AntiPattern` \| `TaskLearning` (from BART) |
| `summary` | Standalone storage / inject / embed text (from Ollama) |
| `technologies` | Specific tools / libs / frameworks |
| `topics` | Broad domains (Database, Security, …) |
| `concepts` | Optional finer tags |
| `confidence` | `[0, 1]` from Ollama |

**`MetadataExtractionResult` envelope** (service / sidecar path):

```json
{
  "metadata": {
    "category": "AntiPattern",
    "summary": "...",
    "technologies": [],
    "topics": [],
    "concepts": [],
    "confidence": 0.91
  },
  "detectedLabel": "optional",
  "error": "optional error string"
}
```

---

## 8. ChromaDB Storage Shape

Shape stored per memory in ChromaDB (`VectorMemoryRecord` / `VectorMemoryMetadata`).  
Call site: `BatchWriteService.persistEntry` → `vectorStore.upsertMemory`.

### 8a. Domain record (TypeScript)

```json
{
  "id": "ee5f2c5f-3a91-43f0-9144-cd016",
  "vector": [0.012, -0.044, 0.091],
  "metadata": {
    "id": "ee5f2c5f-3a91-43f0-9144-cd016",
    "category": "AntiPattern",
    "summary": "Storing JWT tokens in localStorage is a security anti-pattern. Always use httpOnly cookies for token storage to prevent XSS attacks.",
    "conversationId": "b3acb5e2-4608-434b-be2e-437681",
    "messageId": "ee5f2c5f-3a91-43f0-9144-cd016",
    "technologies": ["JWT", "localStorage", "httpOnly cookies"],
    "topics": ["Security", "Authentication"],
    "concepts": [],
    "confidence": 0.91
  }
}
```

### 8b. Field descriptions

| Field | Source | Role |
|-------|--------|------|
| `id` | `generationId` | Unique Chroma document id (idempotent upsert key) |
| `vector` | Embedding of `summary` | Dense vector for HNSW similarity search |
| `metadata.id` | same as record `id` | Must match document id |
| `metadata.category` | BART | Type bonus on READ; rule promotion path |
| `metadata.summary` | Ollama | Embedded text; injected into future prompts |
| `metadata.conversationId` | Buffer | Session scope; READ filters / conversation bonus |
| `metadata.messageId` | `generationId` | Self-exclusion on READ/dedup (`excludeMessageId`) |
| `metadata.technologies` | Ollama | Tags; rule globs |
| `metadata.topics` | Ollama | Tags; relevance organization |
| `metadata.concepts` | Ollama (optional) | Finer tags |
| `metadata.confidence` | Ollama | Promotion / scoring |

**What each part is used for:**

| Part | Used for |
|------|----------|
| `id` | Dedup / identity — upsert **overwrites** if the same id already exists |
| `vector` | HNSW nearest-neighbor search during the **READ** pipeline |
| `metadata.summary` | Injected into the enriched prompt Cursor AI sees |
| `metadata.category` | `typeBonus` (T) in the ranking formula |
| `metadata.conversationId` | `conversationBonus` (C) in ranking (same session → 1.0) |
| `metadata.confidence` | **Not** used in READ ranking — used in **Rule Evaluation** promotion and CONFIRM/EXTEND/CONTRADICT score deltas |

Required for valid read-back: `category`, `summary`, `conversationId`, `messageId`.

### 8c. Wire format to Chroma HTTP API

Array fields are **JSON-stringified** (Chroma metadata values are scalar-friendly):

```json
{
  "ids": ["ee5f2c5f-3a91-43f0-9144-cd016"],
  "embeddings": [[0.012, -0.044, 0.091]],
  "metadatas": [
    {
      "id": "ee5f2c5f-3a91-43f0-9144-cd016",
      "category": "AntiPattern",
      "summary": "Storing JWT tokens in localStorage is a security anti-pattern. Always use httpOnly cookies for token storage to prevent XSS attacks.",
      "conversationId": "b3acb5e2-4608-434b-be2e-437681",
      "messageId": "ee5f2c5f-3a91-43f0-9144-cd016",
      "confidence": 0.91,
      "technologies": "[\"JWT\",\"localStorage\",\"httpOnly cookies\"]",
      "topics": "[\"Security\",\"Authentication\"]",
      "concepts": "[]"
    }
  ]
}
```

On read, the provider parses those strings back into `string[]` for domain `VectorSearchHit.metadata`.

---

## 9. Dedup Check

Before upsert, FME searches for a near-duplicate (threshold **0.92**).

**Search input:**

```json
{
  "vector": [0.012, -0.044, 0.091],
  "topK": 1,
  "minScore": 0,
  "filter": {
    "excludeMessageId": "ee5f2c5f-3a91-43f0-9144-cd016"
  }
}
```

**Skip when:** `hits.length > 0 && hits[0].score > 0.92`

Config: `DEFAULT_DEDUPLICATION_SIMILARITY_THRESHOLD` in `src/config/vector-store.config.ts` (also mirrored in `BatchWriteService`).

---

## 10. ChromaDB Search Result Shape

Raw shape returned by Chroma during the **READ** pipeline (`include: ["metadatas", "distances"]`):

```json
{
  "ids": [["ee5f2c5f-3a91-43f0-9144-cd016", "abc12345-1111-2222-3333-444444444444", "def45678-1111-2222-3333-444444444444"]],
  "distances": [[0.18, 0.31, 0.45]],
  "metadatas": [
    [
      {
        "category": "AntiPattern",
        "summary": "Never use localStorage for JWT tokens...",
        "technologies": "[\"JWT\",\"localStorage\"]",
        "topics": "[\"Security\"]",
        "confidence": 0.91,
        "conversationId": "b3acb5e2-4608-434b-be2e-437681",
        "messageId": "ee5f2c5f-3a91-43f0-9144-cd016"
      },
      {
        "category": "Decision",
        "summary": "Always validate with Zod...",
        "technologies": "[\"Zod\"]",
        "topics": "[\"Validation\"]",
        "confidence": 0.88,
        "conversationId": "b3acb5e2-4608-434b-be2e-437681",
        "messageId": "abc12345-1111-2222-3333-444444444444"
      }
    ]
  ]
}
```

**How FME uses this** (`ChromaDbVectorStoreProvider`):

1. `distance` → similarity: `similarity = 1 - distance` (clamped to `[0, 1]`)  
2. Hits below `vectorSearchMinScore` (**0.42**) are dropped  
3. Metadata is mapped into `VectorSearchHit[]` and passed toward `rankCandidates()`  
4. `id` / `messageId` used for **self-exclusion** (filter out the current `generationId`)  
5. Optional `excludeConversationId` / `excludeMessageId` on the search request also drop the current turn  

Domain hit after mapping:

```json
{
  "id": "ee5f2c5f-3a91-43f0-9144-cd016",
  "score": 0.82,
  "metadata": {
    "category": "AntiPattern",
    "summary": "Never use localStorage for JWT tokens...",
    "conversationId": "b3acb5e2-4608-434b-be2e-437681",
    "messageId": "ee5f2c5f-3a91-43f0-9144-cd016",
    "technologies": ["JWT", "localStorage"],
    "topics": ["Security"],
    "confidence": 0.91
  }
}
```

---

## 11. `rankCandidates()` Output Shape

Conceptual shape after the ranking formula (K / T / C):

```json
[
  {
    "generationId": "ee5f2c5f-3a91-43f0-9144-cd016",
    "summary": "Never use localStorage for JWT tokens...",
    "category": "AntiPattern",
    "conversationId": "b3acb5e2-4608-434b-be2e-437681",
    "scores": {
      "K": 0.82,
      "T": 0.9,
      "C": 1.0,
      "finalScore": 0.773
    }
  },
  {
    "generationId": "abc12345-1111-2222-3333-444444444444",
    "summary": "Always validate with Zod...",
    "category": "Decision",
    "conversationId": "xyz78901-1111-2222-3333-444444444444",
    "scores": {
      "K": 0.74,
      "T": 0.8,
      "C": 0.0,
      "finalScore": 0.601
    }
  }
]
```

**Formula per candidate:**

```text
finalScore = 0.65×K + 0.15×T + 0.20×C
```

| Signal | Meaning | Weights / values |
|--------|---------|------------------|
| **K** | Chroma similarity (`1 - distance`) | weight **0.65** |
| **T** | Type bonus | Correction=1.0, AntiPattern=0.9, Decision=0.8, TaskLearning=0.7 — weight **0.15** |
| **C** | Conversation bonus | **1.0** if same `conversationId` as current prompt, else **0** — weight **0.20** |

Then:

1. Sort descending by `finalScore`  
2. Filter: `finalScore >= 0.48` (`SELECTION_CONFIG.minFinalScore`)  
3. Take top **5** (`SELECTION_CONFIG.topK`)

> Config note: some design docs mention a 0.25 floor; the **live** inject threshold in code is **`minFinalScore: 0.48`**.

**Actual TypeScript shape** (`RankedCandidate` / `SelectedCandidate`):

```json
{
  "memory": {
    "id": "ee5f2c5f-3a91-43f0-9144-cd016",
    "type": "AntiPattern",
    "conversationId": "b3acb5e2-4608-434b-be2e-437681",
    "messageId": "ee5f2c5f-3a91-43f0-9144-cd016",
    "statement": "Never use localStorage for JWT tokens...",
    "matchedRule": "vector-search"
  },
  "matchedTerms": [],
  "overlapRatio": 0.82,
  "matchStrength": 0.82,
  "breakdown": {
    "keywordScore": 0.82,
    "typeBonus": 0.9,
    "conversationBonus": 1.0,
    "finalScore": 0.773
  },
  "selectionRank": 1
}
```

(`keywordScore` ≈ K, `typeBonus` ≈ T, `conversationBonus` ≈ C.)

---

## 12. Enriched Prompt Shape

Shape of what Cursor AI actually receives after `enrichPrompt()` / `formatPromptContext()`.

### 12a. Intermediate `PromptEnrichment` object

```json
{
  "originalPrompt": "how should I store the JWT after login?",
  "formattedContext": "## Relevant project feedback\n\n1. [AntiPattern] Never use localStorage for JWT tokens...\n2. [Decision] Always validate with Zod...",
  "enrichedPrompt": "## Relevant project feedback\n\n1. [AntiPattern] Never use localStorage for JWT tokens...\n2. [Decision] Always validate with Zod...\n\n---\n\nhow should I store the JWT after login?",
  "injectedMemoryIds": [
    "ee5f2c5f-3a91-43f0-9144-cd016",
    "abc12345-1111-2222-3333-444444444444"
  ]
}
```

### 12b. Final string injected as `updated_input.prompt`

```text
## Relevant project feedback

1. [AntiPattern] Never use localStorage for JWT tokens...
2. [Decision] Always validate with Zod...

---

how should I store the JWT after login?
```

**Structure — what each part is for:**

| Part | Purpose |
|------|---------|
| `## Relevant project feedback` | Header — tells Cursor AI this block is **injected context**, not the developer’s question |
| `[Category]` | Helps Cursor AI understand **priority / type** (Correction, AntiPattern, Decision, TaskLearning) |
| Summary text | Standalone memory — **no prior chat context needed** to understand it |
| `---` separator | Clear **boundary** between injected context and the live prompt |
| Original prompt | Developer’s **actual question** at the bottom |

If **no** memories pass selection, `enrichedPrompt === originalPrompt` (no header, no separator).

Hook response wrapping this string:

```json
{
  "continue": true,
  "updated_input": {
    "prompt": "## Relevant project feedback\n\n1. [AntiPattern] Never use localStorage for JWT tokens...\n\n---\n\nhow should I store the JWT after login?"
  }
}
```

---

## 13. `ollama_metadata.log` Block

Human-readable analysis dump (not JSON). Written by `BatchWriteService` to `.cursor/hooks/ollama_metadata.log`:

```text
20/07/2026 23:08:39 IST ─────────────────────────────
convId:      b3acb5e2-4608-434b-be2e-437681
genId:       ee5f2c5f-3a91-43f0-9144-cd016
devText:     never use localStorage for JWT tokens — always use httpOnly cookies
category:    AntiPattern
summary:     The team must never store JWT tokens in localStorage...
technologies:["JWT","httpOnly cookies"]
topics:      ["Security","Authentication"]
confidence:  0.95

```

(`concepts` is stored in Chroma but **not** written to this log.)

---

## 14. PERF Log Shape

Shape written to `feedback-memory-hook.log` after every prompt (`HookPerformanceEntry` — one JSON line):

```json
{
  "type": "PERF",
  "phase": "hook",
  "intent": "WRITE",
  "intentMs": 55,
  "writeMs": 0,
  "readMs": 1324,
  "totalMs": 1440,
  "enriched": true,
  "writeStatus": "queued",
  "timestamp": "2026-07-09T05:10:40.583Z",
  "error": false
}
```

| Field | Description |
|-------|-------------|
| `type` | Always `"PERF"` — used for grep filtering |
| `phase` | `"hook"` for the main prompt path; `"write_background"` for async/batch write work |
| `intent` | Classification label on the hot path — commonly `WRITE` / `READ` / `BUFFERED` / `Unknown` (live hook often buffers as `BUFFERED`) |
| `intentMs` | Time spent on intent classification (ms); often `0` when classification is deferred to batch |
| `writeMs` | Time the WRITE path blocked the hook — **always `0` on the hot path** (fire-and-forget / buffered) |
| `readMs` | Time the READ pipeline took (ChromaDB search + rank + inject) |
| `totalMs` | End-to-end hook execution time |
| `enriched` | `true` if memories were found and injected into the prompt |
| `writeStatus` | `queued` \| `buffered` \| `completed` \| `not_applicable` \| `duplicate_skipped` \| `storage_failed` \| `write_failed` |
| `error` | `false` if the hook path succeeded |
| Optional | `stored`, `memoryId`, `reason`, `errorMessage` (esp. on `write_background`) |

Proven enriched example from logs: `readMs=1324`, `writeMs=0`, `totalMs=1440`, `enriched=true`.

---

## 15. Rule File Shape (`.mdc`)

Shape of a file written to `.cursor/rules/{topic}.mdc` by `RuleEvaluator`:

```markdown
---
description: "Never use localStorage for JWT token storage"
alwaysApply: true
globs: []
fme_score: 0.910
fme_created: "2026-07-20"
fme_last_updated: "2026-07-20"
fme_reinforcement_count: 0
fme_contradiction_count: 0
---

# Why this rule exists

JWT tokens stored in localStorage are vulnerable to XSS attacks.
Any JavaScript on the page can read localStorage, making tokens
easily stolen if the site has any XSS vulnerability.

# Rule

Never store JWT tokens or any authentication tokens in localStorage.
Always use httpOnly cookies which cannot be accessed by JavaScript.

# Checklist

- Do not use localStorage.setItem() for tokens
- Do not use sessionStorage for sensitive auth data
- Always set httpOnly: true on auth cookies
- Always set secure: true in production

# Related technologies

- JWT
- localStorage
- httpOnly cookies
- Authentication
```

**Frontmatter field shapes:**

| Field | Type | Meaning |
|-------|------|---------|
| `description` | string | One clear sentence — **Cursor reads this** |
| `alwaysApply` | boolean | `true` = every prompt; `false` = context / glob based |
| `globs` | string[] | File patterns (`[]` / omitted = no path filter) |
| `fme_score` | float `0.0–1.0` | Health score (decay floor **0.40**; delete below) |
| `fme_created` | ISO date string | Original creation — **never changes** |
| `fme_last_updated` | ISO date string | Changes on every evaluation (drives time decay) |
| `fme_reinforcement_count` | integer | CONFIRM + EXTEND count |
| `fme_contradiction_count` | integer | CONTRADICT count |

Activation heuristics: AntiPattern / Correction often `alwaysApply: true`; Decision often agent-requestable; TaskLearning may get tech→glob mapping.

---

## 16. Rule Evaluation Input Shape

Shape conceptually sent into `evaluateExistingRule()` (built as an Ollama **user** prompt when MiniLM cosine similarity to an existing `.mdc` is **> 0.70**):

```text
You are evaluating whether a new developer memory affects an existing Cursor rule.

Existing rule:
---
description: "Never use localStorage for JWT token storage"
alwaysApply: true
...
---

# Why this rule exists
...

Current rule score: 0.910

New memory:
Category: AntiPattern
Summary: Storing JWT tokens in localStorage is a security anti-pattern. Always use httpOnly cookies...
Confidence: 0.91

Does the new memory:
A) CONFIRM — agrees with rule, same direction, no new info
B) EXTEND — adds new detail, same direction
C) CONTRADICT — opposes or supersedes the rule
D) OBSOLETE — entire approach this rule covers no longer exists

Return ONLY valid JSON with no extra text:
{
  "judgment": "CONFIRM",
  "reasoning": "one sentence why",
  "updatedRuleContent": null
}
```

**Structured inputs Ollama is given:**

| Input | Source |
|-------|--------|
| Existing rule body + frontmatter | Matched `.mdc` file on disk |
| Current rule score | `fme_score` from frontmatter (after time decay) |
| New memory category / summary / confidence | `ExtractedMetadata` just stored |

**Ollama HTTP body:**

```json
{
  "model": "qwen2.5:3b",
  "stream": false,
  "messages": [
    {
      "role": "user",
      "content": "<prompt above>"
    }
  ]
}
```

---

## 17. Rule Evaluation Output Shape

Shape returned by Ollama after rule judgment:

**CONFIRM:**

```json
{
  "judgment": "CONFIRM",
  "reasoning": "New memory reinforces existing rule about not exposing internal errors to clients",
  "updatedRuleContent": null
}
```

**EXTEND:**

```json
{
  "judgment": "EXTEND",
  "reasoning": "New memory adds stack trace detail to existing error exposure rule",
  "updatedRuleContent": "Never expose internal errors, stack traces, or debugging information to API clients. Always return generic error messages with appropriate HTTP status codes."
}
```

**CONTRADICT:**

```json
{
  "judgment": "CONTRADICT",
  "reasoning": "Team decided to expose detailed errors in development mode",
  "updatedRuleContent": "Expose detailed errors in development, generic errors in production"
}
```

**OBSOLETE:**

```json
{
  "judgment": "OBSOLETE",
  "reasoning": "Team removed authentication entirely, JWT rules no longer apply",
  "updatedRuleContent": null
}
```

| Field | Meaning |
|-------|---------|
| `judgment` | `CONFIRM` \| `EXTEND` \| `CONTRADICT` \| `OBSOLETE` |
| `reasoning` | One-sentence explanation (for logs / debugging) |
| `updatedRuleContent` | New markdown body when EXTEND/CONTRADICT rewrites the rule; `null` when unchanged or OBSOLETE |

---

## 18. Updated Rule Score Shape

Shape after the score formula is applied and written back to `.mdc` frontmatter:

```typescript
{
  fme_score: 0.935,                 // calculated from judgment
  fme_last_updated: "2026-07-20",   // set to today on every evaluation
  fme_reinforcement_count: 3,       // incremented on CONFIRM / EXTEND
  fme_contradiction_count: 0,       // incremented on CONTRADICT
}
```

**Score formulas:**

| Judgment | Formula |
|----------|---------|
| CONFIRM | `newScore = Math.min(1.0, score + confidence × 0.05)` |
| EXTEND | `newScore = Math.min(1.0, score + confidence × 0.08)` |
| CONTRADICT | `newScore = score - confidence × 0.30` |
| OBSOLETE | `newScore = 0` → delete file |

**Delete condition:**

```typescript
judgment === "OBSOLETE" || newScore < 0.40
```

`fme_created` is **never** changed by evaluation. Time decay may lower `fme_score` before judgment (`max(0.40, score − months×0.01)` after 30 days idle), but decay alone cannot delete a rule — only CONTRADICT/OBSOLETE (or the resulting score) can.

---

## 19. Skill File Shape (`*-skill.mdc`)

Shape of a skill file written to `.cursor/rules/*-skill.mdc` (24h `CronService` and/or TaskLearning promotion):

```markdown
---
description: "Step-by-step workflow for adding a new API endpoint"
alwaysApply: false
globs: ["src/routes/**/*.ts", "src/controllers/**/*.ts"]
fme_score: 0.880
fme_created: "2026-07-20"
fme_last_updated: "2026-07-20"
fme_reinforcement_count: 0
fme_contradiction_count: 0
---

# API Endpoint Creation Workflow

When adding a new API endpoint always follow this order:

1. Create Zod schema for request body validation
2. Create controller function with try/catch
3. Create route file and import controller
4. Register route in app.ts
5. Add to API documentation

# Technologies

- Express.js
- Zod
- TypeScript
```

**Upstream Ollama extraction JSON** (Cron):

```json
{
  "hasSkill": true,
  "title": "API Endpoint Creation Workflow",
  "steps": [
    "Create Zod schema for request body validation",
    "Create controller function with try/catch",
    "Create route file and import controller",
    "Register route in app.ts",
    "Add to API documentation"
  ],
  "technologies": ["Express.js", "Zod", "TypeScript"],
  "confidence": 0.88
}
```

Promote when `hasSkill && confidence >= 0.70`.

**Key differences from rule files:**

| Aspect | Rule | Skill |
|--------|------|-------|
| Filename | `{topic}.mdc` | ends with `-skill.mdc` |
| `alwaysApply` | often `true` for AntiPattern/Correction | **always `false`** (procedural) |
| `globs` | may be empty / global-ish | from `technologies[]` (scoped, not global) |
| Content | permanent constraint (WHY / WHAT / Checklist) | **step-by-step workflow** |

Negative extraction case:

```json
{
  "hasSkill": false,
  "title": "",
  "steps": [],
  "technologies": [],
  "confidence": 0
}
```

---

## 20. End-to-End Shape Map

```
Cursor { conversation_id, generation_id, prompt }
  → BufferEntry { conversationId, generationId, developerText, aiResponse, batchProcessed }
  → ClassifiedEntry { + bartLabel, confidence, category }
  → Ollama GroupStatementMetadata[] { summary, technologies, topics, confidence }
  → ExtractedMetadata { category, summary, technologies, topics, concepts, confidence }
  → VectorMemoryRecord { id=generationId, vector, metadata }
  → VectorSearchHit → RankedCandidate → PromptEnrichment
  → PERF JSON + ollama_metadata.log
  → RuleEvaluator judgment → updated fme_* score / .mdc
  → CronService → *-skill.mdc
```

---

## Source References

| Shape | Primary code |
|-------|----------------|
| Hook I/O | `.cursor/hooks/capture-feedback.sh`, `src/demo/processPrompt.ts` |
| Buffer | `src/services/batch/BufferManager.ts` |
| BART 5-way | `src/services/batch/BatchWriteService.ts` |
| Ollama group extract | `BatchWriteService.buildGroupExtractionPrompt` |
| Metadata contract | `src/contracts/extraction/MetadataExtractionProvider.ts` |
| Chroma upsert / search | `src/contracts/vector-store/VectorStoreProvider.ts`, `ChromaDbVectorStoreProvider.ts` |
| Ranking / selection | `src/config/ranking.config.ts`, `selection.config.ts` |
| Enrichment | `src/retrieval/enrichment/` |
| PERF | `src/integration/cursor/hookLogger.ts` |
| Rules / skills | `src/services/evaluation/RuleEvaluator.ts`, `CronService.ts` |

---

*Related: [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md) · [CONFIGURABILITY.md](./CONFIGURABILITY.md)*
