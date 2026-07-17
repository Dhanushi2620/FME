/**
 * Promotes high-confidence developer memories into Cursor rule (.mdc) files.
 * Runs fire-and-forget after successful WRITE persistence.
 */

import * as fs from "fs";
import * as path from "path";
import { ExtractedMetadata } from "../../contracts/extraction";
import { EMBEDDING_CONFIG } from "../../config/embedding.config";
import { METADATA_CONFIG } from "../../config/metadata.config";
import { createLogger } from "../../logging";

const logger = createLogger("RuleEvaluator");

const METADATA_EXTRACT_PATH = "/v1/metadata/extract";
const EMBEDDING_PATH = "/v1/embeddings/embed";
const RULE_SIMILARITY_THRESHOLD = 0.7;
const RULE_PROMOTION_CONFIDENCE = 0.85;
const IMMEDIATE_RULE_PROMOTION_CONFIDENCE = 0.95;
const SKILL_PROMOTION_CONFIDENCE = 0.85;
const METADATA_TIMEOUT_MS = 25_000;
const EMBEDDING_TIMEOUT_MS = 5_000;

const OLLAMA_URL = (
  process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434"
).replace(/\/$/, "");
const OLLAMA_MODEL =
  process.env.METADATA_MODEL?.trim() || "qwen2.5:3b";

type MetadataSidecarResponse = {
  summary?: string;
};

type EmbeddingSidecarResponse = {
  embedding?: number[];
};

/** Optional developer/AI turn context used to enrich rule wording. */
export type RuleEvaluationContext = {
  developerText?: string;
  aiResponse?: string;
};

const getRulesDirectory = (): string => {
  // Hook runner (capture-feedback.sh) cds to FME_ROOT before invoking node.
  return path.join(process.cwd(), ".cursor", "rules");
};

const ensureRulesDirectory = (): void => {
  fs.mkdirSync(getRulesDirectory(), { recursive: true });
};

const topicToFilename = (memory: ExtractedMetadata): string => {
  // Try topics first
  const rawTopic =
    memory.topics[0]?.trim() ||
    // Then try technologies
    memory.technologies?.[0]?.trim() ||
    // Then derive from category
    (memory.category === "Decision"
      ? "decisions"
      : memory.category === "AntiPattern"
        ? "anti-patterns"
        : memory.category === "TaskLearning"
          ? "workflows"
          : memory.category === "Correction"
            ? "corrections"
            : "general");

  const normalized = rawTopic
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  return normalized.length > 0 ? normalized : "general";
};

const getMetadataServiceUrl = (): string => {
  const providerOptions = METADATA_CONFIG.provider.options as {
    inference?: { serviceUrl?: string };
  };

  return providerOptions.inference?.serviceUrl ?? "http://127.0.0.1:8002";
};

const getEmbeddingServiceUrl = (): string => {
  const providerOptions = EMBEDDING_CONFIG.provider.options as {
    inference?: { serviceUrl?: string; modelId?: string };
  };

  return providerOptions.inference?.serviceUrl ?? "http://127.0.0.1:8003";
};

const getEmbeddingModelId = (): string => {
  const providerOptions = EMBEDDING_CONFIG.provider.options as {
    inference?: { modelId?: string };
  };

  return (
    providerOptions.inference?.modelId ??
    "sentence-transformers/all-MiniLM-L6-v2"
  );
};

const formatList = (values: string[]): string => {
  if (values.length === 0) {
    return "(none)";
  }
  return values.join(", ");
};

export const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
  if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let index = 0; index < vecA.length; index += 1) {
    const a = vecA[index];
    const b = vecB[index];
    dotProduct += a * b;
    magnitudeA += a * a;
    magnitudeB += b * b;
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
};

interface RuleScore {
  fme_score: number;
  fme_created: string;
  fme_last_updated: string;
  fme_reinforcement_count: number;
  fme_contradiction_count: number;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  match[1].split("\n").forEach((line) => {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) result[key.trim()] = rest.join(":").trim();
  });
  return result;
}

function buildFrontmatter(
  description: string,
  alwaysApply: boolean,
  globs: string[],
  score: RuleScore
): string {
  const globLine =
    globs.length > 0
      ? `globs: [${globs.map((g) => `"${g}"`).join(", ")}]\n`
      : "";
  return `---
description: "${description}"
alwaysApply: ${alwaysApply}
${globLine}fme_score: ${score.fme_score.toFixed(3)}
fme_created: "${score.fme_created}"
fme_last_updated: "${score.fme_last_updated}"
fme_reinforcement_count: ${score.fme_reinforcement_count}
fme_contradiction_count: ${score.fme_contradiction_count}
---\n\n`;
}

