import { LuServer } from "react-icons/lu";
import { OpenInButton } from "renderer/components/OpenInButton";

interface WorkspaceHeaderProps {
	worktreePath: string | undefined;
	isRemote?: boolean;
	remotePath?: string;
	sshConnectionName?: string;
}

export function WorkspaceHeader({
	worktreePath,
	isRemote,
	remotePath,
	sshConnectionName,
}: WorkspaceHeaderProps) {
	// For remote workspaces, show remote path info
	if (isRemote && remotePath) {
		const folderName = remotePath.split("/").filter(Boolean).pop() || remotePath;

		return (
			<div className="no-drag flex items-center gap-2 px-3 py-1.5 rounded-md text-sm">
				<LuServer className="size-4 text-emerald-500" />
				<span className="text-foreground font-medium">{folderName}</span>
				{sshConnectionName && (
					<span className="text-muted-foreground text-xs">
						({sshConnectionName})
					</span>
				)}
			</div>
		);
	}

	// For local workspaces, show the OpenInButton
	const folderName = worktreePath
		? worktreePath.split("/").filter(Boolean).pop() || worktreePath
		: null;

	return (
		<div className="no-drag flex items-center">
			<OpenInButton
				path={worktreePath}
				label={folderName ?? undefined}
				showShortcuts
			/>
		</div>
	);
}
