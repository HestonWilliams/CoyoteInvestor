import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  numeric,
  date,
  integer,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// =========================================================================
// AUTH
// =========================================================================

/**
 * GP Admin users. Password is bcrypt-hashed. Currently one seat (Heston),
 * schema allows additional seats.
 */
export const gpUsers = pgTable("gp_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * DB-backed refresh-token revocation (PRD §11.2). One row per issued refresh
 * token; rotation on use sets revokedAt + replacedBy so the token chain is
 * auditable.
 */
export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  userRole: text("user_role").notNull(), // 'gp' | 'lp'
  tokenHash: text("token_hash").notNull().unique(), // sha256 of the random token component
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedBy: uuid("replaced_by"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

/**
 * LP magic-link tokens. Token is stored as a bcrypt hash — never reversible.
 * Single use: consumedAt flips when the token is verified.
 */
export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id").notNull(),
  tokenHash: text("token_hash").notNull(), // bcrypt
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =========================================================================
// CRM — Investors
// =========================================================================

export const investors = pgTable("investors", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  entityName: text("entity_name"),
  entityType: text("entity_type"), // individual | llc | trust | ira
  // Encrypted fields (AES-256-GCM at the service layer — PRD §11.1).
  // Stored as `iv:tag:ciphertext` hex strings.
  addressEnc: text("address_enc"),
  ssnEinLast4Enc: text("ssn_ein_last4_enc"),
  accredited: boolean("accredited").notNull().default(false),
  accreditedVerifiedAt: timestamp("accredited_verified_at", { withTimezone: true }),
  notes: text("notes"),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  portalEnabled: boolean("portal_enabled").notNull().default(false),
  importedFrom: text("imported_from"), // "appfolio" etc.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =========================================================================
// Deals
// =========================================================================

export const deals = pgTable("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull().default("other"), // self_storage | multifamily | land | other
  status: text("status").notNull().default("prospecting"), // prospecting | fundraising | active | exited
  address: text("address"),
  totalEquity: numeric("total_equity", { precision: 18, scale: 2 }),
  equityRaised: numeric("equity_raised", { precision: 18, scale: 2 }).notNull().default("0"),
  acquisitionPrice: numeric("acquisition_price", { precision: 18, scale: 2 }),
  currentValue: numeric("current_value", { precision: 18, scale: 2 }),
  loanBalance: numeric("loan_balance", { precision: 18, scale: 2 }),
  loanRate: numeric("loan_rate", { precision: 7, scale: 4 }),
  loanMaturity: date("loan_maturity"),
  acquisitionDate: date("acquisition_date"),
  projectedExitDate: date("projected_exit_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =========================================================================
// Positions (LP stakes in a deal)
// =========================================================================

export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  investorId: uuid("investor_id").notNull().references(() => investors.id, { onDelete: "restrict" }),
  committedAmount: numeric("committed_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  fundedAmount: numeric("funded_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  ownershipPct: numeric("ownership_pct", { precision: 9, scale: 6 }),
  shareClass: text("share_class").notNull().default("class_a"), // class_a | class_b | gp
  status: text("status").notNull().default("committed"), // committed | funded | exited
  fundedAt: timestamp("funded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =========================================================================
// Waterfall Config (per deal)
// =========================================================================

export const waterfallConfigs = pgTable("waterfall_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id").notNull().unique().references(() => deals.id, { onDelete: "cascade" }),
  prefReturnPct: numeric("pref_return_pct", { precision: 7, scale: 4 }).notNull().default("7"),
  lpSplitPct: numeric("lp_split_pct", { precision: 7, scale: 4 }).notNull().default("70"),
  gpSplitPct: numeric("gp_split_pct", { precision: 7, scale: 4 }).notNull().default("30"),
  catchup: boolean("catchup").notNull().default(false),
  catchupPct: numeric("catchup_pct", { precision: 7, scale: 4 }),
  notes: text("notes"),
});

// =========================================================================
// Distributions
// =========================================================================

export const distributions = pgTable("distributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  distributionDate: date("distribution_date").notNull(),
  type: text("type").notNull().default("operating"), // operating | return_of_capital | refinance | sale
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  status: text("status").notNull().default("draft"), // draft | approved | paid
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const distributionLineItems = pgTable("distribution_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  distributionId: uuid("distribution_id")
    .notNull()
    .references(() => distributions.id, { onDelete: "cascade" }),
  investorId: uuid("investor_id").notNull().references(() => investors.id, { onDelete: "restrict" }),
  positionId: uuid("position_id").notNull().references(() => positions.id, { onDelete: "restrict" }),
  grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }).notNull(),
  prefComponent: numeric("pref_component", { precision: 18, scale: 2 }).notNull().default("0"),
  returnOfCapital: numeric("return_of_capital", { precision: 18, scale: 2 }).notNull().default("0"),
  profitSplit: numeric("profit_split", { precision: 18, scale: 2 }).notNull().default("0"),
  netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"), // pending | sent | confirmed
  paymentMethod: text("payment_method"), // check | ach | wire
  paymentRef: text("payment_ref"),
});

// =========================================================================
// Capital Calls
// =========================================================================

export const capitalCalls = pgTable("capital_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  callDate: date("call_date").notNull(),
  dueDate: date("due_date"),
  amountPerUnit: numeric("amount_per_unit", { precision: 18, scale: 2 }),
  totalCalled: numeric("total_called", { precision: 18, scale: 2 }).notNull(),
  totalReceived: numeric("total_received", { precision: 18, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("open"), // open | closed
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const capitalCallResponses = pgTable("capital_call_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  capitalCallId: uuid("capital_call_id")
    .notNull()
    .references(() => capitalCalls.id, { onDelete: "cascade" }),
  investorId: uuid("investor_id").notNull().references(() => investors.id, { onDelete: "restrict" }),
  amountCalled: numeric("amount_called", { precision: 18, scale: 2 }).notNull(),
  amountReceived: numeric("amount_received", { precision: 18, scale: 2 }).notNull().default("0"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
});

// =========================================================================
// Documents
// =========================================================================

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull().default("other"), // ppm | subscription_agreement | k1 | report | other
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
  investorId: uuid("investor_id").references(() => investors.id, { onDelete: "set null" }),
  storageKey: text("storage_key").notNull(),
  sizeBytes: integer("size_bytes"),
  mimeType: text("mime_type"),
  requiresSignature: boolean("requires_signature").notNull().default(false),
  signStatus: text("sign_status").notNull().default("not_required"), // not_required | pending | completed
  signProviderId: text("sign_provider_id"),
  uploadedBy: text("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  visibleToLp: boolean("visible_to_lp").notNull().default(false),
});

// =========================================================================
// Tasks
// =========================================================================

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: date("due_date"),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  investorId: uuid("investor_id").references(() => investors.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("open"), // open | in_progress | done
  priority: text("priority").notNull().default("medium"), // low | medium | high
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =========================================================================
// Communications
// =========================================================================

export const communications = pgTable(
  "communications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investorId: uuid("investor_id").references(() => investors.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("email"), // email | call | sms | meeting | note
    subject: text("subject"),
    body: text("body"),
    direction: text("direction"), // inbound | outbound
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    loggedBy: text("logged_by").notNull().default("gp_manual"), // gmail_sync | bcc_ingest | system | gp_manual
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    gmailMsgUnique: unique("communications_gmail_message_id_key").on(t.gmailMessageId),
  })
);

// =========================================================================
// Gmail Sync Config (access/refresh tokens encrypted — PRD §5.8 / §11.1)
// =========================================================================

export const gmailSyncConfig = pgTable("gmail_sync_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  gpUserId: uuid("gp_user_id").notNull().references(() => gpUsers.id, { onDelete: "cascade" }),
  gpEmail: text("gp_email").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
  scope: text("scope"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  syncErrors: text("sync_errors").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =========================================================================
// Audit Log (append-only — PRD §11.4)
// =========================================================================

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tableName: text("table_name").notNull(),
  recordId: uuid("record_id"),
  action: text("action").notNull(), // INSERT | UPDATE | DELETE
  changedBy: uuid("changed_by"),
  changedByRole: text("changed_by_role").notNull(), // gp | lp | system | gmail_sync
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

// =========================================================================
// Financial Events — immutable ledger (Phase 2)
// =========================================================================
//
// Append-only depot. The app NEVER issues UPDATE or DELETE against this
// table. Every financial mutation (distribution.markPaid, capital-call
// recordReceipt, etc.) writes one row per leg of the transaction in the
// same DB transaction as the primary record write.
//
// FK onDelete: restrict everywhere. If any parent row (deal/investor/
// position) is referenced by a financial event, Postgres rejects the
// delete. This prevents retroactive rewriting of financial history.
//
// In production, the app's DB role should be granted INSERT-only (no
// UPDATE/DELETE/TRUNCATE) on this table.
export const financialEvents = pgTable("financial_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(), // capital_funded | distribution_paid | pref_paid | capital_returned | profit_split
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "restrict" }),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id, { onDelete: "restrict" }),
  positionId: uuid("position_id")
    .notNull()
    .references(() => positions.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // always positive
  effectiveDate: date("effective_date").notNull(),
  referenceId: uuid("reference_id").notNull(),
  referenceTable: text("reference_table").notNull(),
  memo: text("memo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
});

// =========================================================================
// Relations
// =========================================================================

export const dealsRelations = relations(deals, ({ many, one }) => ({
  positions: many(positions),
  distributions: many(distributions),
  capitalCalls: many(capitalCalls),
  documents: many(documents),
  waterfall: one(waterfallConfigs),
}));

export const investorsRelations = relations(investors, ({ many }) => ({
  positions: many(positions),
  documents: many(documents),
  communications: many(communications),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  deal: one(deals, { fields: [positions.dealId], references: [deals.id] }),
  investor: one(investors, { fields: [positions.investorId], references: [investors.id] }),
}));

export const distributionsRelations = relations(distributions, ({ many, one }) => ({
  lineItems: many(distributionLineItems),
  deal: one(deals, { fields: [distributions.dealId], references: [deals.id] }),
}));

export const distributionLineItemsRelations = relations(distributionLineItems, ({ one }) => ({
  distribution: one(distributions, {
    fields: [distributionLineItems.distributionId],
    references: [distributions.id],
  }),
  investor: one(investors, {
    fields: [distributionLineItems.investorId],
    references: [investors.id],
  }),
  position: one(positions, {
    fields: [distributionLineItems.positionId],
    references: [positions.id],
  }),
}));

export const capitalCallsRelations = relations(capitalCalls, ({ many, one }) => ({
  responses: many(capitalCallResponses),
  deal: one(deals, { fields: [capitalCalls.dealId], references: [deals.id] }),
}));

export const waterfallConfigsRelations = relations(waterfallConfigs, ({ one }) => ({
  deal: one(deals, { fields: [waterfallConfigs.dealId], references: [deals.id] }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  deal: one(deals, { fields: [documents.dealId], references: [deals.id] }),
  investor: one(investors, { fields: [documents.investorId], references: [investors.id] }),
}));

export const communicationsRelations = relations(communications, ({ one }) => ({
  deal: one(deals, { fields: [communications.dealId], references: [deals.id] }),
  investor: one(investors, { fields: [communications.investorId], references: [investors.id] }),
}));

// =========================================================================
// Zod schemas (for validators in middleware/routes)
// =========================================================================

export const insertDealSchema = createInsertSchema(deals).omit({
  id: true,
  createdAt: true,
  equityRaised: true,
});
export const updateDealSchema = insertDealSchema.partial();

export const insertInvestorSchema = createInsertSchema(investors).omit({
  id: true,
  createdAt: true,
  addressEnc: true,
  ssnEinLast4Enc: true,
});
export const updateInvestorSchema = insertInvestorSchema.partial();

export const insertPositionSchema = createInsertSchema(positions).omit({
  id: true,
  createdAt: true,
});

export const selectInvestorSchema = createSelectSchema(investors);
export const selectDealSchema = createSelectSchema(deals);

// =========================================================================
// Type exports
// =========================================================================

export type GpUser = typeof gpUsers.$inferSelect;
export type Investor = typeof investors.$inferSelect;
export type NewInvestor = typeof investors.$inferInsert;
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type Position = typeof positions.$inferSelect;
export type Distribution = typeof distributions.$inferSelect;
export type Communication = typeof communications.$inferSelect;
export type NewCommunication = typeof communications.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferInsert;
export type GmailSyncConfig = typeof gmailSyncConfig.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type MagicLink = typeof magicLinks.$inferSelect;
export type WaterfallConfig = typeof waterfallConfigs.$inferSelect;
export type NewWaterfallConfig = typeof waterfallConfigs.$inferInsert;
export type NewDistribution = typeof distributions.$inferInsert;
export type DistributionLineItem = typeof distributionLineItems.$inferSelect;
export type NewDistributionLineItem = typeof distributionLineItems.$inferInsert;
export type CapitalCall = typeof capitalCalls.$inferSelect;
export type NewCapitalCall = typeof capitalCalls.$inferInsert;
export type CapitalCallResponse = typeof capitalCallResponses.$inferSelect;
export type NewCapitalCallResponse = typeof capitalCallResponses.$inferInsert;
export type FinancialEvent = typeof financialEvents.$inferSelect;
export type NewFinancialEvent = typeof financialEvents.$inferInsert;

export type FinancialEventType =
  | "capital_funded"
  | "distribution_paid"
  | "pref_paid"
  | "capital_returned"
  | "profit_split";
