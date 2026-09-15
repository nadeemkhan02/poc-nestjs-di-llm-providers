import { LlmProviderRegistry } from '../registry/llm-provider.registry';
import { LlmProvider, LlmResponse } from '../interfaces/llm-provider.interface';

class FakeProvider implements LlmProvider {
  constructor(private readonly name: string) {}
  getName(): string {
    return this.name;
  }
  generate(): Promise<LlmResponse> {
    return Promise.resolve({
      provider: this.name,
      model: 'fake-model',
      text: 'fake',
    });
  }
}

describe('LlmProviderRegistry', () => {
  let registry: LlmProviderRegistry;

  beforeEach(() => {
    registry = new LlmProviderRegistry();
  });

  it('registers and retrieves a provider by name', () => {
    const provider = new FakeProvider('fake-vendor');
    registry.register(provider);

    expect(registry.get('fake-vendor')).toBe(provider);
  });

  it('lists every registered provider name', () => {
    registry.register(new FakeProvider('a'));
    registry.register(new FakeProvider('b'));

    expect(registry.getRegisteredNames()).toEqual(['a', 'b']);
  });

  it('throws a descriptive error for an unknown provider', () => {
    registry.register(new FakeProvider('a'));

    expect(() => registry.get('unknown')).toThrow(
      /Unknown LLM provider "unknown"/,
    );
  });
});
