import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import dataSource from 'src/libs/typeorm.config';
import { HcsAnchorModule } from 'src/modules/hcs-anchor/hcs-anchor.module';
import { HcsAnchorService } from 'src/modules/hcs-anchor/hcs-anchor.service';

@Module({
  imports: [TypeOrmModule.forRoot(dataSource.options), HcsAnchorModule],
})
class HcsAnchorTopicVerifyCliModule {}

async function run() {
  const batchId = process.argv[2];

  if (!batchId) {
    throw new Error(
      'Usage: ts-node -r tsconfig-paths/register src/scripts/verify-hcs-topic-anchor.ts <batchId>',
    );
  }

  const app = await NestFactory.createApplicationContext(
    HcsAnchorTopicVerifyCliModule,
    {
      logger: ['error', 'warn', 'log'],
    },
  );

  try {
    const hcsAnchorService = app.get(HcsAnchorService);
    const result = await hcsAnchorService.verifyBatchTopic(batchId);
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
