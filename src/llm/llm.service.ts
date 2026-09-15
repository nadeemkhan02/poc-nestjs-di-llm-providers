import { Inject, Injectable } from '@nestjs/common';
import {
  LlmGenerateOptions,
  LlmProvider,
  LlmResponse,
} from './interfaces/llm-provider.interface';
import { LLM_PROVIDER } from './tokens/llm.tokens';

/**
 * Facade that all business logic depends on. It only knows about the
 * LlmProvider interface — the concrete vendor behind LLM_PROVIDER is
 * resolved entirely by LlmModule's factory provider based on env config.
 * Swapping OpenAI for DeepSeek (or adding a third vendor) never requires
 * touching this class or any of its consumers.
 */
@Injectable()
export class LlmService {
  constructor(@Inject(LLM_PROVIDER) private readonly provider: LlmProvider) {}

  getActiveVendor(): string {
    return this.provider.getName();
  }

  generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmResponse> {
    return this.provider.generate(prompt, options);
  }
}
