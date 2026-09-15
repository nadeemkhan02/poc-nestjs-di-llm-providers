import { LlmService } from '../llm.service';
import { LlmProvider, LlmResponse } from '../interfaces/llm-provider.interface';

describe('LlmService', () => {
  it('delegates to whichever LlmProvider was injected, without knowing the vendor', async () => {
    const fakeProvider: LlmProvider = {
      getName: () => 'fake-vendor',
      generate: (): Promise<LlmResponse> =>
        Promise.resolve({
          provider: 'fake-vendor',
          model: 'fake-model',
          text: 'fake response',
        }),
    };

    const service = new LlmService(fakeProvider);

    expect(service.getActiveVendor()).toBe('fake-vendor');
    await expect(service.generate('hello')).resolves.toEqual({
      provider: 'fake-vendor',
      model: 'fake-model',
      text: 'fake response',
    });
  });
});
