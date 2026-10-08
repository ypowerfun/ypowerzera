// ARQUIVO GERADO por scripts/gen-model-meta.mjs a partir de prisma/schema.prisma. Não edite à mão.
// Regerar: npm run generate:meta
/* eslint-disable */

export interface ModelMeta {
  delegate: string;
  pk: string;
  pkGenerated: boolean;
  scalars: string[];
  jsonFields: Array<{ name: string; optional: boolean }>;
  dateFields: string[];
  relations: string[];
  dependents: Array<{ model: string; fk: string; ref: string; onDelete: "Cascade" | "SetNull" | "Restrict" | "NoAction" | "SetDefault" }>;
}

export const MODEL_META: Record<string, ModelMeta> = {
  "User": {
    "delegate": "user",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "email",
      "username",
      "displayName",
      "passwordHash",
      "role",
      "country",
      "bio",
      "emailVerifiedAt",
      "bannedAt",
      "banReason",
      "withdrawalLockedUntil",
      "createdAt",
      "updatedAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "emailVerifiedAt",
      "bannedAt",
      "withdrawalLockedUntil",
      "createdAt",
      "updatedAt"
    ],
    "relations": [
      "kyc",
      "sessions",
      "tokens",
      "gameAccounts",
      "orgMemberships",
      "teamMemberships",
      "ownedTeams",
      "participants",
      "orders",
      "notifications",
      "rosterEntries",
      "invitesSent",
      "invitesReceived"
    ],
    "dependents": [
      {
        "model": "Session",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "AuthToken",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "GameAccount",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "OrgMember",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "Team",
        "fk": "ownerId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "TeamMember",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "TeamInvite",
        "fk": "invitedById",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "TeamInvite",
        "fk": "userId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      {
        "model": "Participant",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "RosterEntry",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "Order",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "Notification",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "KycProfile",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    ]
  },
  "Session": {
    "delegate": "session",
    "pk": "id",
    "pkGenerated": false,
    "scalars": [
      "id",
      "userId",
      "expiresAt",
      "createdAt",
      "lastUsedAt",
      "userAgent",
      "ip"
    ],
    "jsonFields": [],
    "dateFields": [
      "expiresAt",
      "createdAt",
      "lastUsedAt"
    ],
    "relations": [
      "user"
    ],
    "dependents": []
  },
  "AuthToken": {
    "delegate": "authToken",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "userId",
      "type",
      "tokenHash",
      "expiresAt",
      "usedAt",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "expiresAt",
      "usedAt",
      "createdAt"
    ],
    "relations": [
      "user"
    ],
    "dependents": []
  },
  "RateLimit": {
    "delegate": "rateLimit",
    "pk": "key",
    "pkGenerated": false,
    "scalars": [
      "key",
      "count",
      "resetAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "resetAt"
    ],
    "relations": [],
    "dependents": []
  },
  "GameAccount": {
    "delegate": "gameAccount",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "userId",
      "gameId",
      "handle",
      "data",
      "createdAt",
      "updatedAt"
    ],
    "jsonFields": [
      {
        "name": "data",
        "optional": false
      }
    ],
    "dateFields": [
      "createdAt",
      "updatedAt"
    ],
    "relations": [
      "user"
    ],
    "dependents": []
  },
  "Organization": {
    "delegate": "organization",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "slug",
      "name",
      "description",
      "createdAt",
      "deletedAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "createdAt",
      "deletedAt"
    ],
    "relations": [
      "members",
      "tournaments",
      "coupons"
    ],
    "dependents": [
      {
        "model": "OrgMember",
        "fk": "orgId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "Tournament",
        "fk": "orgId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "Coupon",
        "fk": "orgId",
        "ref": "id",
        "onDelete": "SetNull"
      }
    ]
  },
  "OrgMember": {
    "delegate": "orgMember",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "orgId",
      "userId",
      "role"
    ],
    "jsonFields": [],
    "dateFields": [],
    "relations": [
      "org",
      "user"
    ],
    "dependents": []
  },
  "Team": {
    "delegate": "team",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "slug",
      "name",
      "tag",
      "gameId",
      "description",
      "ownerId",
      "createdAt",
      "deletedAt",
      "deletedById",
      "balanceReleasedAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "createdAt",
      "deletedAt",
      "balanceReleasedAt"
    ],
    "relations": [
      "owner",
      "releaseRequests",
      "members",
      "invites",
      "participants",
      "wallet",
      "challengesCreated",
      "challengesReceived"
    ],
    "dependents": [
      {
        "model": "WalletReleaseRequest",
        "fk": "teamId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "TeamMember",
        "fk": "teamId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "TeamInvite",
        "fk": "teamId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "Participant",
        "fk": "teamId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      {
        "model": "Wallet",
        "fk": "teamId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "Challenge",
        "fk": "creatorTeamId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "Challenge",
        "fk": "opponentTeamId",
        "ref": "id",
        "onDelete": "SetNull"
      }
    ]
  },
  "WalletReleaseRequest": {
    "delegate": "walletReleaseRequest",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "teamId",
      "walletId",
      "requestedById",
      "message",
      "balanceCents",
      "status",
      "reviewedById",
      "reviewedAt",
      "reviewNote",
      "releasedCents",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "reviewedAt",
      "createdAt"
    ],
    "relations": [
      "team"
    ],
    "dependents": []
  },
  "SiteSetting": {
    "delegate": "siteSetting",
    "pk": "key",
    "pkGenerated": false,
    "scalars": [
      "key",
      "value",
      "updatedAt",
      "updatedById"
    ],
    "jsonFields": [],
    "dateFields": [
      "updatedAt"
    ],
    "relations": [],
    "dependents": []
  },
  "TeamMember": {
    "delegate": "teamMember",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "teamId",
      "userId",
      "role",
      "joinedAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "joinedAt"
    ],
    "relations": [
      "team",
      "user"
    ],
    "dependents": []
  },
  "TeamInvite": {
    "delegate": "teamInvite",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "teamId",
      "invitedById",
      "userId",
      "role",
      "token",
      "status",
      "createdAt",
      "expiresAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "createdAt",
      "expiresAt"
    ],
    "relations": [
      "team",
      "invitedBy",
      "user"
    ],
    "dependents": []
  },
  "Tournament": {
    "delegate": "tournament",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "orgId",
      "slug",
      "name",
      "gameId",
      "modeId",
      "presetId",
      "status",
      "visibility",
      "summary",
      "description",
      "rules",
      "region",
      "platform",
      "timezone",
      "coverUrl",
      "streamUrl",
      "discordUrl",
      "startsAt",
      "registrationOpensAt",
      "registrationClosesAt",
      "checkInOpensAt",
      "checkInClosesAt",
      "minParticipants",
      "maxParticipants",
      "teamSize",
      "maxSubs",
      "entryFeeCents",
      "currency",
      "prizePoolCents",
      "prizeSplit",
      "allowPlayerReporting",
      "requireCheckIn",
      "seedingMethod",
      "seedSalt",
      "customFields",
      "mapPool",
      "publishedAt",
      "startedAt",
      "completedAt",
      "createdAt",
      "updatedAt"
    ],
    "jsonFields": [
      {
        "name": "prizeSplit",
        "optional": true
      },
      {
        "name": "customFields",
        "optional": true
      },
      {
        "name": "mapPool",
        "optional": true
      }
    ],
    "dateFields": [
      "startsAt",
      "registrationOpensAt",
      "registrationClosesAt",
      "checkInOpensAt",
      "checkInClosesAt",
      "publishedAt",
      "startedAt",
      "completedAt",
      "createdAt",
      "updatedAt"
    ],
    "relations": [
      "org",
      "stages",
      "participants",
      "orders",
      "coupons",
      "prizeAwards"
    ],
    "dependents": [
      {
        "model": "Stage",
        "fk": "tournamentId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "Participant",
        "fk": "tournamentId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "Order",
        "fk": "tournamentId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "Coupon",
        "fk": "tournamentId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "PrizeAward",
        "fk": "tournamentId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    ]
  },
  "Stage": {
    "delegate": "stage",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "tournamentId",
      "order",
      "name",
      "type",
      "settings",
      "status",
      "seedOrder",
      "groups",
      "startedAt",
      "completedAt"
    ],
    "jsonFields": [
      {
        "name": "settings",
        "optional": false
      },
      {
        "name": "seedOrder",
        "optional": true
      },
      {
        "name": "groups",
        "optional": true
      }
    ],
    "dateFields": [
      "startedAt",
      "completedAt"
    ],
    "relations": [
      "tournament",
      "matches",
      "brGames"
    ],
    "dependents": [
      {
        "model": "Match",
        "fk": "stageId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "BrGame",
        "fk": "stageId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    ]
  },
  "Participant": {
    "delegate": "participant",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "tournamentId",
      "userId",
      "teamId",
      "name",
      "tag",
      "status",
      "seed",
      "rating",
      "roster",
      "customAnswers",
      "reservedUntil",
      "registeredAt",
      "checkedInAt",
      "withdrawnAt",
      "dqReason",
      "finalPlacement"
    ],
    "jsonFields": [
      {
        "name": "roster",
        "optional": false
      },
      {
        "name": "customAnswers",
        "optional": true
      }
    ],
    "dateFields": [
      "reservedUntil",
      "registeredAt",
      "checkedInAt",
      "withdrawnAt"
    ],
    "relations": [
      "tournament",
      "user",
      "team",
      "matchesA",
      "matchesB",
      "brResults",
      "orders",
      "prizeAwards",
      "rosterEntries"
    ],
    "dependents": [
      {
        "model": "RosterEntry",
        "fk": "participantId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "Match",
        "fk": "participantAId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      {
        "model": "Match",
        "fk": "participantBId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      {
        "model": "BrResult",
        "fk": "participantId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      {
        "model": "Order",
        "fk": "participantId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      {
        "model": "PrizeAward",
        "fk": "participantId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    ]
  },
  "RosterEntry": {
    "delegate": "rosterEntry",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "participantId",
      "tournamentId",
      "userId",
      "role"
    ],
    "jsonFields": [],
    "dateFields": [],
    "relations": [
      "participant",
      "user"
    ],
    "dependents": []
  },
  "Match": {
    "delegate": "match",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "stageId",
      "key",
      "bracket",
      "round",
      "position",
      "group",
      "bestOf",
      "slotA",
      "slotB",
      "onlyIfWinner",
      "status",
      "participantAId",
      "participantBId",
      "scoreA",
      "scoreB",
      "winnerSide",
      "forfeit",
      "scheduledAt",
      "reportA",
      "reportB",
      "notes",
      "vetoState",
      "games",
      "completedAt"
    ],
    "jsonFields": [
      {
        "name": "slotA",
        "optional": false
      },
      {
        "name": "slotB",
        "optional": false
      },
      {
        "name": "onlyIfWinner",
        "optional": true
      },
      {
        "name": "reportA",
        "optional": true
      },
      {
        "name": "reportB",
        "optional": true
      },
      {
        "name": "vetoState",
        "optional": true
      },
      {
        "name": "games",
        "optional": true
      }
    ],
    "dateFields": [
      "scheduledAt",
      "completedAt"
    ],
    "relations": [
      "stage",
      "participantA",
      "participantB",
      "disputes"
    ],
    "dependents": [
      {
        "model": "MatchDispute",
        "fk": "matchId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    ]
  },
  "BrGame": {
    "delegate": "brGame",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "stageId",
      "round",
      "lobby",
      "participantIds",
      "code",
      "scheduledAt",
      "completedAt"
    ],
    "jsonFields": [
      {
        "name": "participantIds",
        "optional": false
      }
    ],
    "dateFields": [
      "scheduledAt",
      "completedAt"
    ],
    "relations": [
      "stage",
      "results"
    ],
    "dependents": [
      {
        "model": "BrResult",
        "fk": "gameId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    ]
  },
  "BrResult": {
    "delegate": "brResult",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "gameId",
      "participantId",
      "placement",
      "kills"
    ],
    "jsonFields": [],
    "dateFields": [],
    "relations": [
      "game",
      "participant"
    ],
    "dependents": []
  },
  "MatchDispute": {
    "delegate": "matchDispute",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "matchId",
      "openedById",
      "reason",
      "status",
      "resolution",
      "resolvedById",
      "resolvedAt",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "resolvedAt",
      "createdAt"
    ],
    "relations": [
      "match"
    ],
    "dependents": []
  },
  "Order": {
    "delegate": "order",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "number",
      "userId",
      "tournamentId",
      "participantId",
      "status",
      "currency",
      "subtotalCents",
      "serviceFeeCents",
      "discountCents",
      "totalCents",
      "couponId",
      "provider",
      "providerSessionId",
      "providerPaymentId",
      "method",
      "paidAt",
      "expiresAt",
      "refundedCents",
      "failureReason",
      "createdAt",
      "updatedAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "paidAt",
      "expiresAt",
      "createdAt",
      "updatedAt"
    ],
    "relations": [
      "user",
      "tournament",
      "participant",
      "coupon",
      "refunds"
    ],
    "dependents": [
      {
        "model": "Refund",
        "fk": "orderId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    ]
  },
  "Refund": {
    "delegate": "refund",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "orderId",
      "amountCents",
      "reason",
      "providerRefundId",
      "createdById",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "createdAt"
    ],
    "relations": [
      "order"
    ],
    "dependents": []
  },
  "Coupon": {
    "delegate": "coupon",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "code",
      "orgId",
      "tournamentId",
      "percentOff",
      "amountOffCents",
      "maxRedemptions",
      "redeemed",
      "expiresAt",
      "active",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "expiresAt",
      "createdAt"
    ],
    "relations": [
      "org",
      "tournament",
      "orders"
    ],
    "dependents": [
      {
        "model": "Order",
        "fk": "couponId",
        "ref": "id",
        "onDelete": "SetNull"
      }
    ]
  },
  "PaymentEvent": {
    "delegate": "paymentEvent",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "provider",
      "eventId",
      "type",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "createdAt"
    ],
    "relations": [],
    "dependents": []
  },
  "PrizeAward": {
    "delegate": "prizeAward",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "tournamentId",
      "participantId",
      "placement",
      "label",
      "amountCents",
      "status",
      "paidAt",
      "note"
    ],
    "jsonFields": [],
    "dateFields": [
      "paidAt"
    ],
    "relations": [
      "tournament",
      "participant"
    ],
    "dependents": []
  },
  "AuditLog": {
    "delegate": "auditLog",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "actorId",
      "action",
      "entity",
      "entityId",
      "meta",
      "createdAt"
    ],
    "jsonFields": [
      {
        "name": "meta",
        "optional": true
      }
    ],
    "dateFields": [
      "createdAt"
    ],
    "relations": [],
    "dependents": []
  },
  "Notification": {
    "delegate": "notification",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "userId",
      "kind",
      "title",
      "body",
      "href",
      "readAt",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "readAt",
      "createdAt"
    ],
    "relations": [
      "user"
    ],
    "dependents": []
  },
  "KycProfile": {
    "delegate": "kycProfile",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "userId",
      "fullName",
      "cpfHash",
      "cpfEnc",
      "cpfLast4",
      "birthDate",
      "status",
      "submittedAt",
      "reviewedAt",
      "reviewedById",
      "rejectReason"
    ],
    "jsonFields": [],
    "dateFields": [
      "birthDate",
      "submittedAt",
      "reviewedAt"
    ],
    "relations": [
      "user"
    ],
    "dependents": []
  },
  "Wallet": {
    "delegate": "wallet",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "kind",
      "teamId",
      "balanceCents",
      "lockedCents",
      "debtCents",
      "version",
      "frozenAt",
      "frozenReason",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "frozenAt",
      "createdAt"
    ],
    "relations": [
      "team",
      "ledger",
      "deposits",
      "withdrawals"
    ],
    "dependents": [
      {
        "model": "LedgerEntry",
        "fk": "walletId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "Deposit",
        "fk": "walletId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      {
        "model": "Withdrawal",
        "fk": "walletId",
        "ref": "id",
        "onDelete": "Restrict"
      }
    ]
  },
  "LedgerEntry": {
    "delegate": "ledgerEntry",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "walletId",
      "type",
      "availableDeltaCents",
      "lockedDeltaCents",
      "balanceAfterCents",
      "lockedAfterCents",
      "refType",
      "refId",
      "idempotencyKey",
      "memo",
      "actorId",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "createdAt"
    ],
    "relations": [
      "wallet"
    ],
    "dependents": []
  },
  "Deposit": {
    "delegate": "deposit",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "walletId",
      "teamId",
      "userId",
      "amountCents",
      "status",
      "provider",
      "providerChargeId",
      "pixCopyPaste",
      "pixQrImage",
      "expiresAt",
      "confirmedAt",
      "payerDocHash",
      "holdReason",
      "createdAt",
      "updatedAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "expiresAt",
      "confirmedAt",
      "createdAt",
      "updatedAt"
    ],
    "relations": [
      "wallet"
    ],
    "dependents": []
  },
  "Withdrawal": {
    "delegate": "withdrawal",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "walletId",
      "teamId",
      "requestedById",
      "amountCents",
      "feeCents",
      "netCents",
      "status",
      "destinationCpfLast4",
      "requestNonce",
      "otpHash",
      "otpExpiresAt",
      "otpAttempts",
      "confirmedAt",
      "riskScore",
      "riskFlags",
      "reviewedById",
      "reviewedAt",
      "reviewNote",
      "processAfter",
      "provider",
      "providerTransferId",
      "endToEndId",
      "paidAt",
      "failureReason",
      "createdAt",
      "updatedAt"
    ],
    "jsonFields": [
      {
        "name": "riskFlags",
        "optional": true
      }
    ],
    "dateFields": [
      "otpExpiresAt",
      "confirmedAt",
      "reviewedAt",
      "processAfter",
      "paidAt",
      "createdAt",
      "updatedAt"
    ],
    "relations": [
      "wallet"
    ],
    "dependents": []
  },
  "Challenge": {
    "delegate": "challenge",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "gameId",
      "modeId",
      "bestOf",
      "stakeCents",
      "feeBps",
      "feeCents",
      "status",
      "creatorTeamId",
      "creatorUserId",
      "opponentTeamId",
      "opponentUserId",
      "invitedTeamId",
      "creatorLineup",
      "opponentLineup",
      "notes",
      "expiresAt",
      "acceptedAt",
      "reportedBy",
      "reportedWinner",
      "reportedAt",
      "autoSettleAt",
      "evidenceA",
      "evidenceB",
      "disputeReason",
      "winnerTeamId",
      "settledAt",
      "resolvedById",
      "resolutionNote",
      "riskFlags",
      "createdAt",
      "updatedAt"
    ],
    "jsonFields": [
      {
        "name": "creatorLineup",
        "optional": false
      },
      {
        "name": "opponentLineup",
        "optional": true
      },
      {
        "name": "riskFlags",
        "optional": true
      }
    ],
    "dateFields": [
      "expiresAt",
      "acceptedAt",
      "reportedAt",
      "autoSettleAt",
      "settledAt",
      "createdAt",
      "updatedAt"
    ],
    "relations": [
      "creatorTeam",
      "opponentTeam"
    ],
    "dependents": []
  },
  "MockPixCharge": {
    "delegate": "mockPixCharge",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "amountCents",
      "status",
      "payerDoc",
      "externalReference",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "createdAt"
    ],
    "relations": [],
    "dependents": []
  },
  "MockPixTransfer": {
    "delegate": "mockPixTransfer",
    "pk": "id",
    "pkGenerated": true,
    "scalars": [
      "id",
      "amountCents",
      "status",
      "pixKey",
      "externalReference",
      "endToEndId",
      "createdAt"
    ],
    "jsonFields": [],
    "dateFields": [
      "createdAt"
    ],
    "relations": [],
    "dependents": []
  }
};
