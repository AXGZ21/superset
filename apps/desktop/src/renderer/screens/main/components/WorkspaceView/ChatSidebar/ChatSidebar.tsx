import { Button } from "@superset/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { ScrollArea } from "@superset/ui/scroll-area";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	HiChevronDown,
	HiChevronUp,
	HiClock,
	HiComputerDesktop,
	HiEllipsisHorizontal,
	HiGlobeAlt,
	HiMicrophone,
	HiPhoto,
	HiPlus,
	HiTrash,
} from "react-icons/hi2";
import { LuAtSign, LuInfinity } from "react-icons/lu";
import { useChatSidebarStore } from "renderer/stores";
import { ChatMessage } from "./components/ChatMessage";

export function ChatSidebar() {
	const { activeThreadId, threads, createThread, deleteThread, addMessage } =
		useChatSidebarStore();

	const [inputValue, setInputValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const activeThread = threads.find((t) => t.id === activeThreadId);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, []);

	const handleSend = useCallback(() => {
		const content = inputValue.trim();
		if (!content) return;

		let threadId = activeThreadId;
		if (!threadId) {
			threadId = createThread();
		}

		addMessage(threadId, { role: "user", content });
		setInputValue("");

		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}

		// Simulated response
		setTimeout(() => {
			addMessage(threadId, {
				role: "assistant",
				content:
					"This is a simulated response. Connect your AI backend to enable real conversations.",
			});
		}, 800);
	}, [inputValue, activeThreadId, createThread, addMessage]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInputValue(e.target.value);
		const textarea = e.target;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
	};

	const handleNewChat = useCallback(() => {
		createThread();
		setInputValue("");
	}, [createThread]);

	return (
		<aside className="h-full flex flex-col bg-sidebar overflow-hidden">
			{/* Header with tabs */}
			<div className="flex items-center gap-1 px-2 pt-2 shrink-0">
				<Button
					variant="secondary"
					size="sm"
					className="h-7 px-2.5 text-xs font-medium"
				>
					New Chat
				</Button>
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="icon-sm"
					className="size-7"
					onClick={handleNewChat}
				>
					<HiPlus className="size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" className="size-7">
					<HiClock className="size-4" />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon-sm" className="size-7">
							<HiEllipsisHorizontal className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-40">
						<DropdownMenuItem onClick={handleNewChat}>
							<HiPlus className="size-4" />
							New chat
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => activeThreadId && deleteThread(activeThreadId)}
							disabled={!activeThreadId}
							className="text-destructive-foreground focus:text-destructive-foreground"
						>
							<HiTrash className="size-4" />
							Clear chat
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* Input area at top */}
			<div className="px-2 pt-2 shrink-0">
				<div className="rounded-lg border border-border bg-background">
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInput}
						onKeyDown={handleKeyDown}
						placeholder="Plan, @ for context, / for commands"
						rows={3}
						className="w-full resize-none bg-transparent px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 outline-none min-h-[80px]"
					/>
					{/* Toolbar */}
					<div className="flex items-center gap-1 px-2 pb-2">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="secondary"
									size="sm"
									className="h-7 gap-1.5 px-2 text-xs"
								>
									<LuInfinity className="size-3.5" />
									Agent
									<HiChevronDown className="size-3 opacity-50" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuItem>Agent</DropdownMenuItem>
								<DropdownMenuItem>Ask</DropdownMenuItem>
								<DropdownMenuItem>Edit</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 gap-1 px-2 text-xs text-muted-foreground"
								>
									Opus 4.5
									<HiChevronDown className="size-3 opacity-50" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuItem>Opus 4.5</DropdownMenuItem>
								<DropdownMenuItem>Sonnet 4</DropdownMenuItem>
								<DropdownMenuItem>GPT-4o</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<div className="flex-1" />
						<Button
							variant="ghost"
							size="icon-sm"
							className="size-7 text-muted-foreground"
						>
							<LuAtSign className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							className="size-7 text-muted-foreground"
						>
							<HiGlobeAlt className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							className="size-7 text-muted-foreground"
						>
							<HiPhoto className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							className="size-7 text-muted-foreground"
						>
							<HiMicrophone className="size-4" />
						</Button>
					</div>
				</div>
			</div>

			{/* Context selector */}
			<div className="px-2 pt-1.5 pb-2 shrink-0">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
						>
							<HiComputerDesktop className="size-3.5" />
							Local
							<HiChevronDown className="size-3 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<DropdownMenuItem>Local</DropdownMenuItem>
						<DropdownMenuItem>Remote</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* Messages area */}
			<ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
				{activeThread && activeThread.messages.length > 0 ? (
					<div className="flex flex-col py-2">
						{activeThread.messages.map((message) => (
							<ChatMessage key={message.id} message={message} />
						))}
					</div>
				) : (
					<div className="h-full" />
				)}
			</ScrollArea>

			{/* Past Chats at bottom */}
			<PastChats
				threads={threads}
				activeThreadId={activeThreadId}
				onSelect={(id) => useChatSidebarStore.getState().setActiveThread(id)}
			/>
		</aside>
	);
}

interface PastChatsProps {
	threads: Array<{ id: string; title: string; updatedAt: Date }>;
	activeThreadId: string | null;
	onSelect: (id: string) => void;
}

function PastChats({ threads, activeThreadId, onSelect }: PastChatsProps) {
	const [isOpen, setIsOpen] = useState(true);

	if (threads.length === 0) return null;

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className="border-t border-border/50"
		>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					{isOpen ? (
						<HiChevronDown className="size-3" />
					) : (
						<HiChevronUp className="size-3" />
					)}
					Past Chats
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="max-h-[120px] overflow-y-auto">
					{threads.map((thread) => (
						<button
							key={thread.id}
							type="button"
							onClick={() => onSelect(thread.id)}
							className={`flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors ${
								thread.id === activeThreadId ? "bg-accent/30" : ""
							}`}
						>
							<span className="truncate text-foreground/80">
								{thread.title}
							</span>
							<span className="text-xs text-muted-foreground/60 shrink-0 ml-2">
								{formatRelativeTime(thread.updatedAt)}
							</span>
						</button>
					))}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function formatRelativeTime(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMins < 1) return "now";
	if (diffMins < 60) return `${diffMins}m`;
	if (diffHours < 24) return `${diffHours}h`;
	return `${diffDays}d`;
}
