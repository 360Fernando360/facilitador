export type CredentialField = "agency" | "username" | "password" | "notes";

export type CredentialContext = {
  organizationId: string;
  userId: string;
  credentialId: string;
  keyVersion: number;
  field: CredentialField;
};

export type EncryptedValue = {
  ciphertext: string;
  nonce: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Valor criptográfico inválido.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function additionalData(context: CredentialContext) {
  return encoder.encode([
    "facilitador-private-credential",
    context.organizationId,
    context.userId,
    context.credentialId,
    String(context.keyVersion),
    context.field,
  ].join("|"));
}

function importKey(rawKey: Uint8Array) {
  if (rawKey.byteLength !== 32) {
    throw new Error("A chave de credenciais deve possuir exatamente 32 bytes.");
  }
  const keyBytes = new Uint8Array(rawKey.byteLength);
  keyBytes.set(rawKey);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export function decodeMasterKey(value: string) {
  const decoded = base64ToBytes(value.trim());
  if (decoded.byteLength !== 32) {
    throw new Error(
      "CREDENTIALS_MASTER_KEY_V1 deve ser uma chave Base64 de 32 bytes.",
    );
  }
  return decoded;
}

export async function encryptCredential(
  plaintext: string,
  context: CredentialContext,
  rawKey: Uint8Array,
): Promise<EncryptedValue> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(rawKey);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: additionalData(context),
      tagLength: 128,
    },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(nonce),
  };
}

export async function decryptCredential(
  encrypted: EncryptedValue,
  context: CredentialContext,
  rawKey: Uint8Array,
) {
  const nonce = base64ToBytes(encrypted.nonce);
  if (nonce.byteLength !== 12) throw new Error("Nonce criptográfico inválido.");
  const key = await importKey(rawKey);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: additionalData(context),
      tagLength: 128,
    },
    key,
    base64ToBytes(encrypted.ciphertext),
  );
  return decoder.decode(decrypted);
}
