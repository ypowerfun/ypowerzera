CREATE TABLE `AuditLog` (
	`id` text PRIMARY KEY NOT NULL,
	`actorId` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entityId` text NOT NULL,
	`meta` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `AuditLog_actorId_idx` ON `AuditLog` (`actorId`);--> statement-breakpoint
CREATE INDEX `AuditLog_entity_entityId_idx` ON `AuditLog` (`entity`,`entityId`);--> statement-breakpoint
CREATE TABLE `AuthToken` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`usedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `AuthToken_userId_type_idx` ON `AuthToken` (`userId`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `AuthToken_tokenHash_key` ON `AuthToken` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `BrGame` (
	`id` text PRIMARY KEY NOT NULL,
	`stageId` text NOT NULL,
	`round` integer NOT NULL,
	`lobby` integer DEFAULT 1 NOT NULL,
	`participantIds` text NOT NULL,
	`code` text,
	`scheduledAt` integer,
	`completedAt` integer,
	FOREIGN KEY (`stageId`) REFERENCES `Stage`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `BrGame_stageId_round_lobby_key` ON `BrGame` (`stageId`,`round`,`lobby`);--> statement-breakpoint
CREATE TABLE `BrResult` (
	`id` text PRIMARY KEY NOT NULL,
	`gameId` text NOT NULL,
	`participantId` text NOT NULL,
	`placement` integer NOT NULL,
	`kills` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`participantId`) REFERENCES `Participant`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`gameId`) REFERENCES `BrGame`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `BrResult_gameId_participantId_key` ON `BrResult` (`gameId`,`participantId`);--> statement-breakpoint
CREATE INDEX `BrResult_participantId_idx` ON `BrResult` (`participantId`);--> statement-breakpoint
CREATE TABLE `Challenge` (
	`id` text PRIMARY KEY NOT NULL,
	`gameId` text NOT NULL,
	`modeId` text NOT NULL,
	`bestOf` integer DEFAULT 1 NOT NULL,
	`stakeCents` integer NOT NULL,
	`feeBps` integer NOT NULL,
	`feeCents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`creatorTeamId` text NOT NULL,
	`creatorUserId` text NOT NULL,
	`opponentTeamId` text,
	`opponentUserId` text,
	`invitedTeamId` text,
	`creatorLineup` text NOT NULL,
	`opponentLineup` text,
	`notes` text,
	`expiresAt` integer NOT NULL,
	`acceptedAt` integer,
	`reportedBy` text,
	`reportedWinner` text,
	`reportedAt` integer,
	`autoSettleAt` integer,
	`evidenceA` text,
	`evidenceB` text,
	`disputeReason` text,
	`winnerTeamId` text,
	`settledAt` integer,
	`resolvedById` text,
	`resolutionNote` text,
	`riskFlags` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`opponentTeamId`) REFERENCES `Team`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`creatorTeamId`) REFERENCES `Team`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `Challenge_opponentTeamId_idx` ON `Challenge` (`opponentTeamId`);--> statement-breakpoint
CREATE INDEX `Challenge_creatorTeamId_idx` ON `Challenge` (`creatorTeamId`);--> statement-breakpoint
CREATE INDEX `Challenge_status_createdAt_idx` ON `Challenge` (`status`,`createdAt`);--> statement-breakpoint
CREATE TABLE `ChatGPTIdentity` (
	`subject` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ChatGPTIdentity_userId_key` ON `ChatGPTIdentity` (`userId`);--> statement-breakpoint
CREATE TABLE `Coupon` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`orgId` text,
	`tournamentId` text,
	`percentOff` integer,
	`amountOffCents` integer,
	`maxRedemptions` integer,
	`redeemed` integer DEFAULT 0 NOT NULL,
	`expiresAt` integer,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`tournamentId`) REFERENCES `Tournament`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`orgId`) REFERENCES `Organization`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Coupon_code_key` ON `Coupon` (`code`);--> statement-breakpoint
CREATE TABLE `Deposit` (
	`id` text PRIMARY KEY NOT NULL,
	`walletId` text NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`amountCents` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`provider` text NOT NULL,
	`providerChargeId` text,
	`pixCopyPaste` text,
	`pixQrImage` text,
	`expiresAt` integer NOT NULL,
	`confirmedAt` integer,
	`payerDocHash` text,
	`holdReason` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`walletId`) REFERENCES `Wallet`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `Deposit_userId_createdAt_idx` ON `Deposit` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `Deposit_walletId_status_idx` ON `Deposit` (`walletId`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `Deposit_providerChargeId_key` ON `Deposit` (`providerChargeId`);--> statement-breakpoint
CREATE TABLE `GameAccount` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`gameId` text NOT NULL,
	`handle` text NOT NULL,
	`data` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `GameAccount_gameId_handle_key` ON `GameAccount` (`gameId`,`handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `GameAccount_userId_gameId_key` ON `GameAccount` (`userId`,`gameId`);--> statement-breakpoint
CREATE TABLE `KycProfile` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`fullName` text NOT NULL,
	`cpfHash` text NOT NULL,
	`cpfEnc` text NOT NULL,
	`cpfLast4` text NOT NULL,
	`birthDate` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`submittedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`reviewedAt` integer,
	`reviewedById` text,
	`rejectReason` text,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `KycProfile_cpfHash_key` ON `KycProfile` (`cpfHash`);--> statement-breakpoint
CREATE UNIQUE INDEX `KycProfile_userId_key` ON `KycProfile` (`userId`);--> statement-breakpoint
CREATE TABLE `LedgerEntry` (
	`id` text PRIMARY KEY NOT NULL,
	`walletId` text NOT NULL,
	`type` text NOT NULL,
	`availableDeltaCents` integer NOT NULL,
	`lockedDeltaCents` integer DEFAULT 0 NOT NULL,
	`balanceAfterCents` integer NOT NULL,
	`lockedAfterCents` integer NOT NULL,
	`refType` text NOT NULL,
	`refId` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`memo` text,
	`actorId` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`walletId`) REFERENCES `Wallet`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `LedgerEntry_refType_refId_idx` ON `LedgerEntry` (`refType`,`refId`);--> statement-breakpoint
CREATE INDEX `LedgerEntry_walletId_createdAt_idx` ON `LedgerEntry` (`walletId`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `LedgerEntry_idempotencyKey_key` ON `LedgerEntry` (`idempotencyKey`);--> statement-breakpoint
CREATE TABLE `Match` (
	`id` text PRIMARY KEY NOT NULL,
	`stageId` text NOT NULL,
	`key` text NOT NULL,
	`bracket` text NOT NULL,
	`round` integer NOT NULL,
	`position` integer NOT NULL,
	`group` integer,
	`bestOf` integer DEFAULT 1 NOT NULL,
	`slotA` text NOT NULL,
	`slotB` text NOT NULL,
	`onlyIfWinner` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`participantAId` text,
	`participantBId` text,
	`scoreA` integer,
	`scoreB` integer,
	`winnerSide` text,
	`forfeit` text,
	`scheduledAt` integer,
	`reportA` text,
	`reportB` text,
	`notes` text,
	`vetoState` text,
	`games` text,
	`completedAt` integer,
	FOREIGN KEY (`participantBId`) REFERENCES `Participant`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`participantAId`) REFERENCES `Participant`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`stageId`) REFERENCES `Stage`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Match_stageId_key_key` ON `Match` (`stageId`,`key`);--> statement-breakpoint
CREATE INDEX `Match_participantBId_idx` ON `Match` (`participantBId`);--> statement-breakpoint
CREATE INDEX `Match_participantAId_idx` ON `Match` (`participantAId`);--> statement-breakpoint
CREATE INDEX `Match_stageId_round_idx` ON `Match` (`stageId`,`round`);--> statement-breakpoint
CREATE TABLE `MatchDispute` (
	`id` text PRIMARY KEY NOT NULL,
	`matchId` text NOT NULL,
	`openedById` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`resolution` text,
	`resolvedById` text,
	`resolvedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MatchDispute_status_idx` ON `MatchDispute` (`status`);--> statement-breakpoint
CREATE INDEX `MatchDispute_matchId_idx` ON `MatchDispute` (`matchId`);--> statement-breakpoint
CREATE TABLE `MockPixCharge` (
	`id` text PRIMARY KEY NOT NULL,
	`amountCents` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`payerDoc` text,
	`externalReference` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `MockPixTransfer` (
	`id` text PRIMARY KEY NOT NULL,
	`amountCents` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`pixKey` text NOT NULL,
	`externalReference` text NOT NULL,
	`endToEndId` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MockPixTransfer_externalReference_key` ON `MockPixTransfer` (`externalReference`);--> statement-breakpoint
CREATE TABLE `Notification` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text,
	`readAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Notification_userId_readAt_idx` ON `Notification` (`userId`,`readAt`);--> statement-breakpoint
CREATE TABLE `Order` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`userId` text NOT NULL,
	`tournamentId` text NOT NULL,
	`participantId` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`subtotalCents` integer NOT NULL,
	`serviceFeeCents` integer DEFAULT 0 NOT NULL,
	`discountCents` integer DEFAULT 0 NOT NULL,
	`totalCents` integer NOT NULL,
	`couponId` text,
	`provider` text NOT NULL,
	`providerSessionId` text,
	`providerPaymentId` text,
	`method` text,
	`paidAt` integer,
	`expiresAt` integer NOT NULL,
	`refundedCents` integer DEFAULT 0 NOT NULL,
	`failureReason` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`couponId`) REFERENCES `Coupon`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`participantId`) REFERENCES `Participant`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`tournamentId`) REFERENCES `Tournament`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `Order_providerSessionId_idx` ON `Order` (`providerSessionId`);--> statement-breakpoint
CREATE INDEX `Order_tournamentId_status_idx` ON `Order` (`tournamentId`,`status`);--> statement-breakpoint
CREATE INDEX `Order_userId_idx` ON `Order` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `Order_number_key` ON `Order` (`number`);--> statement-breakpoint
CREATE TABLE `OrgMember` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'STAFF' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`orgId`) REFERENCES `Organization`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `OrgMember_orgId_userId_key` ON `OrgMember` (`orgId`,`userId`);--> statement-breakpoint
CREATE INDEX `OrgMember_userId_idx` ON `OrgMember` (`userId`);--> statement-breakpoint
CREATE TABLE `Organization` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Organization_slug_key` ON `Organization` (`slug`);--> statement-breakpoint
CREATE TABLE `Participant` (
	`id` text PRIMARY KEY NOT NULL,
	`tournamentId` text NOT NULL,
	`userId` text NOT NULL,
	`teamId` text,
	`name` text NOT NULL,
	`tag` text,
	`status` text DEFAULT 'REGISTERED' NOT NULL,
	`seed` integer,
	`rating` integer,
	`roster` text NOT NULL,
	`customAnswers` text,
	`reservedUntil` integer,
	`registeredAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`checkedInAt` integer,
	`withdrawnAt` integer,
	`dqReason` text,
	`finalPlacement` integer,
	FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`tournamentId`) REFERENCES `Tournament`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Participant_tournamentId_userId_key` ON `Participant` (`tournamentId`,`userId`);--> statement-breakpoint
CREATE INDEX `Participant_tournamentId_status_idx` ON `Participant` (`tournamentId`,`status`);--> statement-breakpoint
CREATE TABLE `PaymentEvent` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`eventId` text NOT NULL,
	`type` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PaymentEvent_provider_eventId_key` ON `PaymentEvent` (`provider`,`eventId`);--> statement-breakpoint
CREATE TABLE `PrizeAward` (
	`id` text PRIMARY KEY NOT NULL,
	`tournamentId` text NOT NULL,
	`participantId` text NOT NULL,
	`placement` integer NOT NULL,
	`label` text NOT NULL,
	`amountCents` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`paidAt` integer,
	`note` text,
	FOREIGN KEY (`participantId`) REFERENCES `Participant`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`tournamentId`) REFERENCES `Tournament`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PrizeAward_tournamentId_participantId_key` ON `PrizeAward` (`tournamentId`,`participantId`);--> statement-breakpoint
CREATE INDEX `PrizeAward_tournamentId_idx` ON `PrizeAward` (`tournamentId`);--> statement-breakpoint
CREATE TABLE `RateLimit` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`resetAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Refund` (
	`id` text PRIMARY KEY NOT NULL,
	`orderId` text NOT NULL,
	`amountCents` integer NOT NULL,
	`reason` text NOT NULL,
	`providerRefundId` text,
	`createdById` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Refund_orderId_idx` ON `Refund` (`orderId`);--> statement-breakpoint
CREATE TABLE `RosterEntry` (
	`id` text PRIMARY KEY NOT NULL,
	`participantId` text NOT NULL,
	`tournamentId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`participantId`) REFERENCES `Participant`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `RosterEntry_tournamentId_userId_key` ON `RosterEntry` (`tournamentId`,`userId`);--> statement-breakpoint
CREATE INDEX `RosterEntry_participantId_idx` ON `RosterEntry` (`participantId`);--> statement-breakpoint
CREATE TABLE `Session` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`lastUsedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`userAgent` text,
	`ip` text,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Session_expiresAt_idx` ON `Session` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `Session_userId_idx` ON `Session` (`userId`);--> statement-breakpoint
CREATE TABLE `SiteSetting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedById` text
);
--> statement-breakpoint
CREATE TABLE `Stage` (
	`id` text PRIMARY KEY NOT NULL,
	`tournamentId` text NOT NULL,
	`order` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`settings` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`seedOrder` text,
	`groups` text,
	`startedAt` integer,
	`completedAt` integer,
	FOREIGN KEY (`tournamentId`) REFERENCES `Tournament`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Stage_tournamentId_order_key` ON `Stage` (`tournamentId`,`order`);--> statement-breakpoint
CREATE TABLE `Team` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tag` text NOT NULL,
	`gameId` text,
	`description` text,
	`ownerId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deletedAt` integer,
	`deletedById` text,
	`balanceReleasedAt` integer,
	FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Team_slug_key` ON `Team` (`slug`);--> statement-breakpoint
CREATE TABLE `TeamInvite` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`invitedById` text NOT NULL,
	`userId` text,
	`role` text DEFAULT 'PLAYER' NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`invitedById`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `TeamInvite_userId_idx` ON `TeamInvite` (`userId`);--> statement-breakpoint
CREATE INDEX `TeamInvite_teamId_idx` ON `TeamInvite` (`teamId`);--> statement-breakpoint
CREATE UNIQUE INDEX `TeamInvite_token_key` ON `TeamInvite` (`token`);--> statement-breakpoint
CREATE TABLE `TeamMember` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'PLAYER' NOT NULL,
	`joinedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `TeamMember_teamId_userId_key` ON `TeamMember` (`teamId`,`userId`);--> statement-breakpoint
CREATE INDEX `TeamMember_userId_idx` ON `TeamMember` (`userId`);--> statement-breakpoint
CREATE TABLE `Tournament` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`gameId` text NOT NULL,
	`modeId` text NOT NULL,
	`presetId` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`summary` text,
	`description` text,
	`rules` text,
	`region` text,
	`platform` text,
	`timezone` text DEFAULT 'America/Sao_Paulo' NOT NULL,
	`coverUrl` text,
	`streamUrl` text,
	`discordUrl` text,
	`startsAt` integer NOT NULL,
	`registrationOpensAt` integer,
	`registrationClosesAt` integer,
	`checkInOpensAt` integer,
	`checkInClosesAt` integer,
	`minParticipants` integer DEFAULT 2 NOT NULL,
	`maxParticipants` integer NOT NULL,
	`teamSize` integer DEFAULT 1 NOT NULL,
	`maxSubs` integer DEFAULT 0 NOT NULL,
	`entryFeeCents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`prizePoolCents` integer DEFAULT 0 NOT NULL,
	`prizeSplit` text,
	`allowPlayerReporting` integer DEFAULT true NOT NULL,
	`requireCheckIn` integer DEFAULT true NOT NULL,
	`seedingMethod` text DEFAULT 'RANDOM' NOT NULL,
	`seedSalt` text NOT NULL,
	`customFields` text,
	`mapPool` text,
	`publishedAt` integer,
	`startedAt` integer,
	`completedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`orgId`) REFERENCES `Organization`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `Tournament_orgId_idx` ON `Tournament` (`orgId`);--> statement-breakpoint
CREATE INDEX `Tournament_gameId_idx` ON `Tournament` (`gameId`);--> statement-breakpoint
CREATE INDEX `Tournament_status_startsAt_idx` ON `Tournament` (`status`,`startsAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `Tournament_slug_key` ON `Tournament` (`slug`);--> statement-breakpoint
CREATE TABLE `User` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`username` text NOT NULL,
	`displayName` text NOT NULL,
	`passwordHash` text NOT NULL,
	`role` text DEFAULT 'USER' NOT NULL,
	`country` text,
	`bio` text,
	`emailVerifiedAt` integer,
	`bannedAt` integer,
	`banReason` text,
	`withdrawalLockedUntil` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `User_username_key` ON `User` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `User_email_key` ON `User` (`email`);--> statement-breakpoint
CREATE TABLE `Wallet` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'TEAM' NOT NULL,
	`teamId` text,
	`balanceCents` integer DEFAULT 0 NOT NULL,
	`lockedCents` integer DEFAULT 0 NOT NULL,
	`debtCents` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`frozenAt` integer,
	`frozenReason` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Wallet_teamId_key` ON `Wallet` (`teamId`);--> statement-breakpoint
CREATE TABLE `WalletReleaseRequest` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`walletId` text NOT NULL,
	`requestedById` text NOT NULL,
	`message` text NOT NULL,
	`balanceCents` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`reviewedById` text,
	`reviewedAt` integer,
	`reviewNote` text,
	`releasedCents` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `WalletReleaseRequest_teamId_idx` ON `WalletReleaseRequest` (`teamId`);--> statement-breakpoint
CREATE INDEX `WalletReleaseRequest_status_createdAt_idx` ON `WalletReleaseRequest` (`status`,`createdAt`);--> statement-breakpoint
CREATE TABLE `Withdrawal` (
	`id` text PRIMARY KEY NOT NULL,
	`walletId` text NOT NULL,
	`teamId` text NOT NULL,
	`requestedById` text NOT NULL,
	`amountCents` integer NOT NULL,
	`feeCents` integer DEFAULT 0 NOT NULL,
	`netCents` integer NOT NULL,
	`status` text DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	`destinationCpfLast4` text NOT NULL,
	`requestNonce` text NOT NULL,
	`otpHash` text,
	`otpExpiresAt` integer,
	`otpAttempts` integer DEFAULT 0 NOT NULL,
	`confirmedAt` integer,
	`riskScore` integer DEFAULT 0 NOT NULL,
	`riskFlags` text,
	`reviewedById` text,
	`reviewedAt` integer,
	`reviewNote` text,
	`processAfter` integer,
	`provider` text,
	`providerTransferId` text,
	`endToEndId` text,
	`paidAt` integer,
	`failureReason` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`walletId`) REFERENCES `Wallet`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Withdrawal_requestedById_requestNonce_key` ON `Withdrawal` (`requestedById`,`requestNonce`);--> statement-breakpoint
CREATE INDEX `Withdrawal_walletId_createdAt_idx` ON `Withdrawal` (`walletId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `Withdrawal_status_processAfter_idx` ON `Withdrawal` (`status`,`processAfter`);--> statement-breakpoint
CREATE UNIQUE INDEX `Withdrawal_providerTransferId_key` ON `Withdrawal` (`providerTransferId`);