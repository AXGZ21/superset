"use client";

import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@superset/ui/card";
import { Input } from "@superset/ui/input";
import { ScrollArea } from "@superset/ui/scroll-area";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
	LuChevronLeft,
	LuCircle,
	LuCloud,
	LuGitBranch,
	LuGithub,
	LuLoader,
	LuSend,
	LuSquare,
	LuTerminal,
	LuWifi,
	LuWifiOff,
} from "react-icons/lu";

import { env } from "@/env";
import { type CloudEvent, useCloudSession } from "../../hooks";

type GroupedEvent =
	| { type: "assistant_message"; id: string; text: string }
	| { type: "user_message"; id: string; content: string }
	| { type: "other"; event: CloudEvent };

function groupEvents(events: CloudEvent[]): GroupedEvent[] {
	const result: GroupedEvent[] = [];
	let currentTokenGroup: { id: string; tokens: string[] } | null = null;

	for (const event of events) {
		if (event.type === "heartbeat") continue;

		if (event.type === "user_message") {
			// Flush any pending tokens before user message
			if (currentTokenGroup) {
				result.push({
					type: "assistant_message",
					id: currentTokenGroup.id,
					text: currentTokenGroup.tokens.join(""),
				});
				currentTokenGroup = null;
			}
			const data = event.data as { content?: string };
			result.push({
				type: "user_message",
				id: event.id,
				content: data.content || "",
			});
		} else if (event.type === "token") {
			const data = event.data as { token?: string };
			if (data.token) {
				if (!currentTokenGroup) {
					currentTokenGroup = { id: event.id, tokens: [] };
				}
				currentTokenGroup.tokens.push(data.token);
			}
		} else {
			if (currentTokenGroup) {
				result.push({
					type: "assistant_message",
					id: currentTokenGroup.id,
					text: currentTokenGroup.tokens.join(""),
				});
				currentTokenGroup = null;
			}
			result.push({ type: "other", event });
		}
	}

	if (currentTokenGroup) {
		result.push({
			type: "assistant_message",
			id: currentTokenGroup.id,
			text: currentTokenGroup.tokens.join(""),
		});
	}

	return result;
}

interface CloudWorkspace {
	id: string;
	sessionId: string;
	title: string;
	repoOwner: string;
	repoName: string;
	branch: string;
	baseBranch: string;
	status: string;
	sandboxStatus: string | null;
	model: string | null;
	linearIssueKey: string | null;
	prUrl: string | null;
	prNumber: number | null;
	createdAt: Date;
	updatedAt: Date;
}

interface CloudWorkspaceContentProps {
	workspace: CloudWorkspace;
}

const CONTROL_PLANE_URL =
	env.NEXT_PUBLIC_CONTROL_PLANE_URL ||
	"https://superset-control-plane.avi-6ac.workers.dev";

export function CloudWorkspaceContent({
	workspace,
}: CloudWorkspaceContentProps) {
	const [promptInput, setPromptInput] = useState("");
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const {
		isConnected,
		isConnecting,
		isLoadingHistory,
		error,
		sessionState,
		events,
		sendPrompt,
		sendStop,
	} = useCloudSession({
		controlPlaneUrl: CONTROL_PLANE_URL,
		sessionId: workspace.sessionId,
	});

	// Auto-scroll to bottom when new events arrive
	useEffect(() => {
		if (scrollAreaRef.current) {
			const scrollContainer = scrollAreaRef.current.querySelector(
				"[data-radix-scroll-area-viewport]",
			);
			if (scrollContainer) {
				scrollContainer.scrollTop = scrollContainer.scrollHeight;
			}
		}
	}, []);

	const handleSendPrompt = useCallback(() => {
		if (promptInput.trim() && isConnected) {
			sendPrompt(promptInput.trim());
			setPromptInput("");
			inputRef.current?.focus();
		}
	}, [promptInput, isConnected, sendPrompt]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSendPrompt();
			}
		},
		[handleSendPrompt],
	);

	const isExecuting =
		sessionState?.status === "executing" ||
		workspace.sandboxStatus === "running";

	const groupedEvents = useMemo(() => groupEvents(events), [events]);

	return (
		<div className="flex h-screen flex-col bg-background">
			{/* Header */}
			<header className="flex items-center gap-3 border-b px-4 py-3">
				<Link
					href="/cloud"
					className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
				>
					<LuChevronLeft className="size-4" />
					<LuCloud className="size-5" />
				</Link>
				<div className="flex-1">
					<h1 className="text-lg font-semibold">{workspace.title}</h1>
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<LuGithub className="size-3.5" />
						<span>
							{workspace.repoOwner}/{workspace.repoName}
						</span>
						<LuGitBranch className="ml-2 size-3.5" />
						<span>{workspace.branch}</span>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{/* Connection status */}
					<Badge
						variant={isConnected ? "default" : "secondary"}
						className="gap-1"
					>
						{isConnecting ? (
							<LuLoader className="size-3 animate-spin" />
						) : isConnected ? (
							<LuWifi className="size-3" />
						) : (
							<LuWifiOff className="size-3" />
						)}
						{isConnecting
							? "Connecting..."
							: isConnected
								? "Connected"
								: "Disconnected"}
					</Badge>
					<Badge variant="outline">{workspace.status}</Badge>
					{workspace.sandboxStatus && (
						<Badge
							variant={
								workspace.sandboxStatus === "ready" ? "default" : "secondary"
							}
						>
							{workspace.sandboxStatus}
						</Badge>
					)}
				</div>
			</header>

			{/* Main content area */}
			<main className="flex min-h-0 flex-1 flex-col">
				{/* Events display */}
				<ScrollArea ref={scrollAreaRef} className="flex-1 p-4 h-full">
					<div className="space-y-2">
						{events.length === 0 && !error && (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-base">
										<LuTerminal className="size-4" />
										Cloud Terminal
									</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-sm text-muted-foreground">
										{isConnected
											? "Connected to cloud workspace. Send a prompt to start."
											: isConnecting
												? "Connecting to cloud workspace..."
												: "Waiting for connection..."}
									</p>
								</CardContent>
							</Card>
						)}

						{error && (
							<Card className="border-destructive">
								<CardContent className="pt-4">
									<p className="text-sm text-destructive">{error}</p>
								</CardContent>
							</Card>
						)}

						{isLoadingHistory && isConnected && events.length === 0 && (
							<div className="flex items-center justify-center py-4">
								<LuLoader className="size-5 animate-spin text-muted-foreground" />
								<span className="ml-2 text-sm text-muted-foreground">
									Loading history...
								</span>
							</div>
						)}

						{groupedEvents.map((grouped) => {
							if (grouped.type === "user_message") {
								return (
									<UserMessage key={grouped.id} content={grouped.content} />
								);
							}
							if (grouped.type === "assistant_message") {
								return (
									<AssistantMessage key={grouped.id} text={grouped.text} />
								);
							}
							return <EventItem key={grouped.event.id} event={grouped.event} />;
						})}
					</div>
				</ScrollArea>

				{/* Prompt input */}
				<div className="border-t p-4">
					<div className="flex gap-2">
						<Input
							ref={inputRef}
							value={promptInput}
							onChange={(e) => setPromptInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={
								isConnected
									? "Send a prompt to Claude..."
									: "Connecting to cloud workspace..."
							}
							disabled={!isConnected}
							className="flex-1"
						/>
						{isExecuting ? (
							<Button
								variant="destructive"
								onClick={sendStop}
								disabled={!isConnected}
							>
								<LuSquare className="mr-2 size-4" />
								Stop
							</Button>
						) : (
							<Button
								onClick={handleSendPrompt}
								disabled={!isConnected || !promptInput.trim()}
							>
								<LuSend className="mr-2 size-4" />
								Send
							</Button>
						)}
					</div>
				</div>
			</main>
		</div>
	);
}

