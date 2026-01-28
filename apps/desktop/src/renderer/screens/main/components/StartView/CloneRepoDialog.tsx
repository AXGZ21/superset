import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { useEffect, useId, useRef, useState } from "react";
import { LuFolderGit, LuX } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useCreateWorkspace } from "renderer/react-query/workspaces";

const FOCUSABLE_SELECTOR =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface CloneRepoDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onError: (error: string) => void;
}

export function CloneRepoDialog({
	isOpen,
	onClose,
	onError,
}: CloneRepoDialogProps) {
	const [url, setUrl] = useState("");
	const utils = electronTrpc.useUtils();
	const cloneRepo = electronTrpc.projects.cloneRepo.useMutation();
	const createWorkspace = useCreateWorkspace();
	const titleId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const previouslyFocusedRef = useRef<HTMLElement | null>(null);

	const isLoading = cloneRepo.isPending || createWorkspace.isPending;

	useEffect(() => {
		if (isOpen) {
			previouslyFocusedRef.current = document.activeElement as HTMLElement;
			requestAnimationFrame(() => {
				inputRef.current?.focus();
			});
		} else {
			previouslyFocusedRef.current?.focus();
			previouslyFocusedRef.current = null;
		}
	}, [isOpen]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape" && !isLoading) {
			onClose();
			return;
		}

		if (e.key !== "Tab") return;

		const focusableElements =
			dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		if (!focusableElements || focusableElements.length === 0) return;

		const firstElement = focusableElements[0];
		const lastElement = focusableElements[focusableElements.length - 1];

		if (e.shiftKey && document.activeElement === firstElement) {
			e.preventDefault();
			lastElement.focus();
		} else if (!e.shiftKey && document.activeElement === lastElement) {
			e.preventDefault();
			firstElement.focus();
		}
	};

	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === e.currentTarget && !isLoading) {
			onClose();
		}
	};

	const handleClone = async () => {
		if (!url.trim()) {
			onError("Please enter a repository URL");
			return;
		}

		cloneRepo.mutate(
			{ url: url.trim() },
			{
				onSuccess: (result) => {
					if (result.canceled) {
						return;
					}

					if (result.success && result.project) {
						utils.projects.getRecents.invalidate();
						createWorkspace.mutate({ projectId: result.project.id });
						onClose();
						setUrl("");
					} else if (!result.success) {
						onError(result.error ?? "Failed to clone repository");
					}
				},
				onError: (err) => {
					onError(err.message || "Failed to clone repository");
				},
			},
		);
	};

	if (!isOpen) return null;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Modal backdrop dismiss pattern
		// biome-ignore lint/a11y/useKeyWithClickEvents: Handled by onKeyDown on dialog
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={handleBackdropClick}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				onKeyDown={handleKeyDown}
				className="bg-background border border-border rounded-lg w-full max-w-md shadow-lg"
			>
				<div className="flex items-center justify-between px-4 py-3 border-b border-border">
					<div className="flex items-center gap-2">
						<LuFolderGit className="w-4 h-4 text-muted-foreground" />
						<h2 id={titleId} className="text-sm font-medium text-foreground">
							Clone Repository
						</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={isLoading}
						className={cn(
							"flex items-center justify-center w-6 h-6 rounded",
							"text-muted-foreground hover:text-foreground",
							"hover:bg-accent transition-colors",
							"disabled:opacity-50 disabled:pointer-events-none",
						)}
						aria-label="Close dialog"
					>
						<LuX className="w-4 h-4" />
					</button>
				</div>

				<div className="px-4 py-4">
					<div className="space-y-2">
						<label
							htmlFor="repo-url"
							className="block text-xs font-medium text-foreground"
						>
							Repository URL
						</label>
						<input
							ref={inputRef}
							id="repo-url"
							type="text"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://github.com/owner/repo"
							className={cn(
								"w-full h-9 px-3 rounded-md text-sm",
								"bg-background border border-border",
								"text-foreground placeholder:text-muted-foreground/50",
								"focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
								"disabled:opacity-50 disabled:cursor-not-allowed",
							)}
							disabled={isLoading}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !isLoading) {
									handleClone();
								}
							}}
						/>
						<p className="text-xs text-muted-foreground">
							GitHub, GitLab, Bitbucket, or any Git URL
						</p>
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
					<Button
						variant="ghost"
						size="sm"
						onClick={onClose}
						disabled={isLoading}
					>
						Cancel
					</Button>
					<Button size="sm" onClick={handleClone} disabled={isLoading}>
						{isLoading ? "Cloning..." : "Clone"}
					</Button>
				</div>
			</div>
		</div>
	);
}
