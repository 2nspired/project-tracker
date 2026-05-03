import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const metadata = { title: "Input" };

/**
 * Primitives / Input — every state of `<Input>` and the `<Label>` /
 * `<Textarea>` siblings that pair with it.
 *
 * Pattern reference: shadcn's input docs lead with the four states
 * (default / focus / disabled / invalid) and pair every input with a
 * label. We do the same and add the Pigeon-specific search-input recipe
 * (icon-prefix via wrapper + `pl-9`) — that's the most common Input
 * variant in the product (board search, project search, settings filter).
 */
export default function InputShowcasePage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Primitive
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Input</h1>
				<p className="max-w-2xl text-muted-foreground">
					Single-density (h-9) text input. State styling is automatic from{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">:focus-visible</code> and{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">aria-invalid</code> — no
					additional classes needed. Always pair with a{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">&lt;Label&gt;</code>; the
					placeholder isn't a label substitute.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">States</h2>
				<div className="grid gap-4 rounded-lg border bg-card p-6 sm:grid-cols-2">
					<Field label="Default" id="state-default">
						<Input id="state-default" placeholder="Card title" />
					</Field>
					<Field label="With value" id="state-value">
						<Input id="state-value" defaultValue="Fill design showcase" />
					</Field>
					<Field label="Disabled" id="state-disabled">
						<Input id="state-disabled" disabled defaultValue="Read-only" />
					</Field>
					<Field label="Invalid" id="state-invalid" hint="Required">
						<Input id="state-invalid" aria-invalid placeholder="" />
					</Field>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Search recipe</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Icon-prefix is composed via a wrapper, not baked into the primitive — keeps the icon layer
					separate from the input's state styling.
				</p>
				<div className="rounded-lg border bg-card p-6">
					<div className="relative max-w-md">
						<Search
							className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden
						/>
						<Input
							type="search"
							placeholder="Search cards…"
							className="pl-9"
							aria-label="Search cards"
						/>
					</div>
				</div>
				<pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-2xs leading-relaxed text-muted-foreground">
					<code>{`<div className="relative">
  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
  <Input type="search" placeholder="Search cards…" className="pl-9" />
</div>`}</code>
				</pre>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Types</h2>
				<div className="grid gap-4 rounded-lg border bg-card p-6 sm:grid-cols-2">
					<Field label="Email" id="type-email">
						<Input id="type-email" type="email" placeholder="you@example.com" />
					</Field>
					<Field label="Number" id="type-number">
						<Input id="type-number" type="number" placeholder="0" inputMode="numeric" />
					</Field>
					<Field label="Date" id="type-date">
						<Input id="type-date" type="date" />
					</Field>
					<Field label="File" id="type-file">
						<Input id="type-file" type="file" />
					</Field>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Textarea</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Same focus / disabled / invalid states. Use for card descriptions, comments, handoff
					summaries — anything that wants more than one line of input.
				</p>
				<div className="rounded-lg border bg-card p-6">
					<Field label="Description" id="textarea-default">
						<Textarea
							id="textarea-default"
							placeholder="Why now / Plan / Out of scope / Acceptance"
							rows={5}
						/>
					</Field>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Don't</h2>
				<ul className="flex flex-col gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
					<li>
						Don't drop the label and rely on the placeholder — placeholders disappear on input.
					</li>
					<li>
						Don't pass <code className="rounded bg-muted px-1 font-mono text-xs">h-10</code> to
						match a button. Buttons are h-9 / h-8 / h-10; inputs are fixed at h-9. Aligning by hand
						sets the wrong height.
					</li>
					<li>
						Don't reach for a custom focus ring — the built-in{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">focus-visible:ring</code> is
						the canonical look.
					</li>
				</ul>
			</section>
		</div>
	);
}

function Field({
	label,
	id,
	hint,
	children,
}: {
	label: string;
	id: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between">
				<Label htmlFor={id}>{label}</Label>
				{hint && <span className="text-2xs text-muted-foreground">{hint}</span>}
			</div>
			{children}
		</div>
	);
}
