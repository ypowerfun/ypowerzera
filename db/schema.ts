import { sql } from "drizzle-orm";

import { sqliteTable, text, integer, index, uniqueIndex, foreignKey } from 'drizzle-orm/sqlite-core';
export const tournaments = sqliteTable('tournaments', {
 id: text('id').primaryKey(), data: text('data').notNull(),
 version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(),
}, t => [index('idx_tournaments_created_at').on(t.createdAt)]);
export const recoveryChallenges = sqliteTable('recovery_challenges', {
 id: text('id').primaryKey(), tournamentId: text('tournament_id').notNull(), teamId: text('team_id'),
 email: text('email').notNull(), tokenHash: text('token_hash'), codeHash: text('code_hash').notNull(),
 expiresAt: integer('expires_at').notNull(), attempts: integer('attempts').notNull().default(0), consumed: integer('consumed').notNull().default(0),
}, t => [index('idx_recovery_email').on(t.tournamentId,t.email),index('idx_recovery_expiry').on(t.expiresAt)]);
export const recoveryLimits = sqliteTable('recovery_limits', {
 id: text('id').primaryKey(), count: integer('count').notNull(), expiresAt: integer('expires_at').notNull(),
}, t => [index('idx_recovery_limits_expiry').on(t.expiresAt)]);
export const viradaoEvents = sqliteTable('viradao_events', {
 id: text('id').primaryKey(), title: text('title').notNull(), startsAt: text('starts_at').notNull(),
 createdAt: text('created_at').notNull(),
}, t => [index('idx_viradao_events_date').on(t.startsAt)]);
export const viradaoParticipants = sqliteTable('viradao_participants', {
 id: text('id').primaryKey(), eventId: text('event_id').notNull().references(()=>viradaoEvents.id),
 name: text('name').notNull(), nick: text('nick').notNull(), payment: text('payment').notNull().default('unpaid'),
 receiptKey: text('receipt_key'), receiptType: text('receipt_type'),
 removedAt: text('removed_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
 version: integer('version').notNull().default(1),
}, t => [index('idx_viradao_participants_event').on(t.eventId,t.createdAt)]);

export const paAuditLog = sqliteTable("AuditLog", {
  "id": text("id").primaryKey().notNull(),
  "actorId": text("actorId"),
  "action": text("action").notNull(),
  "entity": text("entity").notNull(),
  "entityId": text("entityId").notNull(),
  "meta": text("meta"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  index("AuditLog_actorId_idx").on(t["actorId"]),
  index("AuditLog_entity_entityId_idx").on(t["entity"],t["entityId"]),
]);

export const paAuthToken = sqliteTable("AuthToken", {
  "id": text("id").primaryKey().notNull(),
  "userId": text("userId").notNull(),
  "type": text("type").notNull(),
  "tokenHash": text("tokenHash").notNull(),
  "expiresAt": integer("expiresAt").notNull(),
  "usedAt": integer("usedAt"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  index("AuthToken_userId_type_idx").on(t["userId"],t["type"]),
  uniqueIndex("AuthToken_tokenHash_key").on(t["tokenHash"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "AuthToken_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paBrGame = sqliteTable("BrGame", {
  "id": text("id").primaryKey().notNull(),
  "stageId": text("stageId").notNull(),
  "round": integer("round").notNull(),
  "lobby": integer("lobby").notNull().default(1),
  "participantIds": text("participantIds").notNull(),
  "code": text("code"),
  "scheduledAt": integer("scheduledAt"),
  "completedAt": integer("completedAt"),
}, t => [
  uniqueIndex("BrGame_stageId_round_lobby_key").on(t["stageId"],t["round"],t["lobby"]),
  foreignKey({ columns: [t["stageId"]], foreignColumns: [paStage["id"]], name: "BrGame_stageId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paBrResult = sqliteTable("BrResult", {
  "id": text("id").primaryKey().notNull(),
  "gameId": text("gameId").notNull(),
  "participantId": text("participantId").notNull(),
  "placement": integer("placement").notNull(),
  "kills": integer("kills").notNull().default(0),
}, t => [
  uniqueIndex("BrResult_gameId_participantId_key").on(t["gameId"],t["participantId"]),
  index("BrResult_participantId_idx").on(t["participantId"]),
  foreignKey({ columns: [t["participantId"]], foreignColumns: [paParticipant["id"]], name: "BrResult_participantId_fkey" }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t["gameId"]], foreignColumns: [paBrGame["id"]], name: "BrResult_gameId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paChallenge = sqliteTable("Challenge", {
  "id": text("id").primaryKey().notNull(),
  "gameId": text("gameId").notNull(),
  "modeId": text("modeId").notNull(),
  "bestOf": integer("bestOf").notNull().default(1),
  "stakeCents": integer("stakeCents").notNull(),
  "feeBps": integer("feeBps").notNull(),
  "feeCents": integer("feeCents").notNull().default(0),
  "status": text("status").notNull().default("OPEN"),
  "creatorTeamId": text("creatorTeamId").notNull(),
  "creatorUserId": text("creatorUserId").notNull(),
  "opponentTeamId": text("opponentTeamId"),
  "opponentUserId": text("opponentUserId"),
  "invitedTeamId": text("invitedTeamId"),
  "creatorLineup": text("creatorLineup").notNull(),
  "opponentLineup": text("opponentLineup"),
  "notes": text("notes"),
  "expiresAt": integer("expiresAt").notNull(),
  "acceptedAt": integer("acceptedAt"),
  "reportedBy": text("reportedBy"),
  "reportedWinner": text("reportedWinner"),
  "reportedAt": integer("reportedAt"),
  "autoSettleAt": integer("autoSettleAt"),
  "evidenceA": text("evidenceA"),
  "evidenceB": text("evidenceB"),
  "disputeReason": text("disputeReason"),
  "winnerTeamId": text("winnerTeamId"),
  "settledAt": integer("settledAt"),
  "resolvedById": text("resolvedById"),
  "resolutionNote": text("resolutionNote"),
  "riskFlags": text("riskFlags"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "updatedAt": integer("updatedAt").notNull(),
}, t => [
  index("Challenge_opponentTeamId_idx").on(t["opponentTeamId"]),
  index("Challenge_creatorTeamId_idx").on(t["creatorTeamId"]),
  index("Challenge_status_createdAt_idx").on(t["status"],t["createdAt"]),
  foreignKey({ columns: [t["opponentTeamId"]], foreignColumns: [paTeam["id"]], name: "Challenge_opponentTeamId_fkey" }).onDelete("set null").onUpdate("cascade"),
  foreignKey({ columns: [t["creatorTeamId"]], foreignColumns: [paTeam["id"]], name: "Challenge_creatorTeamId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);

export const paChatGPTIdentity = sqliteTable("ChatGPTIdentity", {
  "subject": text("subject").primaryKey().notNull(),
  "userId": text("userId").notNull(),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  uniqueIndex("ChatGPTIdentity_userId_key").on(t["userId"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "ChatGPTIdentity_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paCoupon = sqliteTable("Coupon", {
  "id": text("id").primaryKey().notNull(),
  "code": text("code").notNull(),
  "orgId": text("orgId"),
  "tournamentId": text("tournamentId"),
  "percentOff": integer("percentOff"),
  "amountOffCents": integer("amountOffCents"),
  "maxRedemptions": integer("maxRedemptions"),
  "redeemed": integer("redeemed").notNull().default(0),
  "expiresAt": integer("expiresAt"),
  "active": integer("active").notNull().default(sql`true`),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  uniqueIndex("Coupon_code_key").on(t["code"]),
  foreignKey({ columns: [t["tournamentId"]], foreignColumns: [paTournament["id"]], name: "Coupon_tournamentId_fkey" }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t["orgId"]], foreignColumns: [paOrganization["id"]], name: "Coupon_orgId_fkey" }).onDelete("set null").onUpdate("cascade"),
]);

export const paDeposit = sqliteTable("Deposit", {
  "id": text("id").primaryKey().notNull(),
  "walletId": text("walletId").notNull(),
  "teamId": text("teamId").notNull(),
  "userId": text("userId").notNull(),
  "amountCents": integer("amountCents").notNull(),
  "status": text("status").notNull().default("PENDING"),
  "provider": text("provider").notNull(),
  "providerChargeId": text("providerChargeId"),
  "pixCopyPaste": text("pixCopyPaste"),
  "pixQrImage": text("pixQrImage"),
  "expiresAt": integer("expiresAt").notNull(),
  "confirmedAt": integer("confirmedAt"),
  "payerDocHash": text("payerDocHash"),
  "holdReason": text("holdReason"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "updatedAt": integer("updatedAt").notNull(),
}, t => [
  index("Deposit_userId_createdAt_idx").on(t["userId"],t["createdAt"]),
  index("Deposit_walletId_status_idx").on(t["walletId"],t["status"]),
  uniqueIndex("Deposit_providerChargeId_key").on(t["providerChargeId"]),
  foreignKey({ columns: [t["walletId"]], foreignColumns: [paWallet["id"]], name: "Deposit_walletId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);

export const paGameAccount = sqliteTable("GameAccount", {
  "id": text("id").primaryKey().notNull(),
  "userId": text("userId").notNull(),
  "gameId": text("gameId").notNull(),
  "handle": text("handle").notNull(),
  "data": text("data").notNull(),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "updatedAt": integer("updatedAt").notNull(),
}, t => [
  uniqueIndex("GameAccount_gameId_handle_key").on(t["gameId"],t["handle"]),
  uniqueIndex("GameAccount_userId_gameId_key").on(t["userId"],t["gameId"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "GameAccount_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paKycProfile = sqliteTable("KycProfile", {
  "id": text("id").primaryKey().notNull(),
  "userId": text("userId").notNull(),
  "fullName": text("fullName").notNull(),
  "cpfHash": text("cpfHash").notNull(),
  "cpfEnc": text("cpfEnc").notNull(),
  "cpfLast4": text("cpfLast4").notNull(),
  "birthDate": integer("birthDate").notNull(),
  "status": text("status").notNull().default("PENDING"),
  "submittedAt": integer("submittedAt").notNull().default(sql`(unixepoch() * 1000)`),
  "reviewedAt": integer("reviewedAt"),
  "reviewedById": text("reviewedById"),
  "rejectReason": text("rejectReason"),
}, t => [
  uniqueIndex("KycProfile_cpfHash_key").on(t["cpfHash"]),
  uniqueIndex("KycProfile_userId_key").on(t["userId"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "KycProfile_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paLedgerEntry = sqliteTable("LedgerEntry", {
  "id": text("id").primaryKey().notNull(),
  "walletId": text("walletId").notNull(),
  "type": text("type").notNull(),
  "availableDeltaCents": integer("availableDeltaCents").notNull(),
  "lockedDeltaCents": integer("lockedDeltaCents").notNull().default(0),
  "balanceAfterCents": integer("balanceAfterCents").notNull(),
  "lockedAfterCents": integer("lockedAfterCents").notNull(),
  "refType": text("refType").notNull(),
  "refId": text("refId").notNull(),
  "idempotencyKey": text("idempotencyKey").notNull(),
  "memo": text("memo"),
  "actorId": text("actorId"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  index("LedgerEntry_refType_refId_idx").on(t["refType"],t["refId"]),
  index("LedgerEntry_walletId_createdAt_idx").on(t["walletId"],t["createdAt"]),
  uniqueIndex("LedgerEntry_idempotencyKey_key").on(t["idempotencyKey"]),
  foreignKey({ columns: [t["walletId"]], foreignColumns: [paWallet["id"]], name: "LedgerEntry_walletId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);

export const paMatch = sqliteTable("Match", {
  "id": text("id").primaryKey().notNull(),
  "stageId": text("stageId").notNull(),
  "key": text("key").notNull(),
  "bracket": text("bracket").notNull(),
  "round": integer("round").notNull(),
  "position": integer("position").notNull(),
  "group": integer("group"),
  "bestOf": integer("bestOf").notNull().default(1),
  "slotA": text("slotA").notNull(),
  "slotB": text("slotB").notNull(),
  "onlyIfWinner": text("onlyIfWinner"),
  "status": text("status").notNull().default("PENDING"),
  "participantAId": text("participantAId"),
  "participantBId": text("participantBId"),
  "scoreA": integer("scoreA"),
  "scoreB": integer("scoreB"),
  "winnerSide": text("winnerSide"),
  "forfeit": text("forfeit"),
  "scheduledAt": integer("scheduledAt"),
  "reportA": text("reportA"),
  "reportB": text("reportB"),
  "notes": text("notes"),
  "vetoState": text("vetoState"),
  "games": text("games"),
  "completedAt": integer("completedAt"),
}, t => [
  uniqueIndex("Match_stageId_key_key").on(t["stageId"],t["key"]),
  index("Match_participantBId_idx").on(t["participantBId"]),
  index("Match_participantAId_idx").on(t["participantAId"]),
  index("Match_stageId_round_idx").on(t["stageId"],t["round"]),
  foreignKey({ columns: [t["participantBId"]], foreignColumns: [paParticipant["id"]], name: "Match_participantBId_fkey" }).onDelete("set null").onUpdate("cascade"),
  foreignKey({ columns: [t["participantAId"]], foreignColumns: [paParticipant["id"]], name: "Match_participantAId_fkey" }).onDelete("set null").onUpdate("cascade"),
  foreignKey({ columns: [t["stageId"]], foreignColumns: [paStage["id"]], name: "Match_stageId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paMatchDispute = sqliteTable("MatchDispute", {
  "id": text("id").primaryKey().notNull(),
  "matchId": text("matchId").notNull(),
  "openedById": text("openedById").notNull(),
  "reason": text("reason").notNull(),
  "status": text("status").notNull().default("OPEN"),
  "resolution": text("resolution"),
  "resolvedById": text("resolvedById"),
  "resolvedAt": integer("resolvedAt"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  index("MatchDispute_status_idx").on(t["status"]),
  index("MatchDispute_matchId_idx").on(t["matchId"]),
  foreignKey({ columns: [t["matchId"]], foreignColumns: [paMatch["id"]], name: "MatchDispute_matchId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paMockPixCharge = sqliteTable("MockPixCharge", {
  "id": text("id").primaryKey().notNull(),
  "amountCents": integer("amountCents").notNull(),
  "status": text("status").notNull().default("PENDING"),
  "payerDoc": text("payerDoc"),
  "externalReference": text("externalReference").notNull(),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
]);

export const paMockPixTransfer = sqliteTable("MockPixTransfer", {
  "id": text("id").primaryKey().notNull(),
  "amountCents": integer("amountCents").notNull(),
  "status": text("status").notNull().default("PENDING"),
  "pixKey": text("pixKey").notNull(),
  "externalReference": text("externalReference").notNull(),
  "endToEndId": text("endToEndId"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  uniqueIndex("MockPixTransfer_externalReference_key").on(t["externalReference"]),
]);

export const paNotification = sqliteTable("Notification", {
  "id": text("id").primaryKey().notNull(),
  "userId": text("userId").notNull(),
  "kind": text("kind").notNull(),
  "title": text("title").notNull(),
  "body": text("body").notNull(),
  "href": text("href"),
  "readAt": integer("readAt"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  index("Notification_userId_readAt_idx").on(t["userId"],t["readAt"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "Notification_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paOrder = sqliteTable("Order", {
  "id": text("id").primaryKey().notNull(),
  "number": text("number").notNull(),
  "userId": text("userId").notNull(),
  "tournamentId": text("tournamentId").notNull(),
  "participantId": text("participantId"),
  "status": text("status").notNull().default("PENDING"),
  "currency": text("currency").notNull().default("BRL"),
  "subtotalCents": integer("subtotalCents").notNull(),
  "serviceFeeCents": integer("serviceFeeCents").notNull().default(0),
  "discountCents": integer("discountCents").notNull().default(0),
  "totalCents": integer("totalCents").notNull(),
  "couponId": text("couponId"),
  "provider": text("provider").notNull(),
  "providerSessionId": text("providerSessionId"),
  "providerPaymentId": text("providerPaymentId"),
  "method": text("method"),
  "paidAt": integer("paidAt"),
  "expiresAt": integer("expiresAt").notNull(),
  "refundedCents": integer("refundedCents").notNull().default(0),
  "failureReason": text("failureReason"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "updatedAt": integer("updatedAt").notNull(),
}, t => [
  index("Order_providerSessionId_idx").on(t["providerSessionId"]),
  index("Order_tournamentId_status_idx").on(t["tournamentId"],t["status"]),
  index("Order_userId_idx").on(t["userId"]),
  uniqueIndex("Order_number_key").on(t["number"]),
  foreignKey({ columns: [t["couponId"]], foreignColumns: [paCoupon["id"]], name: "Order_couponId_fkey" }).onDelete("set null").onUpdate("cascade"),
  foreignKey({ columns: [t["participantId"]], foreignColumns: [paParticipant["id"]], name: "Order_participantId_fkey" }).onDelete("set null").onUpdate("cascade"),
  foreignKey({ columns: [t["tournamentId"]], foreignColumns: [paTournament["id"]], name: "Order_tournamentId_fkey" }).onDelete("restrict").onUpdate("cascade"),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "Order_userId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);

export const paOrgMember = sqliteTable("OrgMember", {
  "id": text("id").primaryKey().notNull(),
  "orgId": text("orgId").notNull(),
  "userId": text("userId").notNull(),
  "role": text("role").notNull().default("STAFF"),
}, t => [
  uniqueIndex("OrgMember_orgId_userId_key").on(t["orgId"],t["userId"]),
  index("OrgMember_userId_idx").on(t["userId"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "OrgMember_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t["orgId"]], foreignColumns: [paOrganization["id"]], name: "OrgMember_orgId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paOrganization = sqliteTable("Organization", {
  "id": text("id").primaryKey().notNull(),
  "slug": text("slug").notNull(),
  "name": text("name").notNull(),
  "description": text("description"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "deletedAt": integer("deletedAt"),
}, t => [
  uniqueIndex("Organization_slug_key").on(t["slug"]),
]);

export const paParticipant = sqliteTable("Participant", {
  "id": text("id").primaryKey().notNull(),
  "tournamentId": text("tournamentId").notNull(),
  "userId": text("userId").notNull(),
  "teamId": text("teamId"),
  "name": text("name").notNull(),
  "tag": text("tag"),
  "status": text("status").notNull().default("REGISTERED"),
  "seed": integer("seed"),
  "rating": integer("rating"),
  "roster": text("roster").notNull(),
  "customAnswers": text("customAnswers"),
  "reservedUntil": integer("reservedUntil"),
  "registeredAt": integer("registeredAt").notNull().default(sql`(unixepoch() * 1000)`),
  "checkedInAt": integer("checkedInAt"),
  "withdrawnAt": integer("withdrawnAt"),
  "dqReason": text("dqReason"),
  "finalPlacement": integer("finalPlacement"),
}, t => [
  uniqueIndex("Participant_tournamentId_userId_key").on(t["tournamentId"],t["userId"]),
  index("Participant_tournamentId_status_idx").on(t["tournamentId"],t["status"]),
  foreignKey({ columns: [t["teamId"]], foreignColumns: [paTeam["id"]], name: "Participant_teamId_fkey" }).onDelete("set null").onUpdate("cascade"),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "Participant_userId_fkey" }).onDelete("restrict").onUpdate("cascade"),
  foreignKey({ columns: [t["tournamentId"]], foreignColumns: [paTournament["id"]], name: "Participant_tournamentId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paPaymentEvent = sqliteTable("PaymentEvent", {
  "id": text("id").primaryKey().notNull(),
  "provider": text("provider").notNull(),
  "eventId": text("eventId").notNull(),
  "type": text("type").notNull(),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  uniqueIndex("PaymentEvent_provider_eventId_key").on(t["provider"],t["eventId"]),
]);

export const paPrizeAward = sqliteTable("PrizeAward", {
  "id": text("id").primaryKey().notNull(),
  "tournamentId": text("tournamentId").notNull(),
  "participantId": text("participantId").notNull(),
  "placement": integer("placement").notNull(),
  "label": text("label").notNull(),
  "amountCents": integer("amountCents").notNull(),
  "status": text("status").notNull().default("PENDING"),
  "paidAt": integer("paidAt"),
  "note": text("note"),
}, t => [
  uniqueIndex("PrizeAward_tournamentId_participantId_key").on(t["tournamentId"],t["participantId"]),
  index("PrizeAward_tournamentId_idx").on(t["tournamentId"]),
  foreignKey({ columns: [t["participantId"]], foreignColumns: [paParticipant["id"]], name: "PrizeAward_participantId_fkey" }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t["tournamentId"]], foreignColumns: [paTournament["id"]], name: "PrizeAward_tournamentId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paRateLimit = sqliteTable("RateLimit", {
  "key": text("key").primaryKey().notNull(),
  "count": integer("count").notNull(),
  "resetAt": integer("resetAt").notNull(),
}, t => [
]);

export const paRefund = sqliteTable("Refund", {
  "id": text("id").primaryKey().notNull(),
  "orderId": text("orderId").notNull(),
  "amountCents": integer("amountCents").notNull(),
  "reason": text("reason").notNull(),
  "providerRefundId": text("providerRefundId"),
  "createdById": text("createdById"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  index("Refund_orderId_idx").on(t["orderId"]),
  foreignKey({ columns: [t["orderId"]], foreignColumns: [paOrder["id"]], name: "Refund_orderId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paRosterEntry = sqliteTable("RosterEntry", {
  "id": text("id").primaryKey().notNull(),
  "participantId": text("participantId").notNull(),
  "tournamentId": text("tournamentId").notNull(),
  "userId": text("userId").notNull(),
  "role": text("role").notNull(),
}, t => [
  uniqueIndex("RosterEntry_tournamentId_userId_key").on(t["tournamentId"],t["userId"]),
  index("RosterEntry_participantId_idx").on(t["participantId"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "RosterEntry_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t["participantId"]], foreignColumns: [paParticipant["id"]], name: "RosterEntry_participantId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paSession = sqliteTable("Session", {
  "id": text("id").primaryKey().notNull(),
  "userId": text("userId").notNull(),
  "expiresAt": integer("expiresAt").notNull(),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "lastUsedAt": integer("lastUsedAt").notNull().default(sql`(unixepoch() * 1000)`),
  "userAgent": text("userAgent"),
  "ip": text("ip"),
}, t => [
  index("Session_expiresAt_idx").on(t["expiresAt"]),
  index("Session_userId_idx").on(t["userId"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "Session_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paSiteSetting = sqliteTable("SiteSetting", {
  "key": text("key").primaryKey().notNull(),
  "value": text("value").notNull(),
  "updatedAt": integer("updatedAt").notNull(),
  "updatedById": text("updatedById"),
}, t => [
]);

export const paStage = sqliteTable("Stage", {
  "id": text("id").primaryKey().notNull(),
  "tournamentId": text("tournamentId").notNull(),
  "order": integer("order").notNull(),
  "name": text("name").notNull(),
  "type": text("type").notNull(),
  "settings": text("settings").notNull(),
  "status": text("status").notNull().default("PENDING"),
  "seedOrder": text("seedOrder"),
  "groups": text("groups"),
  "startedAt": integer("startedAt"),
  "completedAt": integer("completedAt"),
}, t => [
  uniqueIndex("Stage_tournamentId_order_key").on(t["tournamentId"],t["order"]),
  foreignKey({ columns: [t["tournamentId"]], foreignColumns: [paTournament["id"]], name: "Stage_tournamentId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paTeam = sqliteTable("Team", {
  "id": text("id").primaryKey().notNull(),
  "slug": text("slug").notNull(),
  "name": text("name").notNull(),
  "tag": text("tag").notNull(),
  "gameId": text("gameId"),
  "description": text("description"),
  "ownerId": text("ownerId").notNull(),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "deletedAt": integer("deletedAt"),
  "deletedById": text("deletedById"),
  "balanceReleasedAt": integer("balanceReleasedAt"),
}, t => [
  uniqueIndex("Team_slug_key").on(t["slug"]),
  foreignKey({ columns: [t["ownerId"]], foreignColumns: [paUser["id"]], name: "Team_ownerId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);

export const paTeamInvite = sqliteTable("TeamInvite", {
  "id": text("id").primaryKey().notNull(),
  "teamId": text("teamId").notNull(),
  "invitedById": text("invitedById").notNull(),
  "userId": text("userId"),
  "role": text("role").notNull().default("PLAYER"),
  "token": text("token").notNull(),
  "status": text("status").notNull().default("PENDING"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "expiresAt": integer("expiresAt").notNull(),
}, t => [
  index("TeamInvite_userId_idx").on(t["userId"]),
  index("TeamInvite_teamId_idx").on(t["teamId"]),
  uniqueIndex("TeamInvite_token_key").on(t["token"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "TeamInvite_userId_fkey" }).onDelete("set null").onUpdate("cascade"),
  foreignKey({ columns: [t["invitedById"]], foreignColumns: [paUser["id"]], name: "TeamInvite_invitedById_fkey" }).onDelete("restrict").onUpdate("cascade"),
  foreignKey({ columns: [t["teamId"]], foreignColumns: [paTeam["id"]], name: "TeamInvite_teamId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paTeamMember = sqliteTable("TeamMember", {
  "id": text("id").primaryKey().notNull(),
  "teamId": text("teamId").notNull(),
  "userId": text("userId").notNull(),
  "role": text("role").notNull().default("PLAYER"),
  "joinedAt": integer("joinedAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  uniqueIndex("TeamMember_teamId_userId_key").on(t["teamId"],t["userId"]),
  index("TeamMember_userId_idx").on(t["userId"]),
  foreignKey({ columns: [t["userId"]], foreignColumns: [paUser["id"]], name: "TeamMember_userId_fkey" }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t["teamId"]], foreignColumns: [paTeam["id"]], name: "TeamMember_teamId_fkey" }).onDelete("cascade").onUpdate("cascade"),
]);

export const paTournament = sqliteTable("Tournament", {
  "id": text("id").primaryKey().notNull(),
  "orgId": text("orgId").notNull(),
  "slug": text("slug").notNull(),
  "name": text("name").notNull(),
  "gameId": text("gameId").notNull(),
  "modeId": text("modeId").notNull(),
  "presetId": text("presetId"),
  "status": text("status").notNull().default("DRAFT"),
  "visibility": text("visibility").notNull().default("PUBLIC"),
  "summary": text("summary"),
  "description": text("description"),
  "rules": text("rules"),
  "region": text("region"),
  "platform": text("platform"),
  "timezone": text("timezone").notNull().default("America/Sao_Paulo"),
  "coverUrl": text("coverUrl"),
  "streamUrl": text("streamUrl"),
  "discordUrl": text("discordUrl"),
  "startsAt": integer("startsAt").notNull(),
  "registrationOpensAt": integer("registrationOpensAt"),
  "registrationClosesAt": integer("registrationClosesAt"),
  "checkInOpensAt": integer("checkInOpensAt"),
  "checkInClosesAt": integer("checkInClosesAt"),
  "minParticipants": integer("minParticipants").notNull().default(2),
  "maxParticipants": integer("maxParticipants").notNull(),
  "teamSize": integer("teamSize").notNull().default(1),
  "maxSubs": integer("maxSubs").notNull().default(0),
  "entryFeeCents": integer("entryFeeCents").notNull().default(0),
  "currency": text("currency").notNull().default("BRL"),
  "prizePoolCents": integer("prizePoolCents").notNull().default(0),
  "prizeSplit": text("prizeSplit"),
  "allowPlayerReporting": integer("allowPlayerReporting").notNull().default(sql`true`),
  "requireCheckIn": integer("requireCheckIn").notNull().default(sql`true`),
  "seedingMethod": text("seedingMethod").notNull().default("RANDOM"),
  "seedSalt": text("seedSalt").notNull(),
  "customFields": text("customFields"),
  "mapPool": text("mapPool"),
  "publishedAt": integer("publishedAt"),
  "startedAt": integer("startedAt"),
  "completedAt": integer("completedAt"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "updatedAt": integer("updatedAt").notNull(),
}, t => [
  index("Tournament_orgId_idx").on(t["orgId"]),
  index("Tournament_gameId_idx").on(t["gameId"]),
  index("Tournament_status_startsAt_idx").on(t["status"],t["startsAt"]),
  uniqueIndex("Tournament_slug_key").on(t["slug"]),
  foreignKey({ columns: [t["orgId"]], foreignColumns: [paOrganization["id"]], name: "Tournament_orgId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);

export const paUser = sqliteTable("User", {
  "id": text("id").primaryKey().notNull(),
  "email": text("email").notNull(),
  "username": text("username").notNull(),
  "displayName": text("displayName").notNull(),
  "passwordHash": text("passwordHash").notNull(),
  "role": text("role").notNull().default("USER"),
  "country": text("country"),
  "bio": text("bio"),
  "emailVerifiedAt": integer("emailVerifiedAt"),
  "bannedAt": integer("bannedAt"),
  "banReason": text("banReason"),
  "withdrawalLockedUntil": integer("withdrawalLockedUntil"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "updatedAt": integer("updatedAt").notNull(),
}, t => [
  uniqueIndex("User_username_key").on(t["username"]),
  uniqueIndex("User_email_key").on(t["email"]),
]);

export const paWallet = sqliteTable("Wallet", {
  "id": text("id").primaryKey().notNull(),
  "kind": text("kind").notNull().default("TEAM"),
  "teamId": text("teamId"),
  "balanceCents": integer("balanceCents").notNull().default(0),
  "lockedCents": integer("lockedCents").notNull().default(0),
  "debtCents": integer("debtCents").notNull().default(0),
  "version": integer("version").notNull().default(0),
  "frozenAt": integer("frozenAt"),
  "frozenReason": text("frozenReason"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  uniqueIndex("Wallet_teamId_key").on(t["teamId"]),
  foreignKey({ columns: [t["teamId"]], foreignColumns: [paTeam["id"]], name: "Wallet_teamId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);

export const paWalletReleaseRequest = sqliteTable("WalletReleaseRequest", {
  "id": text("id").primaryKey().notNull(),
  "teamId": text("teamId").notNull(),
  "walletId": text("walletId").notNull(),
  "requestedById": text("requestedById").notNull(),
  "message": text("message").notNull(),
  "balanceCents": integer("balanceCents").notNull(),
  "status": text("status").notNull().default("PENDING"),
  "reviewedById": text("reviewedById"),
  "reviewedAt": integer("reviewedAt"),
  "reviewNote": text("reviewNote"),
  "releasedCents": integer("releasedCents"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
}, t => [
  index("WalletReleaseRequest_teamId_idx").on(t["teamId"]),
  index("WalletReleaseRequest_status_createdAt_idx").on(t["status"],t["createdAt"]),
  foreignKey({ columns: [t["teamId"]], foreignColumns: [paTeam["id"]], name: "WalletReleaseRequest_teamId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);

export const paWithdrawal = sqliteTable("Withdrawal", {
  "id": text("id").primaryKey().notNull(),
  "walletId": text("walletId").notNull(),
  "teamId": text("teamId").notNull(),
  "requestedById": text("requestedById").notNull(),
  "amountCents": integer("amountCents").notNull(),
  "feeCents": integer("feeCents").notNull().default(0),
  "netCents": integer("netCents").notNull(),
  "status": text("status").notNull().default("PENDING_CONFIRMATION"),
  "destinationCpfLast4": text("destinationCpfLast4").notNull(),
  "requestNonce": text("requestNonce").notNull(),
  "otpHash": text("otpHash"),
  "otpExpiresAt": integer("otpExpiresAt"),
  "otpAttempts": integer("otpAttempts").notNull().default(0),
  "confirmedAt": integer("confirmedAt"),
  "riskScore": integer("riskScore").notNull().default(0),
  "riskFlags": text("riskFlags"),
  "reviewedById": text("reviewedById"),
  "reviewedAt": integer("reviewedAt"),
  "reviewNote": text("reviewNote"),
  "processAfter": integer("processAfter"),
  "provider": text("provider"),
  "providerTransferId": text("providerTransferId"),
  "endToEndId": text("endToEndId"),
  "paidAt": integer("paidAt"),
  "failureReason": text("failureReason"),
  "createdAt": integer("createdAt").notNull().default(sql`(unixepoch() * 1000)`),
  "updatedAt": integer("updatedAt").notNull(),
}, t => [
  uniqueIndex("Withdrawal_requestedById_requestNonce_key").on(t["requestedById"],t["requestNonce"]),
  index("Withdrawal_walletId_createdAt_idx").on(t["walletId"],t["createdAt"]),
  index("Withdrawal_status_processAfter_idx").on(t["status"],t["processAfter"]),
  uniqueIndex("Withdrawal_providerTransferId_key").on(t["providerTransferId"]),
  foreignKey({ columns: [t["walletId"]], foreignColumns: [paWallet["id"]], name: "Withdrawal_walletId_fkey" }).onDelete("restrict").onUpdate("cascade"),
]);
