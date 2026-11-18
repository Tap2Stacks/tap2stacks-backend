import { createHmac, randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const baseUrl = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');

function fail(step, reason, socket) {
  console.error(`SMOKE FAIL: ${step}: ${reason}`);
  if (socket) socket.close();
  process.exit(1);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

function hmacHex(keyHex, message) {
  return createHmac('sha256', Buffer.from(keyHex, 'hex')).update(message).digest('hex');
}

function getCellId(cell) {
  return `${cell.ticker}:${cell.startTs}:${cell.endTs}:${cell.lowerPrice}:${cell.upperPrice}`;
}

function shortAddress(address) {
  const addr = address.toLowerCase();
  return `0x${addr.slice(2, 6)}..${addr.slice(-2)}`;
}

async function loginWallet() {
  const account = privateKeyToAccount(generatePrivateKey());
  const address = account.address;
  const { challenge } = await fetchJson(
    `${baseUrl}/api/auth/challenge?address=${encodeURIComponent(address)}`,
  );
  const signature = await account.signMessage({ message: challenge });
  const login = await fetchJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature, age18: true, notUS: true }),
  });
  if (!login?.accessToken) throw new Error('missing accessToken');
  return { address, accessToken: login.accessToken };
}

async function devTopUp(accessToken) {
  await fetchJson(`${baseUrl}/api/payment/debug/deposit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: 100 }),
  });
}

function connectAndSubscribe(address, accessToken) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { timeout: 10000 });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('socket connect/subscribe timeout'));
    }, 10000);

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.on('subscribed', (msg) => {
      if (msg?.status !== 'success') return;
      clearTimeout(timer);
      resolve({ socket, wssKey: socket.__wssKey });
    });

    socket.on('connect', async () => {
      try {
        const [{ key: wssKey }, { challenge }] = await Promise.all([
          fetchJson(`${baseUrl}/api/auth/wss-key`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
          fetchJson(`${baseUrl}/api/auth/challenge?address=${encodeURIComponent(address)}`),
        ]);
        socket.__wssKey = wssKey;
        const signature = createHmac('sha256', Buffer.from(wssKey, 'hex'))
          .update(address)
          .update(challenge)
          .digest('hex');
        socket.emit('subscribe_user', { userId: address, signature });
      } catch (err) {
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}

function waitForOpenCell(socket, ticker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no open ${ticker} cell received`)), 15000);
    const onGrid = (data) => {
      if (data?.ticker !== ticker || !Array.isArray(data.cells)) return;
      const now = Date.now();
      const candidates = data.cells
        .filter((c) => c.ticker === ticker && c.startTs - now >= 6000 && Number(c.rewardRate) > 1)
        .sort((a, b) => a.startTs - b.startTs);
      if (candidates.length === 0) return;
      clearTimeout(timer);
      socket.off('grid_update', onGrid);
      resolve(candidates[0]);
    };
    socket.on('grid_update', onGrid);
  });
}

