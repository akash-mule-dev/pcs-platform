/**
 * Round-trip check for the Ably real-time transport (mirrors verify-blob.cjs).
 *
 * Needs ABLY_API_KEY in backend/.env. Subscribes with the Realtime client and
 * publishes with the REST client (exactly how the backend publishes) — proving
 * the key, capability and connectivity end-to-end.
 *
 *   cd backend && node scripts/verify-ably.mjs
 */
import 'dotenv/config';
import Ably from 'ably';

const key = process.env.ABLY_API_KEY;
if (!key) {
  console.error('✗ ABLY_API_KEY is not set — add it to backend/.env (Ably dashboard → API Keys).');
  process.exit(1);
}

const channel = 'org:verify-roundtrip';
const event = 'work-order-update';
const payload = { ok: true, mark: 'B101', at: new Date().toISOString() };

const realtime = new Ably.Realtime(key);
const rest = new Ably.Rest(key);

const fail = (msg) => { console.error('✗', msg); realtime.close(); process.exit(1); };
const timer = setTimeout(() => fail('timed out after 10s waiting for the message'), 10000);

realtime.connection.on('failed', () => fail('Realtime connection failed — check the API key'));

const sub = realtime.channels.get(channel);
await sub.subscribe(event, (msg) => {
  clearTimeout(timer);
  console.log(`✓ received '${msg.name}' on '${channel}':`, JSON.stringify(msg.data));
  console.log('✓ Ably round-trip OK — the backend transport is wired correctly.');
  realtime.close();
  process.exit(0);
});

await rest.channels.get(channel).publish(event, payload);
console.log(`→ published '${event}' to '${channel}' via REST (the backend's publish path)`);
