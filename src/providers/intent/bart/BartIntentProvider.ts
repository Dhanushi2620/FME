/**
 * BART-MNLI Intent Detection Provider
 *
 * Provider boundary
 * -----------------
 * This module is the only layer that knows about BART-MNLI, HuggingFace model IDs,
 * and the remote zero-shot inference HTTP API. It implements {@link IntentDetectionProvider}
 * and maps inference scores to pipeline intents: WRITE, READ, or ANSWER_ONLY.
 *
 * It does NOT perform routing, metadata extraction, validation, storage, or hook logic.
 *
 * Model loading
 * -------------
 * The BART model is not loaded inside this process. A separate inference service
 * (configured via `model.serviceUrl` and `model.modelId` in intent configuration)
 * owns model loading, GPU/CPU execution, and tokenizer lifecycle. This provider
 * is a thin HTTP client that sends classification requests and normalizes responses.
 *
 * Configuration
 * -------------
 * All runtime values are injected via {@link IntentDetectionConfig}. Nothing is
 * hardcoded — provider id, model id, service URL, timeout, and candidate labels
 * are read from configuration at construction time.
 */

import {
  DetectedIntent,
  IntentDetectionInput,
  IntentDetectionProvider,
  IntentDetectionResult,
} from "../../../contracts/intent";
import {
  BartMnliIntentProviderOptions,
  IntentClassificationLabel,
  IntentDetectionConfig,
} from "../../../config/intent.config";
import { createLogger } from "../../../logging";

const logger = createLogger("BartIntentProvider");

/** Zero-shot label score returned by the BART inference service. */
export type BartLabelScore = {
  label: IntentClassificationLabel;
  score: number;
};

/** Request payload sent to the BART inference service. */
export type BartZeroShotRequest = {
  text: string;
  modelId: string;
  candidateLabels: readonly IntentClassificationLabel[];
  multiLabel: boolean;
  serviceUrl: string;
  timeoutMs: number;
};

/**
 * Abstraction over the BART inference backend.
 * Enables injection of mock clients in tests without importing HTTP details.
 */
export interface BartInferenceClient {
  classifyZeroShot(request: BartZeroShotRequest): Promise<BartLabelScore[]>;
}

const CLASSIFY_PATH = "/v1/intent/classify";
const HEALTH_PATH = "/health";

const UNKNOWN_RESULT: IntentDetectionResult = {
  intent: "Unknown",
  confidence: 0,
  statement: "",
};

const isIntentClassificationLabel = (
  value: string
): value is IntentClassificationLabel => {
  return value === "WRITE" || value === "READ" || value === "ANSWER_ONLY";
};

const normalizeText = (text: string): string => {
  return text.trim().replace(/\s+/g, " ");
};

const clampConfidence = (score: number): number => {
  if (!Number.isFinite(score)) {
    return 0;
  }

  if (score < 0) {
    return 0;
  }

  if (score > 1) {
    return 1;
  }

  return score;
};

const pickTopLabel = (scores: BartLabelScore[]): BartLabelScore | null => {
  if (scores.length === 0) {
    return null;
  }

  return scores.reduce((best, current) =>
    current.score > best.score ? current : best
  );
};

/**
 * Default HTTP client for a BART-MNLI inference sidecar.
 * Provider-specific — never imported by business logic or services.
 */
export class HttpBartInferenceClient implements BartInferenceClient {
  async classifyZeroShot(request: BartZeroShotRequest): Promise<BartLabelScore[]> {
    const url = `${request.serviceUrl.replace(/\/$/, "")}${CLASSIFY_PATH}`;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (request.timeoutMs > 0) {
      timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: request.text,
          model_id: request.modelId,
          candidate_labels: request.candidateLabels,
          multi_label: request.multiLabel,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `BART inference request failed with status ${response.status}`
        );
      }

      const payload = (await response.json()) as {
        labels?: Array<{ label?: string; score?: number }>;
      };

      if (!payload.labels || !Array.isArray(payload.labels)) {
        throw new Error("BART inference response missing labels array");
      }

      const scores: BartLabelScore[] = [];

      for (const entry of payload.labels) {
        if (
          typeof entry.label !== "string" ||
          typeof entry.score !== "number" ||
          !isIntentClassificationLabel(entry.label)
        ) {
          continue;
        }

        scores.push({
          label: entry.label,
          score: entry.score,
        });
      }

      return scores;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

/**
 * BART-MNLI implementation of {@link IntentDetectionProvider}.
 *
 * Classifies developer prompts into WRITE, READ, or ANSWER_ONLY by delegating
 * zero-shot inference to a configured remote service.
 */
export class BartIntentProvider implements IntentDetectionProvider {
  readonly providerId: string;

  private readonly options: BartMnliIntentProviderOptions;

  constructor(
    config: IntentDetectionConfig,
    private readonly inferenceClient: BartInferenceClient = new HttpBartInferenceClient()
  ) {
    this.providerId = config.provider.id;
    this.options = config.provider.options as BartMnliIntentProviderOptions;
  }

  /**
   * Classifies the input prompt via BART zero-shot inference.
   * Returns the highest-scoring configured candidate label and normalized confidence.
   */
  async detectIntent(input: IntentDetectionInput): Promise<IntentDetectionResult> {
    const text = normalizeText(input.text);

    if (!text) {
      return UNKNOWN_RESULT;
    }

    const candidateLabels = this.options.candidateLabels;

    if (!candidateLabels || candidateLabels.length === 0) {
      return UNKNOWN_RESULT;
    }

    const modelConfig = this.options.model ?? {};

    if (!modelConfig.modelId || !modelConfig.serviceUrl) {
      return UNKNOWN_RESULT;
    }

    try {
      const scores = await this.inferenceClient.classifyZeroShot({
        text,
        modelId: modelConfig.modelId,
        candidateLabels,
        multiLabel: this.options.multiLabel ?? false,
        serviceUrl: modelConfig.serviceUrl,
        timeoutMs: modelConfig.timeoutMs ?? 0,
      });

      const topLabel = pickTopLabel(scores);

      if (!topLabel) {
        return UNKNOWN_RESULT;
      }

      return {
        intent: topLabel.label as DetectedIntent,
        confidence: clampConfidence(topLabel.score),
        statement: "",
        detectedLabel: topLabel.label,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isServiceDown =
        error instanceof TypeError ||
        (error instanceof Error &&
          (error.name === "AbortError" ||
            message.includes("fetch failed") ||
            message.includes("BART inference request failed")));

      if (isServiceDown) {
        logger.warn(
          "BART intent service (:8001) is down or unreachable — intent=Unknown, WRITE path skipped. This is not ambiguous classification; start sidecars with fme/feedback-memory-inference/run_all.sh",
          { error: message }
        );
      } else {
        logger.warn(
          "Intent classification returned no usable result — treating as Unknown (genuine ambiguous/low-confidence outcome)",
          { error: message }
        );
      }

      return UNKNOWN_RESULT;
    }
  }

  /**
   * Probes the configured inference service liveness endpoint.
   */
  async healthCheck(): Promise<boolean> {
    const serviceUrl = this.options.model?.serviceUrl;

    if (!serviceUrl) {
      return false;
    }

    const url = `${serviceUrl.replace(/\/$/, "")}${HEALTH_PATH}`;
    const timeoutMs = this.options.model?.timeoutMs ?? 0;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs > 0) {
      timeout = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
