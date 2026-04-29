"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

export const Markdown = memo(function Markdown({ children }: { children: string }) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm, remarkBreaks]}
			components={{
				p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
				ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
				ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
				li: ({ children }) => <li className="mb-0.5">{children}</li>,
				code: ({ children, className }) => {
					const isBlock = className?.includes("language-");
					if (isBlock) {
						return (
							<code className="block overflow-x-auto rounded bg-muted p-2 text-xs">{children}</code>
						);
					}
					return <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>;
				},
				pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
				a: ({ children, href }) => (
					<a
						href={href}
						className="text-primary underline"
						target="_blank"
						rel="noopener noreferrer"
					>
						{children}
					</a>
				),
				strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
				blockquote: ({ children }) => (
					<blockquote className="mb-2 border-l-2 border-muted-foreground/30 pl-3 italic last:mb-0">
						{children}
					</blockquote>
				),
				h1: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
				h2: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
				h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
				table: ({ children }) => (
					<table className="mb-2 w-full border-collapse text-xs last:mb-0">{children}</table>
				),
				th: ({ children }) => (
					<th className="border border-border bg-muted px-2 py-1 text-left font-medium">
						{children}
					</th>
				),
				td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
			}}
		>
			{children}
		</ReactMarkdown>
	);
});
