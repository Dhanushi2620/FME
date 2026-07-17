import {
  EnrichPromptInput,
  EnrichPromptOptions,
  PromptEnrichment,
} from "../../types/enrichment.types";
import { buildPromptContext } from "./buildPromptContext";
import { formatPromptContext } from "./formatPromptContext";

const DEFAULT_CONTEXT_SEPARATOR = "---";

export const enrichPrompt = (
  input: EnrichPromptInput,
  options: EnrichPromptOptions = {}
): PromptEnrichment => {
  const originalPrompt = input.prompt.trim();
  const context = buildPromptContext({
    selectedCandidates: input.selectedCandidates,
  });
  const formattedContext = formatPromptContext(context);
  const contextSeparator = options.contextSeparator ?? DEFAULT_CONTEXT_SEPARATOR;
  const injectedMemoryIds = [...context.orderedMemoryIds];

  const enrichedPrompt =
    formattedContext.length > 0
      ? `${formattedContext}\n\n${contextSeparator}\n\n${originalPrompt}`
      : originalPrompt;

  return {
    originalPrompt,
    formattedContext,
    enrichedPrompt,
    injectedMemoryIds,
  };
};
