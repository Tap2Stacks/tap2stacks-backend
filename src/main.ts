import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Request } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config';
import { buildCorsOptions } from './libs/cors';
import { redactSensitivePath } from './libs/redact-url';
import { AppModule } from './modules/app.module';

morgan.token('redacted-url', (req: Request) =>
  redactSensitivePath(req.originalUrl || req.url || ''),
);
morgan.token('redacted-referrer', (req: Request) => {
  const ref = req.headers.referer || req.headers.referrer;
  const raw = Array.isArray(ref) ? ref[0] : ref;
  return raw ? redactSensitivePath(raw) : undefined;
});

const REDACTED_COMBINED_LOG =
  ':remote-addr - :remote-user [:date[clf]] ":method :redacted-url HTTP/:http-version" :status :res[content-length] ":redacted-referrer" ":user-agent"';

const setMiddleware = (app: NestExpressApplication) => {
  app.use(helmet());

  app.enableCors(buildCorsOptions(() => env.corsOrigins));

  app.use(morgan(REDACTED_COMBINED_LOG));

  app.use(compression());

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new Logger('[]'),
  });
  app.useLogger(new Logger('APP'));
  const logger = new Logger('APP');

  app.setGlobalPrefix('api');
  setMiddleware(app);

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('TapTrading Bot API')
      .setVersion('0.0.12')
      .addBearerAuth()
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('swagger', app, swaggerDocument, {
      jsonDocumentUrl: 'swagger/json',
    });
  }

  await app.listen(env.port, () =>
    logger.warn(`> Listening App on port ${env.port}`),
  );
}

bootstrap();
