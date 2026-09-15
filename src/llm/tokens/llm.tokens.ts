/**
 * DI token for the currently active LlmProvider.
 * Using a token (instead of a class) lets us bind an interface to a
 * runtime-selected implementation via a factory provider.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/**
 * DI token for the registry that holds every registered provider,
 * keyed by vendor name.
 */
export const LLM_PROVIDER_REGISTRY = Symbol('LLM_PROVIDER_REGISTRY');

export enum LlmVendor {
  OPENAI = 'openai',
  DEEPSEEK = 'deepseek',
}
