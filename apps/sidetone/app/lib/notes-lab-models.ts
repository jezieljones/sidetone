export type NotesLabProvider = "openai" | "anthropic" | "gemini";

export type NotesLabModelOption = {
  provider: NotesLabProvider;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  tierLabel: string;
};

export const NOTES_LAB_MODEL_OPTIONS = [
  {
    provider: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-5.4-mini",
    modelLabel: "GPT-5.4 Mini",
    tierLabel: "Fast/lite"
  },
  {
    provider: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-5.5",
    modelLabel: "GPT-5.5",
    tierLabel: "Strongest"
  },
  {
    provider: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-haiku-4-5",
    modelLabel: "Claude Haiku 4.5",
    tierLabel: "Fast/lite"
  },
  {
    provider: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-opus-4-7",
    modelLabel: "Claude Opus 4.7",
    tierLabel: "Strongest"
  },
  {
    provider: "gemini",
    providerLabel: "Gemini",
    modelId: "gemini-3.1-flash-lite",
    modelLabel: "Gemini 3.1 Flash Lite",
    tierLabel: "Fast/lite"
  },
  {
    provider: "gemini",
    providerLabel: "Gemini",
    modelId: "gemini-3-pro-preview",
    modelLabel: "Gemini 3 Pro Preview",
    tierLabel: "Strongest"
  }
] as const satisfies readonly NotesLabModelOption[];

export const NOTES_LAB_PROVIDERS = Array.from(
  new Map(
    NOTES_LAB_MODEL_OPTIONS.map((option) => [
      option.provider,
      {
        provider: option.provider,
        providerLabel: option.providerLabel
      }
    ])
  ).values()
);

export function notesLabModelsForProvider(provider: NotesLabProvider) {
  return NOTES_LAB_MODEL_OPTIONS.filter((option) => option.provider === provider);
}

export function notesLabModelFor(provider: string, modelId: string) {
  return NOTES_LAB_MODEL_OPTIONS.find(
    (option) => option.provider === provider && option.modelId === modelId
  );
}

export function isNotesLabProvider(provider: string): provider is NotesLabProvider {
  return provider === "openai" || provider === "anthropic" || provider === "gemini";
}
