import { create } from "zustand";

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: Date;
}

export interface ChatThread {
	id: string;
	title: string;
	messages: ChatMessage[];
	createdAt: Date;
	updatedAt: Date;
}

interface ChatSidebarState {
	isOpen: boolean;
	size: number;
	isResizing: boolean;
	activeThreadId: string | null;
	threads: ChatThread[];

	// Actions
	toggle: () => void;
	open: () => void;
	close: () => void;
	setSize: (size: number) => void;
	setIsResizing: (isResizing: boolean) => void;

	// Thread actions
	createThread: () => string;
	setActiveThread: (id: string | null) => void;
	deleteThread: (id: string) => void;

	// Message actions
	addMessage: (
		threadId: string,
		message: Omit<ChatMessage, "id" | "timestamp">,
	) => void;
	updateMessage: (threadId: string, messageId: string, content: string) => void;
}

const generateId = () => Math.random().toString(36).substring(2, 15);

export const useChatSidebarStore = create<ChatSidebarState>((set, _get) => ({
	isOpen: false,
	size: 35,
	isResizing: false,
	activeThreadId: null,
	threads: [],

	toggle: () =>
		set((state) => ({
			isOpen: !state.isOpen,
			size: !state.isOpen ? Math.max(state.size, 35) : state.size,
		})),
	open: () =>
		set((state) => ({ isOpen: true, size: Math.max(state.size, 35) })),
	close: () => set({ isOpen: false }),
	setSize: (size) => set({ size: size > 0 ? size : 35 }),
	setIsResizing: (isResizing) => set({ isResizing }),

	createThread: () => {
		const id = generateId();
		const newThread: ChatThread = {
			id,
			title: "New Chat",
			messages: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		set((state) => ({
			threads: [newThread, ...state.threads],
			activeThreadId: id,
		}));
		return id;
	},

	setActiveThread: (id) => set({ activeThreadId: id }),

	deleteThread: (id) =>
		set((state) => ({
			threads: state.threads.filter((t) => t.id !== id),
			activeThreadId: state.activeThreadId === id ? null : state.activeThreadId,
		})),

	addMessage: (threadId, message) => {
		const newMessage: ChatMessage = {
			...message,
			id: generateId(),
			timestamp: new Date(),
		};
		set((state) => ({
			threads: state.threads.map((thread) =>
				thread.id === threadId
					? {
							...thread,
							messages: [...thread.messages, newMessage],
							updatedAt: new Date(),
							// Update title based on first user message
							title:
								thread.messages.length === 0 && message.role === "user"
									? message.content.slice(0, 40) +
										(message.content.length > 40 ? "..." : "")
									: thread.title,
						}
					: thread,
			),
		}));
	},

	updateMessage: (threadId, messageId, content) =>
		set((state) => ({
			threads: state.threads.map((thread) =>
				thread.id === threadId
					? {
							...thread,
							messages: thread.messages.map((msg) =>
								msg.id === messageId ? { ...msg, content } : msg,
							),
							updatedAt: new Date(),
						}
					: thread,
			),
		})),
}));
