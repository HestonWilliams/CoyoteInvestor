/**
 * Seed or reset a GP user. Usage:
 *   tsx server/scripts/seed-gp.ts --email you@coyoteequity.com --password '...'
 *
 * Run with the same env as the app so DATABASE_URL and ENCRYPTION_KEY /
 * JWT_SECRET are available. Password is bcrypt-hashed at cost 12.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { gpUsers } from "@shared/schema";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

const email = arg("--email");
const password = arg("--password");
const fullName = arg("--name") ?? null;

if (!email || !password) {
  console.error("Usage: tsx server/scripts/seed-gp.ts --email <email> --password <pass> [--name <name>]");
  process.exit(1);
}
if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);

const [existing] = await db
  .select()
  .from(gpUsers)
  .where(eq(gpUsers.email, email.toLowerCase().trim()))
  .limit(1);

if (existing) {
  await db
    .update(gpUsers)
    .set({ passwordHash: hash, fullName: fullName ?? existing.fullName, isActive: true })
    .where(eq(gpUsers.id, existing.id));
  console.log(`Updated GP ${email}`);
} else {
  const [row] = await db
    .insert(gpUsers)
    .values({ email: email.toLowerCase().trim(), passwordHash: hash, fullName })
    .returning();
  console.log(`Created GP ${row.email} (id ${row.id})`);
}
process.exit(0);
