export interface LlmGenerateOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  provider: string;
  model: string;
  text: string;
}

/**
 * Common contract every LLM vendor integration must implement.
 * Business logic depends only on this interface, never on a concrete provider,
 * so a new vendor can be added or swapped without touching consumers.
 */
export interface LlmProvider {
  getName(): string;
  generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmResponse>;
}
