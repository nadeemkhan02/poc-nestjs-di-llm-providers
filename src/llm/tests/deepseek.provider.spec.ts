import { ConfigService } from '@nestjs/config';
import { DeepSeekProvider } from '../providers/deepseek.provider';

describe('DeepSeekProvider', () => {
  it('reports its vendor name', () => {
    const provider = new DeepSeekProvider(new ConfigService());
    expect(provider.getName()).toBe('deepseek');
  });

  it('returns a simulated response without making a real network call', async () => {
    const provider = new DeepSeekProvider(new ConfigService());

    const response = await provider.generate('summarise this consultation');

    expect(response.provider).toBe('deepseek');
    expect(response.text).toContain('summarise this consultation');
  });
});
