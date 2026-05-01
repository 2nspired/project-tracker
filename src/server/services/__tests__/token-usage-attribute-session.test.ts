import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock() is hoisted above the imports, so the mock fns must be declared
// inside vi.hoisted() to be available when the mock factory runs.
const mocks = vi.hoisted(() => ({
	cardFindUnique: vi.fn(),
	tokenUsageEventUpdateMany: vi.fn(),
}));

vi.mock("@/server/db", () => ({
	db: {
		card: { findUnique: mocks.cardFindUnique },
		tokenUsageEvent: { updateMany: mocks.tokenUsageEventUpdateMany },
	},
}));

const { cardFindUnique, tokenUsageEventUpdateMany } = mocks;

import { tokenUsageService } from "@/server/services/token-usage-service";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CARD_ID_X = "22222222-2222-4222-8222-222222222222";
const CARD_ID_Y = "33333333-3333-4333-8333-333333333333";
const MISSING_CARD_ID = "44444444-4444-4444-8444-444444444444";

describe("tokenUsageService.attributeSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("happy path: 2 events with sessionId, attribute, both updated", async () => {
		cardFindUnique.mockResolvedValue({ id: CARD_ID_X });
		tokenUsageEventUpdateMany.mockResolvedValue({ count: 2 });

		const result = await tokenUsageService.attributeSession(SESSION_ID, CARD_ID_X);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.updated).toBe(2);

		expect(cardFindUnique).toHaveBeenCalledWith({
			where: { id: CARD_ID_X },
			select: { id: true },
		});
		expect(tokenUsageEventUpdateMany).toHaveBeenCalledWith({
			where: { sessionId: SESSION_ID },
			data: { cardId: CARD_ID_X },
		});
	});

	it("returns NOT_FOUND when the card does not exist (no exception)", async () => {
		cardFindUnique.mockResolvedValue(null);

		const result = await tokenUsageService.attributeSession(SESSION_ID, MISSING_CARD_ID);

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("NOT_FOUND");
		// We must NOT have attempted the update when the card is missing —
		// otherwise stale rows could be silently re-attributed.
		expect(tokenUsageEventUpdateMany).not.toHaveBeenCalled();
	});

	it("idempotent: calling twice with the same cardId is safe and reports the same shape", async () => {
		cardFindUnique.mockResolvedValue({ id: CARD_ID_X });
		tokenUsageEventUpdateMany.mockResolvedValue({ count: 2 });

		const first = await tokenUsageService.attributeSession(SESSION_ID, CARD_ID_X);
		const second = await tokenUsageService.attributeSession(SESSION_ID, CARD_ID_X);

		expect(first.success).toBe(true);
		expect(second.success).toBe(true);
		if (!first.success || !second.success) return;
		expect(first.data.updated).toBe(2);
		expect(second.data.updated).toBe(2);
		expect(tokenUsageEventUpdateMany).toHaveBeenCalledTimes(2);
		// Both calls write the same cardId — no-op semantics at the DB layer.
		expect(tokenUsageEventUpdateMany).toHaveBeenNthCalledWith(1, {
			where: { sessionId: SESSION_ID },
			data: { cardId: CARD_ID_X },
		});
		expect(tokenUsageEventUpdateMany).toHaveBeenNthCalledWith(2, {
			where: { sessionId: SESSION_ID },
			data: { cardId: CARD_ID_X },
		});
	});

	it("last-write-wins: attribute to X then to Y; final cardId is Y", async () => {
		cardFindUnique.mockResolvedValue({ id: CARD_ID_X });
		tokenUsageEventUpdateMany.mockResolvedValue({ count: 2 });

		const first = await tokenUsageService.attributeSession(SESSION_ID, CARD_ID_X);
		expect(first.success).toBe(true);

		cardFindUnique.mockResolvedValue({ id: CARD_ID_Y });
		const second = await tokenUsageService.attributeSession(SESSION_ID, CARD_ID_Y);
		expect(second.success).toBe(true);

		expect(tokenUsageEventUpdateMany).toHaveBeenCalledTimes(2);
		// The most recent UPDATE writes Y — last call wins, prior X attribution
		// is overwritten in the database.
		const finalCall = tokenUsageEventUpdateMany.mock.calls.at(-1)?.[0] as {
			where: { sessionId: string };
			data: { cardId: string };
		};
		expect(finalCall.data.cardId).toBe(CARD_ID_Y);
		expect(finalCall.where.sessionId).toBe(SESSION_ID);
	});

	it("propagates a WRITE_FAILED error code when the DB update throws", async () => {
		cardFindUnique.mockResolvedValue({ id: CARD_ID_X });
		tokenUsageEventUpdateMany.mockRejectedValue(new Error("DB exploded"));

		const result = await tokenUsageService.attributeSession(SESSION_ID, CARD_ID_X);

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("WRITE_FAILED");
	});
});
