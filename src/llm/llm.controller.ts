import { Body, Controller, Get, Post } from '@nestjs/common';
import { LlmService } from './llm.service';
import { GenerateDto } from './dto/generate.dto';

/**
 * Demo endpoints proving the controller/service layer is provider-agnostic:
 * this file never imports OpenAiProvider or DeepSeekProvider.
 */
@Controller('llm')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Get('active-provider')
  getActiveProvider() {
    return { activeProvider: this.llmService.getActiveVendor() };
  }

  @Post('generate')
  async generate(@Body() dto: GenerateDto) {
    return this.llmService.generate(dto.prompt, {
      maxTokens: dto.maxTokens,
      temperature: dto.temperature,
    });
  }
}
