import { HiSparkles } from "react-icons/hi2";
import type { ChatMessage as ChatMessageType } from "renderer/stores/chat-sidebar-state";

interface ChatMessageProps {
	message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
	const isUser = message.role === "user";

	if (isUser) {
		return (
			<div className="flex justify-end px-4 py-2">
				<div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5">
					<p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
						{message.content}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="px-4 py-3">
			<div className="flex items-start gap-3">
				<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent mt-0.5">
					<HiSparkles className="size-3.5 text-muted-foreground" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
						{message.content}
					</p>
				</div>
			</div>
		</div>
	);
}
