export type BeforeSubmitPromptHookResponse = {
  continue: true;
  updated_input: {
    prompt: string;
  };
};

export const buildBeforeSubmitPromptHookResponse = (
  originalPrompt: string,
  result: { outputPrompt: string; status: "success" | "failure" }
): BeforeSubmitPromptHookResponse => {
  const outputPrompt =
    result.status === "failure" ? originalPrompt : result.outputPrompt;

  return {
    continue: true,
    updated_input: {
      prompt: outputPrompt,
    },
  };
};

export const buildFailOpenHookResponse = (
  originalPrompt: string
): BeforeSubmitPromptHookResponse => {
  return {
    continue: true,
    updated_input: {
      prompt: originalPrompt,
    },
  };
};

export const buildHookResponseFromOutputPrompt = (
  outputPrompt: string
): BeforeSubmitPromptHookResponse => {
  return {
    continue: true,
    updated_input: {
      prompt: outputPrompt,
    },
  };
};
