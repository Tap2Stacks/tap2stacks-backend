import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import dataSource from 'src/libs/typeorm.config';
import { ProofModule } from 'src/modules/proof/proof.module';
import { ProofService } from 'src/modules/proof/proof.service';

@Module({
  imports: [TypeOrmModule.forRoot(dataSource.options), ProofModule],
})
class HcsAnchorCliModule {}

async function run() {
  const app = await NestFactory.createApplicationContext(HcsAnchorCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const proofService = app.get(ProofService);
    const result = await proofService.runOnce();
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
