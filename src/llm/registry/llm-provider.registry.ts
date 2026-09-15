import { Injectable } from '@nestjs/common';
import { LlmProvider } from '../interfaces/llm-provider.interface';

/**
 * Holds every registered LlmProvider keyed by vendor name.
 * Adding a new vendor never requires editing this class or an if/else chain
 * elsewhere — it is a pure lookup table populated at module init time.
 */
@Injectable()
export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  register(provider: LlmProvider): void {
    this.providers.set(provider.getName(), provider);
  }

  get(name: string): LlmProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Unknown LLM provider "${name}". Registered providers: ${[...this.providers.keys()].join(', ')}`,
      );
    }
    return provider;
  }

  getRegisteredNames(): string[] {
    return [...this.providers.keys()];
  }
}
