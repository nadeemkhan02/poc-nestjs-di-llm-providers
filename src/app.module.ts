import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { LlmController } from './llm/llm.controller';

@Module({
  imports: [LlmModule.forRoot()],
  controllers: [AppController, LlmController],
  providers: [AppService],
})
export class AppModule {}
