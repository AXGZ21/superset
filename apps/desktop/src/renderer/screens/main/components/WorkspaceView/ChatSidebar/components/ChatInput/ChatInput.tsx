import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/lib/utils";
import { useCallback, useRef, useState } from "react";
import { HiArrowUp, HiStop } from "react-icons/hi2";

interface ChatInputProps {
	onSend: (message: string) => void;
	isLoading?: boolean;
	onStop?: () => void;
	placeholder?: string;
}

export function ChatInput({
	onSend,
	isLoading = false,
	onStop,
	placeholder = "Message...",
}: ChatInputProps) {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleSubmit = useCallback(() => {
		const trimmed = value.trim();
		if (!trimmed || isLoading) return;

		onSend(trimmed);
		setValue("");

		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}
	}, [value, isLoading, onSend]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setValue(e.target.value);
		const textarea = e.target;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
	};

	const canSend = value.trim().length > 0 && !isLoading;

	return (
		<div className="p-3">
			<div className="relative flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-muted-foreground/50 transition-colors">
				<textarea
					ref={textareaRef}
					value={value}
					onChange={handleInput}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					rows={1}
					className={cn(
						"flex-1 resize-none bg-transparent text-sm",
						"placeholder:text-muted-foreground/50",
						"outline-none",
						"min-h-[20px] max-h-[120px]",
					)}
				/>

				{isLoading ? (
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={onStop}
						className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
					>
						<HiStop className="size-4" />
					</Button>
				) : (
					<Button
						variant="default"
						size="icon-sm"
						onClick={handleSubmit}
						disabled={!canSend}
						className={cn(
							"size-7 rounded-lg transition-opacity",
							!canSend && "opacity-50",
						)}
					>
						<HiArrowUp className="size-4" />
					</Button>
				)}
			</div>
		</div>
	);
}
