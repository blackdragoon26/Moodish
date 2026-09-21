import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

const execute = promisify(execFile);
const database = process.env.MOODISH_TEST_DATABASE_URL;
const memoryUrl = new URL('../services/agent/src/memory.mjs', import.meta.url).href;
const run = async script => {
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', `
    import { saveSecretSession, getSecretSession, takeSecretSession, deleteSecretSession, withAccountLock } from ${JSON.stringify(memoryUrl)};
    ${script}
    process.exit(0);
  `], { env: { ...process.env, DATABASE_URL: database, NODE_ENV: 'test' }, timeout: 20000 });
  return stdout.trim();
};

test('PostgreSQL records and advisory locks survive separate app processes', { skip: !database }, async () => {
  const prefix = `integration:${crypto.randomUUID()}`;
  const counter = JSON.stringify(`${prefix}:counter`);
  const single = JSON.stringify(`${prefix}:single`);
  try {
    await run(`await saveSecretSession(${counter}, { count: 0 }); await saveSecretSession(${single}, { once: true });`);
    const increment = `for (let i = 0; i < 8; i++) await withAccountLock(${counter}, async () => {
      const current = await getSecretSession(${counter});
      await new Promise(resolve => setTimeout(resolve, 5));
      await saveSecretSession(${counter}, { count: current.count + 1 });
    });`;
    await Promise.all([run(increment), run(increment)]);
    assert.equal(await run(`console.log((await getSecretSession(${counter})).count);`), '16');
    const consumed = await Promise.all([run(`console.log(Boolean(await takeSecretSession(${single})));`), run(`console.log(Boolean(await takeSecretSession(${single})));`)]);
    assert.deepEqual(consumed.sort(), ['false', 'true']);
    // More operations than pool slots must not deadlock; nested group/cart locks
    // must reuse their connection while writes remain autocommitted before MCP.
    await run(`await Promise.all(Array.from({ length: 15 }, (_, i) => withAccountLock(${counter} + i, () => withAccountLock(${counter} + ':nested:' + i, async () => {
      await saveSecretSession(${counter} + i, { value: i });
      await deleteSecretSession(${counter} + i);
    }))));`);
  } finally {
    await run(`await deleteSecretSession(${counter}); await deleteSecretSession(${single});`);
  }
});
