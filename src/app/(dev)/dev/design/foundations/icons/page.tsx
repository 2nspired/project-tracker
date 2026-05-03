import {
	Activity,
	Archive,
	ArrowRight,
	Bot,
	Calendar,
	Check,
	ChevronRight,
	Clock,
	Columns3,
	Copy,
	ExternalLink,
	FileText,
	FolderKanban,
	GitMerge,
	GripVertical,
	Hash,
	HelpCircle,
	Inbox,
	Info,
	LayoutDashboard,
	List,
	type LucideIcon,
	Maximize2,
	MessageSquare,
	Minimize2,
	Moon,
	NotebookPen,
	Pencil,
	Plus,
	RefreshCw,
	Save,
	Search,
	Settings2,
	Sparkles,
	StickyNote,
	Sun,
	Tag,
	Target,
	Trash2,
	User,
	X,
} from "lucide-react";

export const metadata = { title: "Icons" };

interface SizeRow {
	cls: string;
	resolved: string;
	intent: string;
}

/**
 * Three sizes carry ~95% of the in-product icon volume. `size-2` slots into
 * the data ornaments (sparkline dots, agent badges, the inline `<X>` on a
 * banner). Anything larger lives in dialog headers / empty states and is
 * composed per surface.
 */
const SIZES: SizeRow[] = [
	{
		cls: "size-3",
		resolved: "12px",
		intent: "Inline metadata icons (card byline clock, age indicator, badge `<svg>`s).",
	},
	{
		cls: "size-4",
		resolved: "16px (default)",
		intent: "The default — buttons, segmented controls, table-row affordances, links.",
	},
	{
		cls: "size-5",
		resolved: "20px",
		intent: "Section headers and dialog titles where the icon is part of the headline composition.",
	},
];

interface IconRow {
	icon: LucideIcon;
	name: string;
	usage: string;
}

/**
 * The set the app actually consumes. Lucide ships ~1500 icons; we use ~50.
 * Listed in the order they show up in the product (board → costs →
 * design-system → settings) so a new contributor can scan for "the icon I
 * already saw somewhere."
 */
const ICONS: IconRow[] = [
	{ icon: Plus, name: "Plus", usage: "Create card / project / column" },
	{ icon: X, name: "X", usage: "Close / dismiss" },
	{ icon: Check, name: "Check", usage: "Confirm / done" },
	{ icon: Search, name: "Search", usage: "Search input affordance" },
	{ icon: Settings2, name: "Settings2", usage: "Filters / settings panel" },
	{ icon: Pencil, name: "Pencil", usage: "Inline edit" },
	{ icon: Trash2, name: "Trash2", usage: "Destructive remove" },
	{ icon: Save, name: "Save", usage: "Form save action" },
	{ icon: Copy, name: "Copy", usage: "Copy-to-clipboard buttons" },
	{ icon: ExternalLink, name: "ExternalLink", usage: "Open in new tab" },
	{ icon: ArrowRight, name: "ArrowRight", usage: "Forward navigation" },
	{ icon: ChevronRight, name: "ChevronRight", usage: "Sidebar / dropdown disclosure" },
	{ icon: GripVertical, name: "GripVertical", usage: "Drag handle" },
	{ icon: Bot, name: "Bot", usage: "Agent attribution" },
	{ icon: User, name: "User", usage: "Human attribution" },
	{ icon: Sparkles, name: "Sparkles", usage: "AI signal / score chip" },
	{ icon: Hash, name: "Hash", usage: "Card number prefix" },
	{ icon: Tag, name: "Tag", usage: "Tag chips" },
	{ icon: Calendar, name: "Calendar", usage: "Due date" },
	{ icon: Clock, name: "Clock", usage: "Age / timestamp" },
	{ icon: FileText, name: "FileText", usage: "Description / docs" },
	{ icon: NotebookPen, name: "NotebookPen", usage: "Notes / handoffs" },
	{ icon: StickyNote, name: "StickyNote", usage: "Quick note / comment" },
	{ icon: MessageSquare, name: "MessageSquare", usage: "Comment thread" },
	{ icon: GitMerge, name: "GitMerge", usage: "Linked commit / PR" },
	{ icon: FolderKanban, name: "FolderKanban", usage: "Project switcher" },
	{ icon: LayoutDashboard, name: "LayoutDashboard", usage: "Dashboard" },
	{ icon: Activity, name: "Activity", usage: "Activity feed" },
	{ icon: Archive, name: "Archive", usage: "Archived columns / cards" },
	{ icon: Inbox, name: "Inbox", usage: "EmptyState illustration default" },
	{ icon: Info, name: "Info", usage: "Inline info / tooltip trigger" },
	{ icon: HelpCircle, name: "HelpCircle", usage: "Costs explainer link" },
	{ icon: RefreshCw, name: "RefreshCw", usage: "Recalibrate / refresh" },
	{ icon: Columns3, name: "Columns3", usage: "Kanban view toggle" },
	{ icon: List, name: "List", usage: "List view toggle" },
	{ icon: Maximize2, name: "Maximize2", usage: "Density: expanded" },
	{ icon: Target, name: "Target", usage: "Density: focus" },
	{ icon: Minimize2, name: "Minimize2", usage: "Density: compact" },
	{ icon: Sun, name: "Sun", usage: "Theme toggle (light)" },
	{ icon: Moon, name: "Moon", usage: "Theme toggle (dark)" },
];

