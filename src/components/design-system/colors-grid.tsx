"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ColorSwatch } from "./color-swatch";
import {
	COLOR_TOKEN_GROUPS,
	COLOR_TOKENS,
	type ColorToken,
	type ColorTokenGroup,
} from "./token-registry";

type Mode = "light" | "dark";

interface ResolvedTokenValues {
	light: Record<string, string>;
	dark: Record<string, string>;
}

const EMPTY: ResolvedTokenValues = { light: {}, dark: {} };

/**
 * Side-by-side Light + Dark grid of every color token.
 *
 * Resolution strategy: rather than read CSS variable values from the live
 * `<html>` element (which would only give us one mode at a time), we mount
 * two off-screen probe elements — one with `.dark` class, one without — and
 * call `getComputedStyle` on each to extract every token's resolved value in
 * both modes. This keeps the page's own theme (light or dark) decoupled from
 * what we render — adding a new var to `globals.css` and listing it in the
 * registry surfaces both columns automatically.
 */
export function ColorsGrid() {
	const [resolved, setResolved] = useState<ResolvedTokenValues>(EMPTY);
	const lightProbeRef = useRef<HTMLDivElement | null>(null);
	const darkProbeRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const lightEl = lightProbeRef.current;
		const darkEl = darkProbeRef.current;
		if (!lightEl || !darkEl) return;

		const lightStyle = getComputedStyle(lightEl);
		const darkStyle = getComputedStyle(darkEl);

		const next: ResolvedTokenValues = { light: {}, dark: {} };
		for (const token of COLOR_TOKENS) {
			next.light[token.name] = lightStyle.getPropertyValue(`--${token.name}`).trim();
			next.dark[token.name] = darkStyle.getPropertyValue(`--${token.name}`).trim();
		}
		setResolved(next);
	}, []);

	const grouped = useMemo(() => groupTokens(COLOR_TOKENS), []);

	return (
		<>
			{/* Off-screen probes — present in DOM so getComputedStyle resolves
			    against globals.css :root and .dark rule sets. We pin them to
			    `position: fixed` with zero size so they don't affect layout. */}
			<div
				ref={lightProbeRef}
				aria-hidden="true"
				className="pointer-events-none fixed -top-1 -left-1 size-0 overflow-hidden"
			/>
			<div
				ref={darkProbeRef}
				aria-hidden="true"
				className="dark pointer-events-none fixed -top-1 -left-1 size-0 overflow-hidden"
			/>

			<div className="flex flex-col gap-12">
				{COLOR_TOKEN_GROUPS.map((group) => {
					const tokens = grouped[group];
					if (!tokens || tokens.length === 0) return null;
					return (
						<section
							key={group}
							aria-labelledby={`group-${slug(group)}`}
							className="flex flex-col gap-4"
						>
							<h2
								id={`group-${slug(group)}`}
								className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
							>
								{group}
							</h2>
							<div className="grid gap-6 lg:grid-cols-2">
								<ModeColumn mode="light" tokens={tokens} values={resolved.light} />
								<ModeColumn mode="dark" tokens={tokens} values={resolved.dark} />
							</div>
						</section>
					);
				})}
			</div>
		</>
	);
}

interface ModeColumnProps {
	mode: Mode;
	tokens: ColorToken[];
	values: Record<string, string>;
}

function ModeColumn({ mode, tokens, values }: ModeColumnProps) {
	const isDark = mode === "dark";
	return (
		<div className={isDark ? "dark" : undefined} data-design-system-mode={mode}>
			{/* Wrapping in `bg-background` makes each column self-contained — its
			    own dark or light surface, regardless of the page's theme mode. */}
			<div className="rounded-xl border bg-background p-4 text-foreground">
				<div className="mb-3 flex items-center justify-between">
					<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						{mode}
					</span>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					{tokens.map((token) => (
						<ColorSwatch key={token.name} token={token} value={values[token.name] ?? ""} />
					))}
				</div>
			</div>
		</div>
	);
}

function groupTokens(tokens: ColorToken[]): Record<ColorTokenGroup, ColorToken[]> {
	const out = {} as Record<ColorTokenGroup, ColorToken[]>;
	for (const group of COLOR_TOKEN_GROUPS) {
		out[group] = [];
	}
	for (const token of tokens) {
		out[token.group].push(token);
	}
	return out;
}

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