function getActivationMode(
  category: string,
  technologies: string[]
): { alwaysApply: boolean; globs: string[] } {
  if (category === "AntiPattern" || category === "Correction") {
    return { alwaysApply: true, globs: [] };
  }
  if (category === "Decision") {
    return { alwaysApply: false, globs: [] };
  }
  const techToGlob: Record<string, string[]> = {
    TypeScript: ["src/**/*.ts", "src/**/*.tsx"],
    JavaScript: ["src/**/*.js", "src/**/*.jsx"],
    Express: ["src/routes/**/*.ts", "src/controllers/**/*.ts"],
    React: ["src/components/**/*.tsx", "src/pages/**/*.tsx"],
    Redis: ["src/services/**/*.ts", "src/events/**/*.ts"],
    Zod: ["src/**/*.ts"],
    Prisma: ["prisma/**/*.prisma", "src/**/*prisma*.ts"],
    PostgreSQL: ["src/**/*.ts", "prisma/**/*.prisma"],
  };
  const globs = [
    ...new Set(technologies.flatMap((t) => techToGlob[t] || [])),
  ];
  return { alwaysApply: false, globs };
}

function applyTimeDecay(score: RuleScore): RuleScore {
  const lastUpdated = new Date(score.fme_last_updated);
  const now = new Date();
  const daysSince =
    (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 30) return score;
  const monthsDecay = (daysSince - 30) / 30;
  const newScore = Math.max(0.4, score.fme_score - monthsDecay * 0.01);
  return { ...score, fme_score: newScore };
}