interface EventItemProps {
	event: CloudEvent;
}

function EventItem({ event }: EventItemProps) {
	const getEventContent = () => {
		switch (event.type) {
			case "token": {
				const data = event.data as { token?: string };
				return (
					<span className="font-mono text-sm whitespace-pre-wrap">
						{data.token}
					</span>
				);
			}

			case "tool_call": {
				const data = event.data as {
					name?: string;
					input?: Record<string, unknown>;
				};
				return (
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<Badge variant="outline" className="text-xs">
								Tool Call
							</Badge>
							<span className="font-mono text-sm font-medium">{data.name}</span>
						</div>
						{data.input && (
							<pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
								{JSON.stringify(data.input, null, 2)}
							</pre>
						)}
					</div>
				);
			}

			case "tool_result": {
				const data = event.data as { result?: unknown; error?: string };
				return (
					<div className="space-y-1">
						<Badge variant="secondary" className="text-xs">
							Tool Result
						</Badge>
						{data.error ? (
							<pre className="text-xs bg-destructive/10 text-destructive p-2 rounded overflow-x-auto">
								{data.error}
							</pre>
						) : (
							<pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40 overflow-y-auto">
								{typeof data.result === "string"
									? data.result
									: JSON.stringify(data.result, null, 2)}
							</pre>
						)}
					</div>
				);
			}

			case "error": {
				const data = event.data as { message?: string };
				return (
					<div className="text-destructive">
						<Badge variant="destructive" className="text-xs mb-1">
							Error
						</Badge>
						<p className="text-sm">{data.message || "Unknown error"}</p>
					</div>
				);
			}

			case "git_sync": {
				const data = event.data as {
					status?: string;
					action?: string;
					branch?: string;
					repo?: string;
				};
				const action = data.status || data.action || "syncing";
				const detail = data.branch || data.repo || "";
				return (
					<div className="flex items-center gap-2 text-muted-foreground">
						<LuGitBranch className="size-4" />
						<span className="text-sm">
							{action}
							{detail ? `: ${detail}` : ""}
						</span>
					</div>
				);
			}

			case "execution_complete": {
				return (
					<div className="flex items-center gap-2 text-green-600">
						<LuCircle className="size-3 fill-current" />
						<span className="text-sm font-medium">Execution complete</span>
					</div>
				);
			}

			case "heartbeat":
				return null;

			default:
				return (
					<pre className="text-xs text-muted-foreground">
						{JSON.stringify(event.data, null, 2)}
					</pre>
				);
		}
	};

	// Don't render heartbeat events
	if (event.type === "heartbeat") {
		return null;
	}

	return (
		<div className="rounded-lg border bg-card p-3 text-card-foreground">
			{getEventContent()}
		</div>
	);
}

function UserMessage({ content }: { content: string }) {
	return (
		<div className="rounded-lg border bg-accent/10 p-3 text-card-foreground">
			<div className="flex items-start gap-2">
				<span className="text-xs font-medium text-accent">You</span>
			</div>
			<p className="mt-1 text-sm whitespace-pre-wrap">{content}</p>
		</div>
	);
}

function AssistantMessage({ text }: { text: string }) {
	return (
		<div className="rounded-lg border bg-card p-3 text-card-foreground">
			<div className="prose prose-sm dark:prose-invert max-w-none">
				<pre className="font-mono text-sm whitespace-pre-wrap bg-transparent p-0 m-0 overflow-x-auto">
					{text}
				</pre>
			</div>
		</div>
	);
}
