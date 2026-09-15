import { LlmController } from '../llm.controller';
import { LlmService } from '../llm.service';

describe('LlmController', () => {
  it('reports the active provider from LlmService', () => {
    const llmService = { getActiveVendor: () => 'openai' } as LlmService;
    const controller = new LlmController(llmService);

    expect(controller.getActiveProvider()).toEqual({
      activeProvider: 'openai',
    });
  });

  it('delegates generate() to LlmService with the DTO fields', async () => {
    const generate = jest.fn().mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
      text: 'hi',
    });
    const llmService = { generate } as unknown as LlmService;
    const controller = new LlmController(llmService);

    await controller.generate({
      prompt: 'hi',
      maxTokens: 50,
      temperature: 0.5,
    });

    expect(generate).toHaveBeenCalledWith('hi', {
      maxTokens: 50,
      temperature: 0.5,
    });
  });
});