/**
 * Foundations / Icons — the lucide-react set the product uses, sized and
 * stroked to match the rest of the system.
 *
 * Pattern reference: shadcn's icon docs lead with size + stroke (the two
 * decisions a contributor actually makes), then list the catalog. Stroke is
 * fixed at lucide's default `1.5` — overriding it locally drifts the visual
 * weight against the rest of the surface, so don't.
 *
 * Color binds to `currentColor` — pick the icon's parent text utility
 * (`text-muted-foreground`, `text-success`, etc.) and the icon picks it up
 * automatically. Never pass a raw color class to an icon.
 */
export default function IconsPage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Foundations
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Icons</h1>
				<p className="max-w-2xl text-muted-foreground">
					Pigeon uses <code className="rounded bg-muted px-1 font-mono text-xs">lucide-react</code>.
					Stroke is locked to lucide's default; color binds to{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">currentColor</code> via the
					parent's text utility — pick the parent's tone and the icon follows.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Sizes</h2>
				<div className="flex flex-wrap items-end gap-8 rounded-lg border bg-card p-6">
					{SIZES.map((s) => (
						<div key={s.cls} className="flex flex-col items-center gap-2">
							<Sparkles className={s.cls} aria-hidden />
							<code className="font-mono text-2xs text-muted-foreground">{s.cls}</code>
							<code className="font-mono text-2xs text-muted-foreground tabular-nums">
								{s.resolved}
							</code>
						</div>
					))}
				</div>
				<div className="flex flex-col gap-3">
					{SIZES.map((s) => (
						<div key={s.cls} className="rounded-lg border bg-card p-4 text-sm">
							<code className="font-mono text-2xs text-muted-foreground">{s.cls}</code>
							<p className="mt-1 text-muted-foreground">{s.intent}</p>
						</div>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Tone (binds to text color)</h2>
				<div className="flex flex-wrap items-center gap-6 rounded-lg border bg-card p-6 text-sm">
					<div className="flex items-center gap-2 text-muted-foreground">
						<Info className="size-4" />
						<span>text-muted-foreground</span>
					</div>
					<div className="flex items-center gap-2 text-success">
						<Check className="size-4" />
						<span>text-success</span>
					</div>
					<div className="flex items-center gap-2 text-warning">
						<Clock className="size-4" />
						<span>text-warning</span>
					</div>
					<div className="flex items-center gap-2 text-danger">
						<Trash2 className="size-4" />
						<span>text-danger</span>
					</div>
					<div className="flex items-center gap-2 text-info">
						<HelpCircle className="size-4" />
						<span>text-info</span>
					</div>
					<div className="flex items-center gap-2 text-accent-violet">
						<Bot className="size-4" />
						<span>text-accent-violet (agent)</span>
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Catalog</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					The forty-ish icons that ship in the app today. Lucide carries ~1500 — pick from this list
					before reaching into the wider set, so the visual vocabulary stays tight.
				</p>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{ICONS.map(({ icon: Icon, name, usage }) => (
						<div
							key={name}
							className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5"
						>
							<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
							<div className="flex min-w-0 flex-col">
								<code className="truncate font-mono text-2xs">{name}</code>
								<span className="truncate text-2xs text-muted-foreground">{usage}</span>
							</div>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
