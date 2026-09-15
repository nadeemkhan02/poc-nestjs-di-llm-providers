import { Test } from '@nestjs/testing';
import { LlmModule } from '../llm.module';
import { LlmService } from '../llm.service';
import { OpenAiProvider } from '../providers/openai.provider';
import { DeepSeekProvider } from '../providers/deepseek.provider';

/**
 * Proves the "Expected Outcome" from goal.md: switching the active LLM
 * vendor requires changing only the LLM_PROVIDER env var — zero code
 * changes in LlmService or any consumer.
 */
describe('LlmModule (provider switching)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('wires up OpenAiProvider when LLM_PROVIDER=openai', async () => {
    process.env.LLM_PROVIDER = 'openai';

    const moduleRef = await Test.createTestingModule({
      imports: [LlmModule.forRoot()],
    }).compile();

    const llmService = moduleRef.get(LlmService);
    expect(llmService.getActiveVendor()).toBe('openai');

    const response = await llmService.generate('hello world');
    expect(response.provider).toBe('openai');

    await moduleRef.close();
  });

  it('wires up DeepSeekProvider when LLM_PROVIDER=deepseek — same LlmService, no code change', async () => {
    process.env.LLM_PROVIDER = 'deepseek';

    const moduleRef = await Test.createTestingModule({
      imports: [LlmModule.forRoot()],
    }).compile();

    const llmService = moduleRef.get(LlmService);
    expect(llmService.getActiveVendor()).toBe('deepseek');

    const response = await llmService.generate('hello world');
    expect(response.provider).toBe('deepseek');

    await moduleRef.close();
  });

  it('fails fast with a clear error for an unregistered vendor name', async () => {
    process.env.LLM_PROVIDER = 'some-unsupported-vendor';

    await expect(
      Test.createTestingModule({
        imports: [LlmModule.forRoot()],
      }).compile(),
    ).rejects.toThrow(/Unknown LLM provider "some-unsupported-vendor"/);
  });

  it('registers both concrete providers so either can be resolved directly if needed', async () => {
    process.env.LLM_PROVIDER = 'openai';

    const moduleRef = await Test.createTestingModule({
      imports: [LlmModule.forRoot()],
    }).compile();

    expect(moduleRef.get(OpenAiProvider)).toBeInstanceOf(OpenAiProvider);
    expect(moduleRef.get(DeepSeekProvider)).toBeInstanceOf(DeepSeekProvider);

    await moduleRef.close();
  });
});
