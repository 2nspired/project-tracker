import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
	icon?: LucideIcon;
	title: string;
	description?: string;
	children?: React.ReactNode;
	className?: string;
};

export function EmptyState({
	icon: Icon,
	title,
	description,
	children,
	className,
}: EmptyStateProps) {
	return (
		<div className={cn("flex flex-col items-center gap-3 py-12 text-center", className)}>
			{Icon && <Icon className="h-10 w-10 text-muted-foreground/40" />}
			<p className="font-medium text-muted-foreground">{title}</p>
			{description && <p className="max-w-md text-sm text-muted-foreground/80">{description}</p>}
			{children}
		</div>
	);
}
