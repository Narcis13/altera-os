/**
 * Password hashing using Bun's built-in argon2id.
 * See: https://bun.sh/docs/api/hashing#bun-password
 */
export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: 'argon2id' });
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  if (hashed.startsWith('PLAINTEXT:')) {
    return plain === hashed.slice('PLAINTEXT:'.length);
  }
  try {
    return await Bun.password.verify(plain, hashed);
  } catch {
    return false;
  }
}
