import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import dataSource from 'src/libs/typeorm.config';
import { HcsAnchorModule } from 'src/modules/hcs-anchor/hcs-anchor.module';
import { HcsAnchorService } from 'src/modules/hcs-anchor/hcs-anchor.service';

@Module({
  imports: [TypeOrmModule.forRoot(dataSource.options), HcsAnchorModule],
})
class HcsAnchorCliModule {}

async function run() {
  const app = await NestFactory.createApplicationContext(HcsAnchorCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const hcsAnchorService = app.get(HcsAnchorService);
    const result = await hcsAnchorService.runOnce();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
