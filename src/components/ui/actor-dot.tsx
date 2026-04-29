import { getActorIdentity } from "@/lib/actor-colors";

type ActorDotProps = {
	actorType: "AGENT" | "HUMAN" | string;
	actorName?: string | null;
	size?: number;
	className?: string;
};

/**
 * Smallest possible actor identity marker. Agents get a filled pip in their
 * hashed chart color; humans get a hollow ring in the neutral muted color.
 * Use in high-density contexts where a full ActorChip would overpower.
 */
export function ActorDot({ actorType, actorName, size = 6, className }: ActorDotProps) {
	const { isAgent, color, label } = getActorIdentity(actorType, actorName);
	return (
		<span
			className={`inline-block shrink-0 rounded-full ${className ?? ""}`}
			style={{
				width: size,
				height: size,
				backgroundColor: isAgent ? color : "transparent",
				border: isAgent ? "none" : `1px solid ${color}`,
			}}
			title={label}
			role="img"
			aria-label={`${label} indicator`}
		/>
	);
}
