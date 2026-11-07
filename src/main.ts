import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Runs DBDock's scheduled jobs as a long-lived process. There are no HTTP
// routes, so an application context is enough and no web server is started.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
}
void bootstrap();
