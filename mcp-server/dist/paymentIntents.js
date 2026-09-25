// In-memory intent store keyed by the Solana Pay `reference` pubkey.
// IMPORTANT: intentionally NOT persistent — a process restart between QR
// generation and wallet scan loses the intent (404s on POST). Fine for a
// hackathon build; move to Redis/Postgres with a TTL for anything longer-lived.
const intents = new Map();
const TTL_MS = 5 * 60 * 1000;
export function storeIntent(reference, intent) {
    intents.set(reference, intent);
    setTimeout(() => intents.delete(reference), TTL_MS).unref();
}
export function getIntent(reference) {
    return intents.get(reference);
}
