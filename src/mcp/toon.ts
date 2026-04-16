import { encode } from "@toon-format/toon";

/**
 * Encode data as TOON format. Falls back to JSON if encoding fails.
 *
 * TOON is only smaller than JSON on flat tabular arrays of uniform
 * objects with short values (~40% smaller in that best case). On
 * nested shapes — the common case for getBoard / getRoadmap / card
 * detail — it is 5-30% LARGER. JSON is the default for tools; TOON
 * is opt-in for callers who know their payload is tabular.
 */
export function toToon(data: unknown): string {
	try {
		return encode(data);
	} catch {
		return JSON.stringify(data, null, 2);
	}
}
