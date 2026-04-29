"use client";

import {
	Bold,
	Code,
	Eye,
	Heading2,
	Italic,
	Link,
	List as ListIcon,
	ListOrdered,
	Quote,
} from "lucide-react";
import { useCallback, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";

// ─── Toolbar helpers ──────────────────────────────────────────────

type InsertAction = {
	label: string;
	icon: React.ReactNode;
	prefix: string;
	suffix?: string;
	block?: boolean;
};

const toolbarActions: InsertAction[] = [
	{ label: "Bold", icon: <Bold className="h-3.5 w-3.5" />, prefix: "**", suffix: "**" },
	{ label: "Italic", icon: <Italic className="h-3.5 w-3.5" />, prefix: "_", suffix: "_" },
	{ label: "Heading", icon: <Heading2 className="h-3.5 w-3.5" />, prefix: "## ", block: true },
	{ label: "Quote", icon: <Quote className="h-3.5 w-3.5" />, prefix: "> ", block: true },
	{ label: "Bullet list", icon: <ListIcon className="h-3.5 w-3.5" />, prefix: "- ", block: true },
	{
		label: "Numbered list",
		icon: <ListOrdered className="h-3.5 w-3.5" />,
		prefix: "1. ",
		block: true,
	},
	{ label: "Code", icon: <Code className="h-3.5 w-3.5" />, prefix: "`", suffix: "`" },
	{ label: "Link", icon: <Link className="h-3.5 w-3.5" />, prefix: "[", suffix: "](url)" },
];

function applyToolbarAction(
	textarea: HTMLTextAreaElement,
	action: InsertAction,
	content: string,
	setContent: (v: string) => void
) {
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const selected = content.slice(start, end);

	let insertion: string;
	let cursorOffset: number;

	if (action.block) {
		const lineStart = content.lastIndexOf("\n", start - 1) + 1;
		const before = content.slice(0, lineStart);
		const after = content.slice(lineStart);
		insertion = `${before}${action.prefix}${after}`;
		cursorOffset = lineStart + action.prefix.length;
	} else {
		const suffix = action.suffix ?? "";
		const wrapped = `${action.prefix}${selected || "text"}${suffix}`;
		insertion = content.slice(0, start) + wrapped + content.slice(end);
		cursorOffset = selected ? start + wrapped.length : start + action.prefix.length;
	}

	setContent(insertion);
	requestAnimationFrame(() => {
		textarea.focus();
		const pos = cursorOffset;
		textarea.setSelectionRange(pos, selected ? pos : pos + (selected ? 0 : 4));
	});
}

// ─── Component ────────────────────────────────────────────────────

type MarkdownEditorProps = {
	content: string;
	setContent: (v: string) => void;
	preview: boolean;
	setPreview: (v: boolean) => void;
	rows?: number;
	placeholder?: string;
	previewMinHeight?: string;
	onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
	onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
	autoFocus?: boolean;
};

export function MarkdownEditor({
	content,
	setContent,
	preview,
	setPreview,
	rows,
	placeholder,
	previewMinHeight,
	onKeyDown,
	onBlur,
	autoFocus,
}: MarkdownEditorProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleToolbar = useCallback(
		(action: InsertAction) => {
			if (!textareaRef.current) return;
			applyToolbarAction(textareaRef.current, action, content, setContent);
		},
		[content, setContent]
	);

	return (
		<div>
			{preview ? (
				<div
					className={`rounded-md border bg-background p-3 text-sm ${previewMinHeight ?? "min-h-[200px]"}`}
				>
					{content ? (
						<Markdown>{content}</Markdown>
					) : (
						<p className="text-muted-foreground">Nothing to preview</p>
					)}
				</div>
			) : (
				<>
					<div className="flex items-center justify-between rounded-t-md border border-b-0 bg-muted/30 px-1 py-1">
						<div className="flex flex-wrap gap-0.5">
							{toolbarActions.map((action) => (
								<Button
									key={action.label}
									type="button"
									variant="ghost"
									size="icon"
									className="h-7 w-7"
									title={action.label}
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => handleToolbar(action)}
								>
									{action.icon}
								</Button>
							))}
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 gap-1.5 text-xs"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => setPreview(true)}
						>
							<Eye className="h-3.5 w-3.5" />
							Preview
						</Button>
					</div>
					<Textarea
						ref={textareaRef}
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder={placeholder ?? "Details, context, links..."}
						rows={rows ?? 20}
						className="rounded-t-none font-mono text-sm"
						onKeyDown={onKeyDown}
						onBlur={onBlur}
						autoFocus={autoFocus}
					/>
				</>
			)}
		</div>
	);
}
