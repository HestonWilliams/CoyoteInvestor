import { eq, ilike, or, desc } from "drizzle-orm";
import { db } from "@db";
import { investors, type Investor, type NewInvestor } from "@shared/schema";
import { encrypt, decrypt } from "../lib/crypto";
import { writeAudit, type AuditContext } from "./audit";

/**
 * Service layer for investors. Wraps all reads/writes so encrypted columns
 * (PRD §11.1) round-trip through AES-256-GCM and every mutation produces an
 * audit_log row.
 *
 * Public-facing type `InvestorView` has decrypted fields; persisted type
 * `Investor` has the `*Enc` columns.
 */

export interface InvestorInput {
  fullName: string;
  email: string;
  phone?: string | null;
  entityName?: string | null;
  entityType?: string | null;
  address?: string | null; // plaintext IN — encrypted before insert
  ssnEinLast4?: string | null; // plaintext IN — encrypted before insert
  accredited?: boolean;
  accreditedVerifiedAt?: Date | null;
  notes?: string | null;
  tags?: string[];
  portalEnabled?: boolean;
  importedFrom?: string | null;
}

export interface InvestorView {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  entityName: string | null;
  entityType: string | null;
  address: string | null; // decrypted
  ssnEinLast4: string | null; // decrypted
  accredited: boolean;
  accreditedVerifiedAt: Date | null;
  notes: string | null;
  tags: string[];
  portalEnabled: boolean;
  importedFrom: string | null;
  createdAt: Date;
}

function toView(row: Investor): InvestorView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    entityName: row.entityName,
    entityType: row.entityType,
    address: decrypt(row.addressEnc),
    ssnEinLast4: decrypt(row.ssnEinLast4Enc),
    accredited: row.accredited,
    accreditedVerifiedAt: row.accreditedVerifiedAt,
    notes: row.notes,
    tags: row.tags,
    portalEnabled: row.portalEnabled,
    importedFrom: row.importedFrom,
    createdAt: row.createdAt,
  };
}

function toRow(input: InvestorInput): Omit<NewInvestor, "id" | "createdAt"> {
  return {
    fullName: input.fullName,
    email: input.email.toLowerCase().trim(),
    phone: input.phone ?? null,
    entityName: input.entityName ?? null,
    entityType: input.entityType ?? null,
    addressEnc: encrypt(input.address ?? null),
    ssnEinLast4Enc: encrypt(input.ssnEinLast4 ?? null),
    accredited: input.accredited ?? false,
    accreditedVerifiedAt: input.accreditedVerifiedAt ?? null,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
    portalEnabled: input.portalEnabled ?? false,
    importedFrom: input.importedFrom ?? null,
  };
}

export async function listInvestors(opts: { search?: string } = {}): Promise<InvestorView[]> {
  const { search } = opts;
  const rows = search
    ? await db
        .select()
        .from(investors)
        .where(or(ilike(investors.fullName, `%${search}%`), ilike(investors.email, `%${search}%`)))
        .orderBy(desc(investors.createdAt))
    : await db.select().from(investors).orderBy(desc(investors.createdAt));
  return rows.map(toView);
}

export async function getInvestorById(id: string): Promise<InvestorView | null> {
  const [row] = await db.select().from(investors).where(eq(investors.id, id)).limit(1);
  return row ? toView(row) : null;
}

export async function getInvestorByEmail(email: string): Promise<InvestorView | null> {
  const [row] = await db
    .select()
    .from(investors)
    .where(eq(investors.email, email.toLowerCase().trim()))
    .limit(1);
  return row ? toView(row) : null;
}

export async function createInvestor(
  input: InvestorInput,
  ctx: AuditContext
): Promise<InvestorView> {
  const rowData = toRow(input);
  const [inserted] = await db.insert(investors).values(rowData).returning();
  await writeAudit(ctx, {
    tableName: "investors",
    recordId: inserted.id,
    action: "INSERT",
    // Don't echo ciphertext into audit — keep the log readable but PII-free.
    newValues: {
      fullName: inserted.fullName,
      email: inserted.email,
      entityName: inserted.entityName,
      entityType: inserted.entityType,
      accredited: inserted.accredited,
      tags: inserted.tags,
      importedFrom: inserted.importedFrom,
    },
  });
  return toView(inserted);
}

export async function updateInvestor(
  id: string,
  patch: Partial<InvestorInput>,
  ctx: AuditContext
): Promise<InvestorView | null> {
  const [existing] = await db.select().from(investors).where(eq(investors.id, id)).limit(1);
  if (!existing) return null;

  const updates: Partial<NewInvestor> = {};
  if (patch.fullName !== undefined) updates.fullName = patch.fullName;
  if (patch.email !== undefined) updates.email = patch.email.toLowerCase().trim();
  if (patch.phone !== undefined) updates.phone = patch.phone;
  if (patch.entityName !== undefined) updates.entityName = patch.entityName;
  if (patch.entityType !== undefined) updates.entityType = patch.entityType;
  if (patch.address !== undefined) updates.addressEnc = encrypt(patch.address);
  if (patch.ssnEinLast4 !== undefined) updates.ssnEinLast4Enc = encrypt(patch.ssnEinLast4);
  if (patch.accredited !== undefined) updates.accredited = patch.accredited;
  if (patch.accreditedVerifiedAt !== undefined)
    updates.accreditedVerifiedAt = patch.accreditedVerifiedAt;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.tags !== undefined) updates.tags = patch.tags;
  if (patch.portalEnabled !== undefined) updates.portalEnabled = patch.portalEnabled;

  const [updated] = await db.update(investors).set(updates).where(eq(investors.id, id)).returning();

  await writeAudit(ctx, {
    tableName: "investors",
    recordId: id,
    action: "UPDATE",
    oldValues: {
      fullName: existing.fullName,
      email: existing.email,
      entityName: existing.entityName,
      accredited: existing.accredited,
      tags: existing.tags,
    },
    newValues: {
      fullName: updated.fullName,
      email: updated.email,
      entityName: updated.entityName,
      accredited: updated.accredited,
      tags: updated.tags,
    },
  });

  return toView(updated);
}

export async function deleteInvestor(id: string, ctx: AuditContext): Promise<boolean> {
  const [existing] = await db.select().from(investors).where(eq(investors.id, id)).limit(1);
  if (!existing) return false;
  await db.delete(investors).where(eq(investors.id, id));
  await writeAudit(ctx, {
    tableName: "investors",
    recordId: id,
    action: "DELETE",
    oldValues: { fullName: existing.fullName, email: existing.email },
  });
  return true;
}
