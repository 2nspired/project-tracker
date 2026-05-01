import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock() is hoisted above the imports, so the mock fns must be declared
// inside vi.hoisted() to be available when the mock factory runs.
const mocks = vi.hoisted(() => ({
	noteFindUnique: vi.fn(),
	columnFindUnique: vi.fn(),
	cardAggregate: vi.fn(),
	projectUpdate: vi.fn(),
	cardCreate: vi.fn(),
	noteUpdate: vi.fn(),
	activityCreate: vi.fn(),
}));

const txClient = {
	card: { aggregate: mocks.cardAggregate, create: mocks.cardCreate },
	project: { update: mocks.projectUpdate },
	note: { update: mocks.noteUpdate },
	activity: { create: mocks.activityCreate },
};

vi.mock("@/server/db", () => ({
	db: {
		note: { findUnique: mocks.noteFindUnique },
		column: { findUnique: mocks.columnFindUnique },
		$transaction: vi.fn(async (cb: (tx: typeof txClient) => unknown) => cb(txClient)),
	},
}));

const {
	noteFindUnique,
	columnFindUnique,
	cardAggregate,
	projectUpdate,
	cardCreate,
	noteUpdate,
	activityCreate,
} = mocks;

import { noteService } from "@/server/services/note-service";

const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const COLUMN_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "44444444-4444-4444-8444-444444444444";

describe("noteService.promoteToCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		noteFindUnique.mockResolvedValue({
			id: NOTE_ID,
			title: "Original note title",
			content: "Some markdown body",
			projectId: PROJECT_ID,
		});
		columnFindUnique.mockResolvedValue({
			id: COLUMN_ID,
			board: { projectId: PROJECT_ID },
		});
		cardAggregate.mockResolvedValue({ _max: { position: 4 } });
		projectUpdate.mockResolvedValue({ id: PROJECT_ID, nextCardNumber: 12 });
		cardCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
			id: CARD_ID,
			...data,
		}));
		noteUpdate.mockResolvedValue({ id: NOTE_ID, cardId: CARD_ID });
		activityCreate.mockResolvedValue({});
	});

	it("happy path: stamps sourceNoteId, sets back-ref, writes activity, returns card", async () => {
		const result = await noteService.promoteToCard({
			noteId: NOTE_ID,
			columnId: COLUMN_ID,
			title: "Custom card title",
			priority: "MEDIUM",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		// Card create call
		expect(cardCreate).toHaveBeenCalledTimes(1);
		const cardArg = cardCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
		expect(cardArg.data.columnId).toBe(COLUMN_ID);
		expect(cardArg.data.projectId).toBe(PROJECT_ID);
		expect(cardArg.data.title).toBe("Custom card title");
		expect(cardArg.data.description).toBe("Some markdown body");
		expect(cardArg.data.priority).toBe("MEDIUM");
		expect(cardArg.data.position).toBe(5); // max 4 + 1
		expect(cardArg.data.number).toBe(11); // nextCardNumber 12 - 1
		const metadata = JSON.parse(cardArg.data.metadata as string);
		expect(metadata).toEqual({ sourceNoteId: NOTE_ID });

		// Back-reference on the source note
		expect(noteUpdate).toHaveBeenCalledWith({
			where: { id: NOTE_ID },
			data: { cardId: CARD_ID },
		});

		// Activity row
		expect(activityCreate).toHaveBeenCalledTimes(1);
		const activityArg = activityCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
		expect(activityArg.data.cardId).toBe(CARD_ID);
		expect(activityArg.data.action).toBe("promoted_from_note");
		expect(activityArg.data.actorType).toBe("HUMAN");
	});

	it("falls back to note title when no explicit title is passed", async () => {
		await noteService.promoteToCard({
			noteId: NOTE_ID,
			columnId: COLUMN_ID,
			priority: "NONE",
		});
		const cardArg = cardCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
		expect(cardArg.data.title).toBe("Original note title");
	});

	it("falls back to note title when explicit title is whitespace-only", async () => {
		await noteService.promoteToCard({
			noteId: NOTE_ID,
			columnId: COLUMN_ID,
			title: "   ",
			priority: "NONE",
		});
		const cardArg = cardCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
		expect(cardArg.data.title).toBe("Original note title");
	});

	it("computes position 0 when target column is empty", async () => {
		cardAggregate.mockResolvedValue({ _max: { position: null } });
		await noteService.promoteToCard({
			noteId: NOTE_ID,
			columnId: COLUMN_ID,
			priority: "NONE",
		});
		const cardArg = cardCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
		expect(cardArg.data.position).toBe(0);
	});

	it("returns NOT_FOUND when the note doesn't exist", async () => {
		noteFindUnique.mockResolvedValue(null);
		const result = await noteService.promoteToCard({
			noteId: NOTE_ID,
			columnId: COLUMN_ID,
			priority: "NONE",
		});
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("NOT_FOUND");
		expect(cardCreate).not.toHaveBeenCalled();
	});

	it("returns NOT_FOUND when the column doesn't exist", async () => {
		columnFindUnique.mockResolvedValue(null);
		const result = await noteService.promoteToCard({
			noteId: NOTE_ID,
			columnId: COLUMN_ID,
			priority: "NONE",
		});
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("NOT_FOUND");
		expect(cardCreate).not.toHaveBeenCalled();
	});

	it("omits description when the note has no content", async () => {
		noteFindUnique.mockResolvedValue({
			id: NOTE_ID,
			title: "Title only",
			content: "",
			projectId: PROJECT_ID,
		});
		await noteService.promoteToCard({
			noteId: NOTE_ID,
			columnId: COLUMN_ID,
			priority: "NONE",
		});
		const cardArg = cardCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
		expect(cardArg.data.description).toBeUndefined();
	});
});
