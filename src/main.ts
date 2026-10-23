import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JsonLogger } from './wagering/infrastructure/observability/json-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // LOG_FORMAT=text volta ao formato legível do Nest, útil em desenvolvimento.
  app.useLogger(process.env.LOG_FORMAT?.trim() === 'text' ? new ConsoleLogger() : new JsonLogger());
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Gaming Backend API')
    .setDescription('Backend API for a gaming platform')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();