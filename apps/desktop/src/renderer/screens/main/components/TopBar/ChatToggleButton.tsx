import { Button } from "@superset/ui/button";
import { Kbd, KbdGroup } from "@superset/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { HiChatBubbleLeftRight, HiSparkles } from "react-icons/hi2";
import { useChatSidebarStore } from "renderer/stores";
import { HOTKEYS } from "shared/hotkeys";

export function ChatToggleButton() {
	const { isOpen, toggle } = useChatSidebarStore();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					onClick={toggle}
					aria-label="Toggle chat"
					className="no-drag"
				>
					{isOpen ? (
						<HiSparkles className="size-4" />
					) : (
						<HiChatBubbleLeftRight className="size-4" />
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom" showArrow={false}>
				<span className="flex items-center gap-2">
					Toggle chat
					<KbdGroup>
						{HOTKEYS.TOGGLE_CHAT.display.map((key) => (
							<Kbd key={key}>{key}</Kbd>
						))}
					</KbdGroup>
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
