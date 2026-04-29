import { cn } from "@/lib/utils";

interface SectionHeaderProps {
	children: React.ReactNode;
	className?: string;
}

export function SectionHeader({ children, className }: SectionHeaderProps) {
	return (
		<h3
			className={cn(
				"text-xs font-medium uppercase tracking-wider text-muted-foreground",
				className
			)}
		>
			{children}
		</h3>
	);
}
