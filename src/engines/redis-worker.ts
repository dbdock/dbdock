import Redis from 'ioredis';

const MODE = process.argv[2];
const HEADER_BYTES = 4;
const TTL_BYTES = 8;

function buildClient(): Redis {
  return new Redis({
    host: process.env.DBDOCK_REDIS_HOST || 'localhost',
    port: parseInt(process.env.DBDOCK_REDIS_PORT || '6379', 10),
    username: process.env.DBDOCK_REDIS_USERNAME || undefined,
    password: process.env.DBDOCK_REDIS_PASSWORD || undefined,
    db: parseInt(process.env.DBDOCK_REDIS_DB || '0', 10),
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
}

function writeAsync(chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

function frame(key: Buffer, ttlMs: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(HEADER_BYTES + TTL_BYTES + HEADER_BYTES);
  head.writeUInt32BE(key.length, 0);
  head.writeBigInt64BE(BigInt(ttlMs), HEADER_BYTES);
  head.writeUInt32BE(payload.length, HEADER_BYTES + TTL_BYTES);
  return Buffer.concat([head, key, payload]);
}

async function dump(): Promise<void> {
  const client = buildClient();
  await client.connect();
  const stream = client.scanBufferStream({ count: 500 });
  for await (const keys of stream as AsyncIterable<Buffer[]>) {
    if (keys.length === 0) continue;

    const pipeline = client.pipeline();
    for (const key of keys) {
      pipeline.callBuffer('DUMP', key);
      pipeline.pttl(key);
    }
    const results = (await pipeline.exec()) as Array<
      [Error | null, unknown]
    > | null;
    if (!results) continue;

    for (let i = 0; i < keys.length; i++) {
      const [, payloadRaw] = results[i * 2];
      const [, pttlRaw] = results[i * 2 + 1];
      const payload = payloadRaw as Buffer | null;
      if (!payload) continue;
      const pttl = typeof pttlRaw === 'number' ? pttlRaw : Number(pttlRaw);
      const ttlMs = pttl > 0 ? pttl : 0;
      await writeAsync(frame(keys[i], ttlMs, payload));
    }
  }
  await client.quit();
}

async function restore(): Promise<void> {
  const client = buildClient();
  await client.connect();
  const FLUSH_EVERY = 500;
  let buffer = Buffer.alloc(0);
  let pipeline = client.pipeline();
  let queued = 0;

  const flush = async (): Promise<void> => {
    if (queued === 0) return;
    await pipeline.exec();
    pipeline = client.pipeline();
    queued = 0;
  };

  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    let offset = 0;
    while (buffer.length - offset >= HEADER_BYTES + TTL_BYTES + HEADER_BYTES) {
      const keyLen = buffer.readUInt32BE(offset);
      const ttlMs = Number(buffer.readBigInt64BE(offset + HEADER_BYTES));
      const payloadLen = buffer.readUInt32BE(offset + HEADER_BYTES + TTL_BYTES);
      const total =
        HEADER_BYTES + TTL_BYTES + HEADER_BYTES + keyLen + payloadLen;
      if (buffer.length - offset < total) break;
      const keyStart = offset + HEADER_BYTES + TTL_BYTES + HEADER_BYTES;
      const key = buffer.subarray(keyStart, keyStart + keyLen);
      const payload = buffer.subarray(
        keyStart + keyLen,
        keyStart + keyLen + payloadLen,
      );
      pipeline.callBuffer('RESTORE', key, String(ttlMs), payload, 'REPLACE');
      queued++;
      if (queued >= FLUSH_EVERY) {
        await flush();
      }
      offset = keyStart + keyLen + payloadLen;
    }
    buffer = buffer.subarray(offset);
  }

  await flush();
  await client.quit();
}

const run = MODE === 'restore' ? restore : dump;

run().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