export class RuleEvaluator {
  async evaluate(
    memory: ExtractedMetadata,
    context: RuleEvaluationContext = {}
  ): Promise<void> {
    logger.debug("ENTRY POINT HIT", {
      cwd: process.cwd(),
      rulesDir: path.join(process.cwd(), ".cursor", "rules"),
      category: memory.category,
      confidence: memory.confidence,
    });

    try {
      logger.debug("evaluate called", {
        category: memory.category,
        confidence: memory.confidence,
        summary: memory.summary,
        topics: memory.topics,
      });

      ensureRulesDirectory();

      if (this.shouldCreateOrUpdateRule(memory)) {
        await this.createOrUpdateRule(memory, context);
      }

      if (this.shouldCreateOrUpdateSkill(memory)) {
        await this.createOrUpdateSkill(memory);
      }

      if (memory.category === "Correction") {
        await this.checkForRuleFailure(memory, context);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Rule evaluation failed";
      logger.error("failed", { error: message });
    }
  }

  private shouldCreateOrUpdateRule(memory: ExtractedMetadata): boolean {
    const willPromote =
      memory.confidence >= IMMEDIATE_RULE_PROMOTION_CONFIDENCE ||
      ((memory.category === "AntiPattern" || memory.category === "Decision") &&
        memory.confidence >= RULE_PROMOTION_CONFIDENCE);

    logger.debug("shouldCreateOrUpdateRule check", {
      confidence: memory.confidence,
      category: memory.category,
      immediateThreshold: IMMEDIATE_RULE_PROMOTION_CONFIDENCE,
      ruleThreshold: RULE_PROMOTION_CONFIDENCE,
      willPromote: memory.confidence >= IMMEDIATE_RULE_PROMOTION_CONFIDENCE,
    });

    return willPromote;
  }

  private shouldCreateOrUpdateSkill(memory: ExtractedMetadata): boolean {
    return (
      memory.category === "TaskLearning" &&
      memory.confidence >= SKILL_PROMOTION_CONFIDENCE
    );
  }

  private buildRuleGenerationPrompt(
    memory: ExtractedMetadata,
    context: RuleEvaluationContext
  ): string {
    return `You are creating a Cursor AI rule (.mdc) for a software project.
Your output must be strictly grounded in the source material below.
You may only state facts, constraints, and examples that appear in that material.

SOURCE MATERIAL (use only this — do not go beyond it):
Category: ${memory.category}
Summary: ${memory.summary}
Technologies: ${formatList(memory.technologies || [])}
Topics: ${formatList(memory.topics || [])}
Developer message:
${context.developerText?.trim() || "(not provided)"}
AI response:
${context.aiResponse?.trim() || "(not provided)"}

GROUNDING RULES (mandatory):
- Do not speculate. Do not add new technical details. Do not infer hidden requirements.
- Never invent APIs, libraries, implementation patterns, performance optimizations,
  best practices, or database features unless they explicitly appear in the source material.
- Do not expand a topic into unrelated subtopics (e.g. if the memory says "use PostgreSQL
  instead of MongoDB", do not add guidance about SQL cursors, connection pooling, or ORM patterns
  unless those were explicitly discussed).
- Prefer omission over hallucination. If a section has no supported content, omit that section entirely.
- Use the same terms as the source material. Do not reinterpret words (e.g. "Cursor" the IDE
  must not become "database cursors").

OUTPUT FORMAT (markdown, Cursor /create-rule style):
Use only the sections below that you can fill from the source material. Omit empty sections.

# Why this rule exists

Short explanation based ONLY on the memory and conversation above.

# Rule

Concrete constraint stated in plain language. No invented implementation steps.

# Examples

Include ONLY if explicit examples appear in the source material. Otherwise omit this section.

# Checklist

- Actionable items derived ONLY from the Rule section and source material.
- Omit this section if you cannot list at least one grounded item.

# Related technologies

List only technologies explicitly present in the source material. Omit if none.

Return only the markdown rule body. No JSON, no YAML frontmatter, no preamble or closing commentary.`;
  }

  private buildImproveRulePrompt(
    currentRule: string,
    memory: ExtractedMetadata,
    context: RuleEvaluationContext
  ): string {
    return `You are updating an existing Cursor AI rule (.mdc) with new conversation context.
Your output must remain strictly grounded in the existing rule and the new source material below.
Do not add technical detail that is not supported by either source.

EXISTING RULE:
${currentRule}

NEW SOURCE MATERIAL (use only this — do not go beyond it):
Category: ${memory.category}
Summary: ${memory.summary}
Technologies: ${formatList(memory.technologies || [])}
Topics: ${formatList(memory.topics || [])}
Developer message:
${context.developerText?.trim() || "(not provided)"}
AI response:
${context.aiResponse?.trim() || "(not provided)"}

GROUNDING RULES (mandatory):
- Preserve grounded content from the existing rule that is still valid.
- Incorporate only new facts from the new source material. Do not speculate or infer.
- Never invent APIs, libraries, implementation patterns, performance optimizations,
  best practices, or database features unless they explicitly appear in the existing rule
  or new source material.
- Do not make the rule longer by adding generic best practices or unrelated guidance.
- Prefer omission over hallucination. If a section has no supported content, omit that section.
- Use the same terms as the source material. Do not reinterpret words.

OUTPUT FORMAT (markdown, Cursor /create-rule style):
Use only the sections below that you can fill from the merged sources. Omit empty sections.

# Why this rule exists

Short explanation combining ONLY supported context from the existing rule and new source material.

# Rule

Updated concrete constraint. No invented implementation steps.

# Examples

Include ONLY if explicit examples appear in the existing rule or new source material.
Otherwise omit this section.

# Checklist

- Actionable items derived ONLY from the Rule section and supported sources.
- Omit this section if you cannot list at least one grounded item.

# Related technologies

List only technologies explicitly present in the existing rule or new source material.
Omit if none.

Return only the updated markdown rule body. No JSON, no YAML frontmatter, no preamble or closing commentary.`;
  }

  private async evaluateExistingRule(
    ruleContent: string,
    ruleScore: RuleScore,
    metadata: ExtractedMetadata
  ): Promise<{
    judgment: "CONFIRM" | "EXTEND" | "CONTRADICT" | "OBSOLETE";
    updatedContent: string | null;
    newScore: number;
    shouldDelete: boolean;
    updatedRuleScore: RuleScore;
  }> {
    const prompt = `You are evaluating whether a new developer memory affects an existing Cursor rule.

Existing rule:
${ruleContent}

Current rule score: ${ruleScore.fme_score}

New memory:
Category: ${metadata.category}
Summary: ${metadata.summary}
Confidence: ${metadata.confidence}

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
}`;

    try {
      const response = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen2.5:3b",
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });
      const data = (await response.json()) as {
        message?: { content?: string };
      };
      const text = data.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const result = JSON.parse(jsonMatch?.[0] || "{}") as {
        judgment?: string;
        updatedRuleContent?: string | null;
      };
      const judgment = result.judgment as
        | "CONFIRM"
        | "EXTEND"
        | "CONTRADICT"
        | "OBSOLETE";
      const updatedContent = result.updatedRuleContent || null;

      let newScore = ruleScore.fme_score;
      const updatedRuleScore = { ...ruleScore };
      const today = new Date().toISOString().split("T")[0];
      updatedRuleScore.fme_last_updated = today;

      if (judgment === "CONFIRM") {
        newScore = Math.min(
          1.0,
          ruleScore.fme_score + metadata.confidence * 0.05
        );
        updatedRuleScore.fme_reinforcement_count++;
      } else if (judgment === "EXTEND") {
        newScore = Math.min(
          1.0,
          ruleScore.fme_score + metadata.confidence * 0.08
        );
        updatedRuleScore.fme_reinforcement_count++;
      } else if (judgment === "CONTRADICT") {
        newScore = ruleScore.fme_score - metadata.confidence * 0.3;
        updatedRuleScore.fme_contradiction_count++;
      } else if (judgment === "OBSOLETE") {
        newScore = 0;
      }

      updatedRuleScore.fme_score = parseFloat(newScore.toFixed(3));

      const shouldDelete = judgment === "OBSOLETE" || newScore < 0.4;

      return {
        judgment,
        updatedContent,
        newScore,
        shouldDelete,
        updatedRuleScore,
      };
    } catch (err) {
      logger.debug("[RuleEvaluator] evaluateExistingRule error", { err });
      return {
        judgment: "CONFIRM",
        updatedContent: null,
        newScore: ruleScore.fme_score,
        shouldDelete: false,
        updatedRuleScore: ruleScore,
      };
    }
  }

  private async createOrUpdateRule(
    memory: ExtractedMetadata,
    context: RuleEvaluationContext
  ): Promise<void> {
    logger.debug("createOrUpdateRule called", {
      topic: topicToFilename(memory),
      rulesDir: getRulesDirectory(),
    });

    const topic = topicToFilename(memory);
    const filePath = path.join(getRulesDirectory(), `${topic}.mdc`);

    if (!fs.existsSync(filePath)) {
      const ruleSentence = await this.generateRuleTextViaOllama(
        this.buildRuleGenerationPrompt(memory, context)
      );

      logger.debug("generated rule sentence", { ruleSentence });

      if (!ruleSentence) {
        return;
      }

      const activation = getActivationMode(
        memory.category,
        memory.technologies || []
      );

      const score: RuleScore = {
        fme_score: parseFloat((memory.confidence || 0.85).toFixed(3)),
        fme_created: new Date().toISOString().split("T")[0],
        fme_last_updated: new Date().toISOString().split("T")[0],
        fme_reinforcement_count: 0,
        fme_contradiction_count: 0,
      };

      const frontmatter = buildFrontmatter(
        memory.summary || topic,
        activation.alwaysApply,
        activation.globs,
        score
      );

      fs.writeFileSync(filePath, frontmatter + ruleSentence);

      logger.debug("[RuleEvaluator] created rule", {
        topic,
        score: score.fme_score,
        alwaysApply: activation.alwaysApply,
      });
      return;
    }

    const existingContent = fs.readFileSync(filePath, "utf-8");

    const parsed = parseFrontmatter(existingContent);
    let ruleScore: RuleScore = {
      fme_score: parseFloat(parsed.fme_score || "0.85"),
      fme_created:
        parsed.fme_created || new Date().toISOString().split("T")[0],
      fme_last_updated:
        parsed.fme_last_updated || new Date().toISOString().split("T")[0],
      fme_reinforcement_count: parseInt(
        parsed.fme_reinforcement_count || "0",
        10
      ),
      fme_contradiction_count: parseInt(
        parsed.fme_contradiction_count || "0",
        10
      ),
    };

    ruleScore = applyTimeDecay(ruleScore);

    const bodyMatch = existingContent.match(/^---[\s\S]*?---\n\n?([\s\S]*)/);
    const existingBody = bodyMatch?.[1] || existingContent;

    const evaluation = await this.evaluateExistingRule(
      existingBody,
      ruleScore,
      memory
    );

    if (evaluation.shouldDelete) {
      fs.unlinkSync(filePath);
      logger.debug("[RuleEvaluator] deleted rule", {
        topic,
        judgment: evaluation.judgment,
        score: evaluation.newScore,
      });
      return;
    }

    const newBody = evaluation.updatedContent || existingBody;

    const alwaysApply = parsed.alwaysApply === "true";
    const existingGlobs = parsed.globs
      ? parsed.globs
          .replace(/[\[\]"]/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const description = (parsed.description || memory.summary || topic).replace(
      /^"|"$/g,
      ""
    );
    const frontmatter = buildFrontmatter(
      description,
      alwaysApply,
      existingGlobs,
      evaluation.updatedRuleScore
    );
    fs.writeFileSync(filePath, frontmatter + newBody);

    logger.debug("[RuleEvaluator] evaluated rule", {
      topic,
      judgment: evaluation.judgment,
      oldScore: ruleScore.fme_score,
      newScore: evaluation.newScore,
    });
  }

  private async createOrUpdateSkill(memory: ExtractedMetadata): Promise<void> {
    const topic = topicToFilename(memory);
    const filePath = path.join(getRulesDirectory(), `${topic}-skill.mdc`);
    const skillSentence = await this.generateTextViaMetadataSidecar(
      `Convert to Cursor skill: ${memory.summary}`
    );

    if (!skillSentence) {
      return;
    }

    if (fs.existsSync(filePath)) {
      fs.appendFileSync(filePath, `\n${skillSentence}\n`, "utf8");
      return;
    }

    const content = `---\ndescription: ${topic} skill\n---\n\n${skillSentence}\n`;
    fs.writeFileSync(filePath, content, "utf8");
  }

  private async checkForRuleFailure(
    memory: ExtractedMetadata,
    context: RuleEvaluationContext
  ): Promise<void> {
    const rulesDirectory = getRulesDirectory();

    if (!fs.existsSync(rulesDirectory)) {
      return;
    }

    const correctionEmbedding = await this.embedText(
      memory.summary,
      "query"
    );

    if (!correctionEmbedding) {
      return;
    }

    const ruleFiles = fs
      .readdirSync(rulesDirectory)
      .filter((filename) => filename.endsWith(".mdc"));

    for (const filename of ruleFiles) {
      const filePath = path.join(rulesDirectory, filename);
      const ruleContent = fs.readFileSync(filePath, "utf8");
      const ruleEmbedding = await this.embedText(ruleContent, "document");

      if (!ruleEmbedding) {
        continue;
      }

      const similarity = cosineSimilarity(correctionEmbedding, ruleEmbedding);

      if (similarity > RULE_SIMILARITY_THRESHOLD) {
        logger.warn("rule file is insufficient", {
          filename,
          similarity: similarity.toFixed(2),
        });
        await this.improveRule(filename, ruleContent, memory, context);
        break;
      }
    }
  }

  private async improveRule(
    filename: string,
    currentRule: string,
    memory: ExtractedMetadata,
    context: RuleEvaluationContext
  ): Promise<void> {
    const improvedContent = await this.generateRuleTextViaOllama(
      this.buildImproveRulePrompt(currentRule, memory, context)
    );

    if (!improvedContent) {
      return;
    }

    const filePath = path.join(getRulesDirectory(), filename);
    fs.writeFileSync(filePath, `${improvedContent}\n`, "utf8");
  }

  /**
   * Free-form Ollama generation for descriptive Cursor rule text.
   * Unlike the metadata sidecar, this returns the raw model text (not a summary field).
   */
  private async generateRuleTextViaOllama(
    prompt: string
  ): Promise<string | null> {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You write Cursor engineering rules (.mdc) in a structured markdown format. Rules must be strictly grounded in the user-provided source material only. Never invent APIs, libraries, patterns, optimizations, best practices, or database features not explicitly present in the source material. Do not speculate or infer hidden requirements. Prefer omitting a section over guessing. If information is missing, leave that section out. Use these sections only when supported by the source: # Why this rule exists, # Rule, # Examples (optional), # Checklist, # Related technologies. Return only the markdown rule body. No YAML frontmatter, no JSON, no code fences around the whole output, and no preamble or closing commentary.",
            },
            { role: "user", content: prompt },
          ],
          stream: false,
          options: { temperature: 0.2, num_ctx: 4096 },
        }),
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        message?: { content?: string };
      };
      const content = payload.message?.content?.trim();

      if (!content || content.length === 0) {
        return null;
      }

      return content;
    } catch {
      return null;
    }
  }

  private async generateTextViaMetadataSidecar(
    text: string
  ): Promise<string | null> {
    const serviceUrl = getMetadataServiceUrl().replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);

    try {
      const response = await fetch(`${serviceUrl}${METADATA_EXTRACT_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as MetadataSidecarResponse;
      const summary = payload.summary?.trim();

      return summary && summary.length > 0 ? summary : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async embedText(
    text: string,
    purpose: "query" | "document"
  ): Promise<number[] | null> {
    const serviceUrl = getEmbeddingServiceUrl().replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

    try {
      const response = await fetch(`${serviceUrl}${EMBEDDING_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          purpose,
          model_id: getEmbeddingModelId(),
          normalize: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as EmbeddingSidecarResponse;

      if (!Array.isArray(payload.embedding) || payload.embedding.length === 0) {
        return null;
      }

      return payload.embedding;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
