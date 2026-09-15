import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class GenerateDto {
  @IsString()
  prompt: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxTokens?: number;

  @IsOptional()
  @IsNumber()
  temperature?: number;
}
