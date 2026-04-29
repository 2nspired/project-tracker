import { User } from "lucide-react";

import { getActorIdentity, getInitials } from "@/lib/actor-colors";

type ActorChipProps = {
	actorType: "AGENT" | "HUMAN" | string;
	actorName?: string | null;
	size?: "xs" | "sm" | "md";
	showName?: boolean;
	className?: string;
};

const SIZES = {
	xs: { box: "h-3.5 w-3.5 text-[0.5rem]", icon: "h-2.5 w-2.5", initialChars: 1 },
	sm: { box: "h-4 w-4 text-[0.5rem]", icon: "h-2.5 w-2.5", initialChars: 2 },
	md: { box: "h-6 w-6 text-[0.6rem]", icon: "h-3 w-3", initialChars: 2 },
} as const;

export function ActorChip({
	actorType,
	actorName,
	size = "md",
	showName = false,
	className,
}: ActorChipProps) {
	const { isAgent, color, label } = getActorIdentity(actorType, actorName);
	const sizes = SIZES[size];
	const initials = getInitials(actorName).slice(0, sizes.initialChars);

	return (
		<span className={`inline-flex items-center gap-1 ${className ?? ""}`} title={label}>
			{isAgent ? (
				<span
					className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white ${sizes.box}`}
					style={{ backgroundColor: color }}
					role="img"
					aria-label={`${label} avatar`}
				>
					{initials}
				</span>
			) : (
				<span
					className={`inline-flex shrink-0 items-center justify-center rounded-full bg-muted-foreground/80 text-background ${sizes.box}`}
					role="img"
					aria-label="Human avatar"
				>
					<User className={sizes.icon} />
				</span>
			)}
			{showName && <span className="truncate text-[0.625rem] font-medium leading-4">{label}</span>}
		</span>
	);
}