function placeStackedTaps(socket, wssKey, address, cell, amounts) {
  const cellId = getCellId(cell);
  const expectedIds = new Set();
  const seenOpen = new Set();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for 3 OPEN order_update events (got ${seenOpen.size})`));
    }, 10000);

    const onOrderUpdate = (msg) => {
      if (!msg?.clientTapId || !expectedIds.has(msg.clientTapId)) return;
      if (msg.status === 'REJECTED') {
        cleanup();
        reject(new Error(`order rejected: ${msg.reason ?? 'unknown'}`));
        return;
      }
      if (msg.status === 'OPEN') {
        seenOpen.add(msg.clientTapId);
        if (seenOpen.size === expectedIds.size) {
          cleanup();
          resolve(cellId);
        }
      }
    };

    const onMessage = (msg) => {
      if (typeof msg === 'string' && msg.toLowerCase().includes('failed')) {
        cleanup();
        reject(new Error(msg));
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('order_update', onOrderUpdate);
      socket.off('message', onMessage);
    };

    socket.on('order_update', onOrderUpdate);
    socket.on('message', onMessage);

    for (const amount of amounts) {
      const clientTapId = randomUUID();
      expectedIds.add(clientTapId);
      const userSignature = hmacHex(wssKey, `${cell.gridTs}:${cellId}:${amount}`);
      socket.emit('place_bet', {
        userId: address,
        marketId: cell.ticker,
        amount: String(amount),
        cell,
        userSignature,
        clientTapId,
      });
    }
  });
}

function waitForSettlementFeed(socket, address, cellId, placedAtMs) {
  const playerShort = shortAddress(address);
  const prefix = `${playerShort}:${cellId}:`;
  const matching = [];

  return new Promise((resolve, reject) => {
    let settleTimer = null;
    const timeout = setTimeout(() => {
      socket.off('trade_feed', onFeed);
      reject(new Error(`settlement trade_feed timeout after 60s for ${cellId}`));
    }, 60000);

    const onFeed = (entry) => {
      if (entry?.playerShort !== playerShort || !String(entry?.id || '').startsWith(prefix)) return;
      matching.push({ entry, settledAtMs: Date.now() });
      if (!settleTimer) {
        settleTimer = setTimeout(() => {
          clearTimeout(timeout);
          socket.off('trade_feed', onFeed);
          if (matching.length !== 1) {
            reject(new Error(`expected 1 trade_feed entry, got ${matching.length}`));
            return;
          }
          const { entry: item, settledAtMs } = matching[0];
          if (item.stake !== '16') {
            reject(new Error(`expected stake "16", got "${item.stake}"`));
            return;
          }
          resolve({ entry: item, elapsedMs: settledAtMs - placedAtMs });
        }, 600);
      }
    };

    socket.on('trade_feed', onFeed);
  });
}

async function verifyRestViews(feedEntry) {
  const recentFeed = await fetchJson(`${baseUrl}/api/feed/recent`);
  if (!Array.isArray(recentFeed) || !recentFeed.some((item) => item.id === feedEntry.id && item.stake === '16')) {
    throw new Error(`GET /api/feed/recent missing entry ${feedEntry.id}`);
  }

  const prices = await fetchJson(`${baseUrl}/api/prices/recent?ticker=NVDA`);
  if (!Array.isArray(prices?.points) || prices.points.length < 10) {
    throw new Error(`expected >= 10 NVDA price points, got ${prices?.points?.length ?? 0}`);
  }
  if (typeof prices?.prevDayPx !== 'number' || !Number.isFinite(prices.prevDayPx)) {
    throw new Error(`invalid prevDayPx: ${prices?.prevDayPx}`);
  }
  return { pointsCount: prices.points.length, prevDayPx: prices.prevDayPx };
}

async function main() {
  let socket;
  let auth;
  try {
    auth = await loginWallet();
  } catch (err) {
    fail('login', err.message);
  }

  try {
    await devTopUp(auth.accessToken);
  } catch (err) {
    fail('top-up', err.message);
  }

  let wssKey;
  try {
    ({ socket, wssKey } = await connectAndSubscribe(auth.address, auth.accessToken));
  } catch (err) {
    fail('socket', err.message);
  }

  let cell;
  try {
    cell = await waitForOpenCell(socket, 'NVDA');
  } catch (err) {
    fail('pick-cell', err.message, socket);
  }

  const placedAtMs = Date.now();
  let cellId;
  try {
    cellId = await placeStackedTaps(socket, wssKey, auth.address, cell, [1, 5, 10]);
  } catch (err) {
    fail('order_update', err.message, socket);
  }

  let settled;
  try {
    settled = await waitForSettlementFeed(socket, auth.address, cellId, placedAtMs);
  } catch (err) {
    fail('settlement', err.message, socket);
  }

  let restInfo;
  try {
    restInfo = await verifyRestViews(settled.entry);
  } catch (err) {
    fail('rest-verify', err.message, socket);
  }

  const resultLabel = settled.entry.result === 'win' ? 'WON' : 'LOST';
  console.log(
    `Settled cell=${cellId} result=${resultLabel} stake=${settled.entry.stake} payout=${settled.entry.payout} elapsedMs=${settled.elapsedMs} pricePoints=${restInfo.pointsCount} prevDayPx=${restInfo.prevDayPx}`,
  );
  console.log('SMOKE PASS');
  socket.close();
  process.exit(0);
}

main();
