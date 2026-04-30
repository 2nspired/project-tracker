"use client";

import { useEffect, useState } from "react";

// SSR-safe matchMedia subscription. Returns `false` during the server
// pre-render and the very first client paint, then flips to the real
// value on mount. Callers that need a stable value across SSR/CSR should
// gate their UI on a separate "mounted" flag — most don't, because the
// brief flash of the mobile fallback during hydration is acceptable.
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(false);

	useEffect(() => {
		const mql = window.matchMedia(query);
		setMatches(mql.matches);
		const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, [query]);

	return matches;
}
