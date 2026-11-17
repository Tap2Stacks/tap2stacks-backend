import dataSource from '../libs/typeorm.config';
import { Order } from '../modules/order/entities/order.entity';
import { OrderStatus } from '../modules/order/types';

type MockSettledOrderSeed = {
  userId: string;
  marketId: string;
  amount: string;
  rewardRate: string;
  lowerPrice: string;
  upperPrice: string;
  placedAt: number;
  settledAt: number;
  settledWin: boolean;
};

function buildMockSeeds(count: number): MockSettledOrderSeed[] {
  const now = Date.now();
  const baseSettledAt = now - 5 * 60 * 1000;

  return Array.from({ length: count }, (_, index) => {
    const cellTimeStart = baseSettledAt - (count - index) * 15_000;
    const settledWin = Math.random() > 0.5;
    const lowerPrice = 95_000 + index * 150;
    const upperPrice = lowerPrice + 800;

    return {
      userId: `mock_anchor_user_${String(index + 1).padStart(3, '0')}`,
      marketId: index % 2 === 0 ? 'BTCUSDT' : 'ETHUSDT',
      amount: String(50 + index * 25),
      rewardRate: settledWin ? '1.9' : '0',
      lowerPrice: String(lowerPrice),
      upperPrice: String(upperPrice),
      placedAt: cellTimeStart - 20_000,
      settledAt: cellTimeStart + 10_000,
      settledWin,
    };
  });
}

async function insertMockSettledOrders(count: number = 5) {
  console.log('Connecting to database...');
  await dataSource.initialize();
  console.log('Database connected!');

  try {
    const orderRepository = dataSource.getRepository(Order);

    console.log('\n🧹 Cleaning up previous mock settled orders...');
    await orderRepository
      .createQueryBuilder()
      .delete()
      .where(`"orderId" LIKE :prefix`, { prefix: 'mock_anchor_order_%' })
      .execute();
    console.log('  ✓ Old mock settled orders removed');

    const seeds = buildMockSeeds(count);

    console.log(`\n📝 Inserting ${seeds.length} mock settled orders...`);

    const entities = seeds.map((seed, index) =>
      orderRepository.create({
        orderId: `mock_anchor_order_${String(index + 1).padStart(3, '0')}_${Date.now()}`,
        userId: seed.userId,
        marketId: seed.marketId,
        cellTimeStart: seed.settledAt - 10_000,
        cellTimeEnd: seed.settledAt,
        lowerPrice: seed.lowerPrice,
        upperPrice: seed.upperPrice,
        amount: seed.amount,
        rewardRate: seed.rewardRate,
        placedAt: seed.placedAt,
        status: OrderStatus.SETTLED,
        settledAt: seed.settledAt,
        settledWin: seed.settledWin,
        anchorBatchId: null,
        anchorLeafHash: null,
        anchoredAt: null,
      }),
    );

    await orderRepository.save(entities);

    for (const order of entities) {
      console.log(
        `  ✓ ${order.orderId} | user=${order.userId} | market=${order.marketId} | settledWin=${order.settledWin} | settledAt=${order.settledAt}`,
      );
    }

    console.log('\n✅ Mock settled orders inserted successfully!');
    console.log(`  - Count: ${entities.length}`);
    console.log(
      `  - Ready for anchoring: ${entities.filter((order) => order.anchorBatchId == null).length}`,
    );
  } catch (error) {
    console.error('❌ Error inserting mock settled orders:', error);
    throw error;
  } finally {
    await dataSource.destroy();
    console.log('\nDatabase connection closed.');
  }
}

if (require.main === module) {
  const countArg = process.argv[2];
  const parsedCount = countArg ? Number.parseInt(countArg, 10) : 5;

  insertMockSettledOrders(Number.isFinite(parsedCount) ? parsedCount : 5)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { insertMockSettledOrders };
