/**
 * Intent Provider Factory
 *
 * Single composition point that maps configured provider identifiers to concrete
 * {@link IntentDetectionProvider} implementations. This is the ONLY module in the
 * application that may import provider classes from `providers/intent/`.
 *
 * Callers receive the {@link IntentDetectionProvider} interface — never a concrete class.
 */

import { IntentDetectionProvider } from "../contracts/intent";
import {
  INTENT_CONFIG,
  IntentDetectionConfig,
  IntentDetectionProviderId,
} from "../config/intent.config";
import { BartIntentProvider } from "../providers/intent/bart";

/** Thrown when configuration references an unregistered intent provider id. */
export class UnknownIntentProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`Unknown intent detection provider: ${providerId}`);
    this.name = "UnknownIntentProviderError";
    this.providerId = providerId;
  }
}

type IntentProviderFactoryFn = (
  config: IntentDetectionConfig
) => IntentDetectionProvider;

/**
 * Registry of intent provider constructors keyed by configuration id.
 *
 * To add a new provider:
 * 1. Implement {@link IntentDetectionProvider} under `providers/intent/<name>/`.
 * 2. Add one entry here mapping the config id to `new Provider(config)`.
 * 3. No changes required in services, hooks, pipelines, or MCP tools.
 */
const INTENT_PROVIDER_REGISTRY: Partial<
  Record<IntentDetectionProviderId, IntentProviderFactoryFn>
> = {
  "bart-mnli": (config) => new BartIntentProvider(config),
};

/**
 * Constructs the configured {@link IntentDetectionProvider}.
 *
 * Reads `config.provider.id` to select the implementation. Defaults to
 * {@link INTENT_CONFIG} when no configuration is supplied.
 */
export const createIntentDetectionProvider = (
  config: IntentDetectionConfig = INTENT_CONFIG
): IntentDetectionProvider => {
  const providerId = config.provider.id;
  const factory = INTENT_PROVIDER_REGISTRY[providerId];

  if (!factory) {
    throw new UnknownIntentProviderError(providerId);
  }

  return factory(config);
};

/**
 * Registers an intent provider factory at runtime.
 *
 * Intended for custom or experimental providers without modifying the static registry.
 */
export const registerIntentDetectionProvider = (
  providerId: IntentDetectionProviderId,
  factory: IntentProviderFactoryFn
): void => {
  INTENT_PROVIDER_REGISTRY[providerId] = factory;
};
