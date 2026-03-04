import { env } from "cloudflare:workers";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

// ─── Table interfaces ───────────────────────────────────────────────

export interface UsersTable {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  passwordHash: string | null;
  authMethod: string;
  failedLoginAttempts: number;
  lockoutUntil: string | null;
  isPlatformAdmin: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface CredentialsTable {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  createdAt: string;
}

export interface OrganizationsTable {
  id: string;
  name: string;
  slug: string;
  type: string;
  hammerFeePct: number;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipsTable {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  isApproved: number;
  approvedAt: string | null;
  approvedByUserId: string | null;
  createdAt: string;
}

export interface DealerProfilesTable {
  id: string;
  organizationId: string;
  userId: string;
  companyName: string | null;
  taxId: string | null;
  resaleCertificateUrl: string | null;
  tier: string;
  creditTerms: string | null;
  depositRequiredCents: number | null;
  totalPurchasesCents: number;
  totalAuctionsParticipated: number;
  standing: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogsTable {
  id: string;
  organizationId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: string | null;
  createdAt: string;
}

export interface CategoriesTable {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProductsTable {
  id: string;
  organizationId: string;
  categoryId: string | null;
  sku: string | null;
  title: string;
  description: string | null;
  conditionType: string | null;
  retailPriceCents: number | null;
  quantity: number;
  quantityAvailable: number;
  isPerishable: number;
  expiryDate: string | null;
  coldChainRequired: number;
  storageTemp: string | null;
  handlingInstructions: string | null;
  imageUrls: string | null;
  thumbnailUrl: string | null;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  tags: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

export interface AuctionsTable {
  id: string;
  organizationId: string;
  type: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  scheduledStartAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  defaultIncrementCents: number;
  incrementRules: string | null;
  buyerPremiumPct: number;
  extensionSeconds: number;
  streamProviderId: string | null;
  streamUrl: string | null;
  auctioneerId: string | null;
  createdByUserId: string;
  clonedFromAuctionId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AuctionStateTransitionsTable {
  id: string;
  auctionId: string;
  fromStatus: string | null;
  toStatus: string;
  triggeredByUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface LotsTable {
  id: string;
  organizationId: string;
  auctionId: string;
  lotNumber: number;
  title: string;
  description: string | null;
  startingPriceCents: number;
  reservePriceCents: number | null;
  buyNowPriceCents: number | null;
  incrementCents: number | null;
  currentBidCents: number | null;
  currentBidderId: string | null;
  bidCount: number;
  status: string;
  quantity: number;
  extensionSeconds: number | null;
  closesAt: string | null;
  winnerUserId: string | null;
  winnerAmountCents: number | null;
  saleMode: string;
  quantityClaimed: number;
  maxClaimsPerUser: number | null;
  imageUrls: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface LotItemsTable {
  id: string;
  lotId: string;
  productId: string;
  quantity: number;
  sortOrder: number;
}

export interface BidEventsTable {
  id: string;
  organizationId: string;
  auctionId: string;
  lotId: string;
  userId: string;
  type: string;
  amountCents: number;
  previousHighCents: number | null;
  previousHighUserId: string | null;
  onBehalfOfName: string | null;
  placedByUserId: string | null;
  idempotencyKey: string;
  sequence: number;
  metadata: string | null;
  createdAt: string;
}

export interface ChatMessagesTable {
  id: string;
  organizationId: string;
  auctionId: string;
  userId: string;
  type: string;
  content: string;
  isModerated: number;
  moderatedByUserId: string | null;
  moderatedAt: string | null;
  createdAt: string;
}

export interface FeeConfigurationsTable {
  id: string;
  organizationId: string;
  name: string;
  feeType: string;
  calculationType: string;
  value: number | null;
  tieredRules: string | null;
  appliesToRole: string | null;
  appliesToAuctionType: string | null;
  isActive: number;
  effectiveDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrdersTable {
  id: string;
  organizationId: string;
  auctionId: string;
  lotId: string;
  userId: string;
  amountCents: number;
  premiumCents: number;
  platformFeeCents: number;
  status: string;
  invoiceId: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface InvoicesTable {
  id: string;
  organizationId: string;
  userId: string;
  auctionId: string;
  invoiceNumber: string;
  status: string;
  subtotalCents: number;
  buyerPremiumCents: number;
  taxCents: number;
  totalCents: number;
  stripePaymentLinkId: string | null;
  stripePaymentLinkUrl: string | null;
  paidAt: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface InvoiceLineItemsTable {
  id: string;
  invoiceId: string;
  orderId: string;
  lotId: string;
  description: string;
  amountCents: number;
  buyerPremiumCents: number;
  quantity: number;
}

export interface PickupSlotsTable {
  id: string;
  organizationId: string;
  date: string;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  currentBookings: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface PickupReservationsTable {
  id: string;
  organizationId: string;
  pickupSlotId: string;
  invoiceId: string;
  userId: string;
  status: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface StreamProvidersTable {
  id: string;
  organizationId: string;
  providerType: string;
  name: string;
  config: string | null;
  isDefault: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportJobsTable {
  id: string;
  organizationId: string;
  source: string;
  status: string;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  errorLog: string | null;
  config: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuctionSummariesTable {
  auctionId: string;
  organizationId: string;
  type: string;
  title: string;
  status: string;
  totalLots: number;
  activeLotNumber: number | null;
  totalBids: number;
  totalRevenueCents: number;
  viewerCount: number;
  scheduledStartAt: string | null;
  updatedAt: string;
}

// ─── Database interface ─────────────────────────────────────────────

export interface AppDatabase {
  users: UsersTable;
  credentials: CredentialsTable;
  organizations: OrganizationsTable;
  memberships: MembershipsTable;
  dealer_profiles: DealerProfilesTable;
  audit_logs: AuditLogsTable;
  categories: CategoriesTable;
  products: ProductsTable;
  auctions: AuctionsTable;
  auction_state_transitions: AuctionStateTransitionsTable;
  lots: LotsTable;
  lot_items: LotItemsTable;
  bid_events: BidEventsTable;
  chat_messages: ChatMessagesTable;
  fee_configurations: FeeConfigurationsTable;
  orders: OrdersTable;
  invoices: InvoicesTable;
  invoice_line_items: InvoiceLineItemsTable;
  pickup_slots: PickupSlotsTable;
  pickup_reservations: PickupReservationsTable;
  stream_providers: StreamProvidersTable;
  import_jobs: ImportJobsTable;
  auction_summaries: AuctionSummariesTable;
}

// ─── Type aliases ───────────────────────────────────────────────────

export type User = UsersTable;
export type Credential = CredentialsTable;
export type Organization = OrganizationsTable;
export type Membership = MembershipsTable;

// ─── Database instance ──────────────────────────────────────────────

export const db = new Kysely<AppDatabase>({
  dialect: new D1Dialect({ database: env.DB }),
});
