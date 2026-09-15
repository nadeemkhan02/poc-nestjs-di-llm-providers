import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OpenAiProvider } from './providers/openai.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { LlmProviderRegistry } from './registry/llm-provider.registry';
import { LLM_PROVIDER, LlmVendor } from './tokens/llm.tokens';
import { LlmService } from './llm.service';

/**
 * Factory provider: builds the registry, registers every known vendor
 * implementation, then resolves LLM_PROVIDER to whichever one matches the
 * LLM_PROVIDER env var. Business code injects LLM_PROVIDER and never knows
 * (or cares) which concrete class it got.
 */
const llmProviderFactory: Provider = {
  provide: LLM_PROVIDER,
  // Depending on 'LLM_PROVIDER_BOOTSTRAP' forces Nest's DI graph to
  // instantiate it (and therefore populate the registry) before this
  // factory runs, regardless of provider array order.
  inject: [ConfigService, LlmProviderRegistry, 'LLM_PROVIDER_BOOTSTRAP'],
  useFactory: (configService: ConfigService, registry: LlmProviderRegistry) => {
    const activeVendor = configService.get<string>(
      'LLM_PROVIDER',
      LlmVendor.OPENAI,
    );
    return registry.get(activeVendor);
  },
};

@Module({})
export class LlmModule {
  /**
   * Dynamic module: registers the config source, the concrete vendor
   * providers, the registry, and the factory that selects the active one.
   * `forRoot()` keeps the wiring in one place so app.module.ts stays clean.
   */
  static forRoot(): DynamicModule {
    return {
      module: LlmModule,
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        OpenAiProvider,
        DeepSeekProvider,
        LlmProviderRegistry,
        {
          // Registers both concrete providers into the registry exactly
          // once, right after Nest instantiates them, before anything
          // resolves LLM_PROVIDER.
          provide: 'LLM_PROVIDER_BOOTSTRAP',
          inject: [LlmProviderRegistry, OpenAiProvider, DeepSeekProvider],
          useFactory: (
            registry: LlmProviderRegistry,
            openAiProvider: OpenAiProvider,
            deepSeekProvider: DeepSeekProvider,
          ) => {
            registry.register(openAiProvider);
            registry.register(deepSeekProvider);
            return true;
          },
        },
        llmProviderFactory,
        LlmService,
      ],
      exports: [LlmService],
      global: true,
    };
  }
}
