import crypto from 'node:crypto';

// 32-byte (256-bit) encryption key for local development only
export const DEFAULT_DEV_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
export const ALGORITHM = 'aes-256-gcm';
export const IV_LENGTH = 12; // 96-bit IV recommended for GCM

export interface KeyValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates whether an encryption key is suitable for AES-256-GCM (256-bit / 32-byte).
 * Enforces that production environments NEVER use default or weak keys.
 */
export function validateEncryptionKey(
  rawKey?: string,
  isProduction: boolean = process.env.NODE_ENV === 'production'
): KeyValidationResult {
  if (!rawKey || rawKey.trim() === '') {
    if (isProduction) {
      return {
        valid: false,
        error:
          'TOKEN_ENCRYPTION_KEY environment variable is mandatory in production. Silent default key is strictly prohibited.',
      };
    }
    return { valid: true }; // Development/test fallback allowed
  }

  const trimmed = rawKey.trim();

  if (isProduction && trimmed === DEFAULT_DEV_KEY) {
    return {
      valid: false,
      error: 'TOKEN_ENCRYPTION_KEY cannot use the default development key in production.',
    };
  }

  // Check 1: Exactly 64 hexadecimal characters (256 bits)
  if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { valid: true };
  }

  // Check 2: 32-byte base64 string
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed) || /^[A-Za-z0-9+/]{44}$/.test(trimmed)) {
    try {
      const buf = Buffer.from(trimmed, 'base64');
      if (buf.length === 32) {
        return { valid: true };
      }
    } catch {
      // not valid base64
    }
  }

  if (isProduction) {
    return {
      valid: false,
      error:
        'TOKEN_ENCRYPTION_KEY in production must be a valid 256-bit key (64 hex characters or 32-byte base64 encoded string).',
    };
  }

  return { valid: true };
}

/**
 * Resolves the 32-byte Buffer key for AES-256-GCM.
 * Enforces strict production validation: refuses to run without a valid configured key.
 */
export function getEncryptionKey(): Buffer {
  const isProduction = process.env.NODE_ENV === 'production';
  const envKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();

  const validation = validateEncryptionKey(envKey, isProduction);
  if (!validation.valid) {
    throw new Error(`FATAL CONFIGURATION ERROR: ${validation.error}`);
  }

  if (!envKey) {
    // Isolated development/test fallback only
    return Buffer.from(DEFAULT_DEV_KEY, 'hex');
  }

  // Hex encoded 32-byte key
  if (envKey.length === 64 && /^[0-9a-fA-F]{64}$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }

  // Base64 encoded 32-byte key
  try {
    const b64Buf = Buffer.from(envKey, 'base64');
    if (b64Buf.length === 32) {
      return b64Buf;
    }
  } catch {
    // Fall through to hash for non-production
  }

  if (isProduction) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: TOKEN_ENCRYPTION_KEY is not a valid 32-byte key for AES-256-GCM.'
    );
  }

  // Non-production fallback: hash arbitrary string to 32 bytes
  return crypto.createHash('sha256').update(envKey).digest();
}

/**
 * Encrypts sensitive OAuth token using AES-256-GCM
 * Output format: iv:tag:ciphertext (hex encoded)
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypts sensitive OAuth token from AES-256-GCM string
 * Never logs or exposes raw tokens or cryptographic keys on failure.
 */
export function decryptToken(encryptedString: string): string {
  if (!encryptedString) return '';
  try {
    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }

    const [ivHex, tagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // Never print or leak key, token, or stack containing ciphertext fragments
    throw new Error('Decryption failed: Token is corrupt or key mismatch');
  }
}

/**
 * Mask token for display (shows only first 4 and last 4 chars)
 */
export function maskToken(token: string): string {
  if (!token) return '••••••••••••';
  if (token.length <= 8) return '••••••••';
  return `${token.substring(0, 4)}••••••••${token.substring(token.length - 4)}`;
}
