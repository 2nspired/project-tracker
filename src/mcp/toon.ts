import { encode } from "@toon-format/toon";

/**
 * Encode data as TOON format for reduced token usage (~40% savings).
 * Falls back to JSON if encoding fails.
 */
export function toToon(data: unknown): string {
	try {
		return encode(data);
	} catch {
		return JSON.stringify(data, null, 2);
	}
}
