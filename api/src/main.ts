import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '2mb' }); // push: ate 50 pedidos de ate 200 itens

  // registro de requisicoes: metodo, rota, status, tempo e se o CLIENTE desistiu antes da resposta
  const http = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const t0 = Date.now();
    res.on('finish', () => http.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - t0}ms)`));
    res.on('close', () => {
      if (!res.writableFinished) {
        http.warn(`${req.method} ${req.originalUrl} -> o cliente fechou a conexao apos ${Date.now() - t0}ms, sem receber resposta`);
      }
    });
    next();
  });

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
