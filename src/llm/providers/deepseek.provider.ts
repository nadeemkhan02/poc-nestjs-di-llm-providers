import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmGenerateOptions,
  LlmProvider,
  LlmResponse,
} from '../interfaces/llm-provider.interface';
import { LlmVendor } from '../tokens/llm.tokens';

/**
 * DeepSeek implementation of LlmProvider.
 *
 * POC NOTE: same simulation approach as OpenAiProvider — no real network
 * call, no real credentials. Swap in a real HTTP/SDK call (e.g. AWS Bedrock
 * InvokeModelCommand, or DeepSeek's own REST API) behind this same interface
 * without touching any consumer of LlmService.
 */
@Injectable()
export class DeepSeekProvider implements LlmProvider {
  private readonly logger = new Logger(DeepSeekProvider.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>(
      'DEEPSEEK_API_KEY',
      'placeholder-deepseek-key',
    );
    this.model = this.configService.get<string>(
      'DEEPSEEK_MODEL',
      'deepseek-chat',
    );
    this.logger.debug(
      `Configured with API key ending in ...${this.apiKey.slice(-4)}`,
    );
  }

  getName(): string {
    return LlmVendor.DEEPSEEK;
  }

  generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmResponse> {
    this.logger.debug(
      `Simulating DeepSeek call (model=${this.model}, maxTokens=${options?.maxTokens ?? 'default'})`,
    );

    // Real integration would look roughly like:
    //
    // const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
      text: `[simulated deepseek response] "${prompt}"`,
    });
  }
}
