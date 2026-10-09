import { decryptCredential, encryptCredential } from "./credential-crypto.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Esperado ${String(expected)}, recebido ${String(actual)}`);
  }
}

function assertNotEquals(actual: unknown, expected: unknown) {
  if (actual === expected) {
    throw new Error("Os valores deveriam ser diferentes.");
  }
}

async function assertRejects(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error("A operação deveria ter sido rejeitada.");
}

const key = new Uint8Array(32).fill(7);
const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  credentialId: "33333333-3333-4333-8333-333333333333",
  keyVersion: 1,
  field: "password" as const,
};

Deno.test("AES-GCM recupera o texto original e usa nonce exclusivo", async () => {
  const first = await encryptCredential("Senha-forte-123!", context, key);
  const second = await encryptCredential("Senha-forte-123!", context, key);
  assertNotEquals(first.nonce, second.nonce);
  assertNotEquals(first.ciphertext, second.ciphertext);
  assertEquals(
    await decryptCredential(first, context, key),
    "Senha-forte-123!",
  );
});

Deno.test("AES-GCM rejeita ciphertext adulterado", async () => {
  const encrypted = await encryptCredential("segredo", context, key);
  const replacement = encrypted.ciphertext.endsWith("A") ? "B" : "A";
  encrypted.ciphertext = encrypted.ciphertext.slice(0, -1) + replacement;
  await assertRejects(() => decryptCredential(encrypted, context, key));
});

Deno.test("AAD impede uso da credencial por outro usuário", async () => {
  const encrypted = await encryptCredential("segredo", context, key);
  await assertRejects(() =>
    decryptCredential(encrypted, {
      ...context,
      userId: "44444444-4444-4444-8444-444444444444",
    }, key)
  );
});
