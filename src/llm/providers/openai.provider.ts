import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmGenerateOptions,
  LlmProvider,
  LlmResponse,
} from '../interfaces/llm-provider.interface';
import { LlmVendor } from '../tokens/llm.tokens';

/**
 * OpenAI implementation of LlmProvider.
 *
 * POC NOTE: this does not call the real OpenAI API. It reads a placeholder
 * key from env and returns a simulated response, so the POC can run and be
 * tested with zero external dependency or real credentials. The real
 * `fetch(...)` call is sketched in a comment below for reference.
 */
@Injectable()
export class OpenAiProvider implements LlmProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>(
      'OPENAI_API_KEY',
      'placeholder-openai-key',
    );
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    this.logger.debug(
      `Configured with API key ending in ...${this.apiKey.slice(-4)}`,
    );
  }

  getName(): string {
    return LlmVendor.OPENAI;
  }

  generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmResponse> {
    this.logger.debug(
      `Simulating OpenAI call (model=${this.model}, maxTokens=${options?.maxTokens ?? 'default'})`,
    );

    // Real integration would look roughly like:
    //
    // const res = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     Authorization: `Bearer ${this.apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     model: this.model,
    //     messages: [{ role: 'user', content: prompt }],
    //     max_tokens: options?.maxTokens,
    //     temperature: options?.temperature,
    //   }),
    // });
    // const json = await res.json();
    // return { provider: this.getName(), model: this.model, text: json.choices[0].message.content };

    return Promise.resolve({
      provider: this.getName(),
      model: this.model,
      text: `[simulated openai response] "${prompt}"`,
    });
  }
}
