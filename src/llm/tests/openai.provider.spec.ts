import { ConfigService } from '@nestjs/config';
import { OpenAiProvider } from '../providers/openai.provider';

describe('OpenAiProvider', () => {
  it('reports its vendor name', () => {
    const provider = new OpenAiProvider(new ConfigService());
    expect(provider.getName()).toBe('openai');
  });

  it('returns a simulated response without making a real network call', async () => {
    const provider = new OpenAiProvider(new ConfigService());

    const response = await provider.generate('summarise this consultation');

    expect(response.provider).toBe('openai');
    expect(response.text).toContain('summarise this consultation');
  });

  it('falls back to placeholder config when env vars are absent', () => {
    const configService = new ConfigService();
    jest
      .spyOn(configService, 'get')
      .mockImplementation((_key, fallback) => fallback);

    expect(() => new OpenAiProvider(configService)).not.toThrow();
  });
});
