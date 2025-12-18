import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { ArrowLeft, FolderOpen, Loader2, Plus, Settings } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { trpc } from "renderer/lib/trpc";

/**
 * Parses an SSH command or connection string into its components.
 */
function parseSSHCommand(input: string): {
	host: string;
	port: number;
	username: string;
} | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	let connectionStr = trimmed.replace(/^ssh\s+/i, "");

	let port = 22;
	const portMatch = connectionStr.match(/-p\s+(\d+)/);
	if (portMatch) {
		port = Number.parseInt(portMatch[1], 10);
		connectionStr = connectionStr.replace(/-p\s+\d+\s*/, "").trim();
	}

	const atIndex = connectionStr.indexOf("@");
	if (atIndex === -1) {
		return null;
	}

	const username = connectionStr.slice(0, atIndex);
	const hostPart = connectionStr.slice(atIndex + 1);

	const colonIndex = hostPart.lastIndexOf(":");
	if (colonIndex > 0 && !hostPart.includes("[")) {
		const possiblePort = Number.parseInt(hostPart.slice(colonIndex + 1), 10);
		if (!Number.isNaN(possiblePort)) {
			return {
				host: hostPart.slice(0, colonIndex),
				port: possiblePort,
				username,
			};
		}
	}

	return { host: hostPart, port, username };
}

type DialogStep = "select-host" | "enter-path";

interface OpenRemoteFolderDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onOpen: (workspaceId: string) => void;
}

export function OpenRemoteFolderDialog({
	isOpen,
	onClose,
	onOpen,
}: OpenRemoteFolderDialogProps) {
	const formId = useId();
	const [step, setStep] = useState<DialogStep>("select-host");
	const [input, setInput] = useState("");
	const [remotePath, setRemotePath] = useState("~");
	const [connectingTo, setConnectingTo] = useState<string | null>(null);
	const [connectedConnectionId, setConnectedConnectionId] = useState<
		string | null
	>(null);
	const [connectedConnectionName, setConnectedConnectionName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [passphrase, setPassphrase] = useState("");

	const { data: configHosts = [], isLoading } =
		trpc.ssh.getConfigHosts.useQuery();
	const connectFromConfig = trpc.ssh.connectFromConfig.useMutation();
	const connectMutation = trpc.ssh.connect.useMutation();
	const saveConnection = trpc.ssh.saveConnection.useMutation();
	const createRemoteWorkspace = trpc.workspaces.createRemote.useMutation();
	const getHomeDir = trpc.ssh.getHomeDir.useMutation();
	const openFileInEditor = trpc.external.openFileInEditor.useMutation();

	const utils = trpc.useUtils();

	const filteredHosts = useMemo(() => {
		if (!input.trim()) return configHosts;
		const search = input.toLowerCase();
		return configHosts.filter(
			(host) =>
				host.name.toLowerCase().includes(search) ||
				host.hostName?.toLowerCase().includes(search) ||
				host.user?.toLowerCase().includes(search),
		);
	}, [configHosts, input]);

	const parsedInput = useMemo(() => parseSSHCommand(input), [input]);
	const isNewConnection =
		parsedInput &&
		!configHosts.some(
			(h) =>
				h.name.toLowerCase() === input.toLowerCase() ||
				h.hostName?.toLowerCase() === parsedInput.host.toLowerCase(),
		);

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setStep("select-host");
			setInput("");
			setRemotePath("~");
			setConnectingTo(null);
			setConnectedConnectionId(null);
			setConnectedConnectionName("");
			setError(null);
			setPassphrase("");
			onClose();
		}
	};

	const handleOpenSSHConfig = () => {
		openFileInEditor.mutate({ path: "~/.ssh/config" });
		handleOpenChange(false);
	};

	const handleConnectionSuccess = async (
		connectionId: string,
		connectionName: string,
	) => {
		setConnectedConnectionId(connectionId);
		setConnectedConnectionName(connectionName);

		// Try to get the remote home directory
		try {
			const result = await getHomeDir.mutateAsync({ connectionId });
			if (result.homeDir) {
				setRemotePath(result.homeDir);
			}
		} catch {
			// Fallback to ~ if we can't get home dir
			setRemotePath("~");
		}

		setStep("enter-path");
		setConnectingTo(null);
	};

	const handleConnectFromConfig = async (hostName: string) => {
		setError(null);
		setConnectingTo(hostName);

		try {
			const result = await connectFromConfig.mutateAsync({
				hostName,
				passphrase: passphrase || undefined,
			});

			if (result.success && result.connectionId) {
				await handleConnectionSuccess(result.connectionId, hostName);
			} else {
				setError(result.error ?? "Failed to connect");
				if (!result.error?.toLowerCase().includes("passphrase")) {
					setConnectingTo(null);
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to connect");
			setConnectingTo(null);
		}
	};

	const handleConnectNew = async () => {
		if (!parsedInput) return;

		const connectionName = `${parsedInput.username}@${parsedInput.host}`;
		setError(null);
		setConnectingTo(connectionName);

		try {
			const saved = await saveConnection.mutateAsync({
				name: connectionName,
				host: parsedInput.host,
				port: parsedInput.port,
				username: parsedInput.username,
				authMethod: "key",
				privateKeyPath: "~/.ssh/id_rsa",
			});

			const result = await connectMutation.mutateAsync({
				connectionId: saved.id,
				credentials: {
					host: parsedInput.host,
					port: parsedInput.port,
					username: parsedInput.username,
					authMethod: "key",
					privateKeyPath: "~/.ssh/id_rsa",
					passphrase: passphrase || undefined,
				},
			});

			if (result.success) {
				utils.ssh.getConnections.invalidate();
				await handleConnectionSuccess(saved.id, connectionName);
			} else {
				setError(result.error ?? "Failed to connect");
				if (!result.error?.toLowerCase().includes("passphrase")) {
					setConnectingTo(null);
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to connect");
			setConnectingTo(null);
		}
	};

	const handleCreateWorkspace = async () => {
		if (!connectedConnectionId || !remotePath.trim()) return;

		setError(null);
		setConnectingTo("creating");

		try {
			const result = await createRemoteWorkspace.mutateAsync({
				sshConnectionId: connectedConnectionId,
				remotePath: remotePath.trim(),
			});

			utils.workspaces.getActive.invalidate();
			utils.workspaces.getAllGrouped.invalidate();
			onOpen(result.workspace.id);
			handleOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create workspace");
			setConnectingTo(null);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			if (step === "enter-path") {
				handleCreateWorkspace();
			} else if (needsPassphrase && passphrase) {
				if (connectingTo) {
					const configHost = configHosts.find((h) => h.name === connectingTo);
					if (configHost) {
						handleConnectFromConfig(connectingTo);
					} else {
						handleConnectNew();
					}
				}
			} else if (filteredHosts.length === 1) {
				handleConnectFromConfig(filteredHosts[0].name);
			} else if (isNewConnection && parsedInput) {
				handleConnectNew();
			}
		}
	};

	const handleBack = () => {
		setStep("select-host");
		setConnectedConnectionId(null);
		setConnectedConnectionName("");
		setError(null);
	};

	const isConnecting =
		connectFromConfig.isPending ||
		connectMutation.isPending ||
		saveConnection.isPending ||
		createRemoteWorkspace.isPending ||
		getHomeDir.isPending;
	const needsPassphrase = error?.toLowerCase().includes("passphrase");

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange} modal>
			<DialogContent
				className="max-w-lg p-0 gap-0 overflow-hidden"
				aria-describedby={`${formId}-description`}
				showCloseButton={false}
			>
				<DialogTitle className="sr-only">Open Remote Folder</DialogTitle>
				<DialogDescription id={`${formId}-description`} className="sr-only">
					{step === "select-host"
						? "Select SSH host to connect to"
						: "Enter path to remote folder"}
				</DialogDescription>

				{step === "select-host" ? (
					<>
						{/* Host selection step */}
						<div className="border-b px-3 py-2">
							<Input
								placeholder="e.g. ubuntu@ec2-3-106-99.amazonaws.com"
								value={input}
								onChange={(e) => setInput(e.target.value)}
								onKeyDown={handleKeyDown}
								disabled={isConnecting}
								className="border-0 shadow-none focus-visible:ring-0 px-0 text-sm h-8"
								autoFocus
							/>
						</div>

						{needsPassphrase && (
							<div className="border-b px-3 py-2 bg-muted/30">
								<Input
									type="password"
									placeholder="Enter passphrase for SSH key"
									value={passphrase}
									onChange={(e) => setPassphrase(e.target.value)}
									onKeyDown={handleKeyDown}
									disabled={isConnecting}
									className="border-0 shadow-none focus-visible:ring-0 px-0 text-sm h-8"
									autoFocus
								/>
							</div>
						)}

						{error && !needsPassphrase && (
							<div className="px-3 py-2 text-sm text-destructive bg-destructive/10 border-b">
								{error}
							</div>
						)}

						<div className="max-h-64 overflow-y-auto">
							{isLoading && (
								<div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
									<Loader2 className="h-4 w-4 animate-spin mr-2" />
									Loading...
								</div>
							)}

							{!isLoading && (
								<>
									{filteredHosts.map((host) => (
										<button
											key={host.name}
											type="button"
											onClick={() => handleConnectFromConfig(host.name)}
											disabled={isConnecting}
											className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
												connectingTo === host.name
													? "bg-accent"
													: "hover:bg-accent/50"
											} disabled:opacity-50`}
										>
											<span className="truncate">{host.name}</span>
											{connectingTo === host.name && isConnecting ? (
												<Loader2 className="h-3 w-3 animate-spin ml-2 flex-shrink-0" />
											) : (
												<span className="text-muted-foreground text-xs ml-2 truncate">
													{host.user && `${host.user}@`}
													{host.hostName || host.name}
												</span>
											)}
										</button>
									))}

									{isNewConnection && parsedInput && (
										<button
											type="button"
											onClick={handleConnectNew}
											disabled={isConnecting}
											className={`w-full flex items-center px-3 py-2 text-sm text-left transition-colors ${
												connectingTo ===
												`${parsedInput.username}@${parsedInput.host}`
													? "bg-accent"
													: "hover:bg-accent/50"
											} disabled:opacity-50`}
										>
											{connectingTo ===
												`${parsedInput.username}@${parsedInput.host}` &&
											isConnecting ? (
												<Loader2 className="h-3 w-3 animate-spin mr-2 flex-shrink-0" />
											) : null}
											<span className="truncate">
												{parsedInput.username}@{parsedInput.host}
												{parsedInput.port !== 22 && `:${parsedInput.port}`}
											</span>
											<span className="text-muted-foreground text-xs ml-2">
												Connect
											</span>
										</button>
									)}

									{(filteredHosts.length > 0 || isNewConnection) && (
										<div className="border-t my-1" />
									)}

									<button
										type="button"
										onClick={handleOpenSSHConfig}
										disabled={isConnecting}
										className="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-accent/50 transition-colors disabled:opacity-50"
									>
										<Plus className="h-4 w-4 mr-2 text-muted-foreground" />
										Add New SSH Host...
									</button>

									<button
										type="button"
										onClick={handleOpenSSHConfig}
										disabled={isConnecting}
										className="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-accent/50 transition-colors disabled:opacity-50"
									>
										<Settings className="h-4 w-4 mr-2 text-muted-foreground" />
										Configure SSH Hosts...
									</button>
								</>
							)}
						</div>
					</>
				) : (
					<>
						{/* Path entry step */}
						<div className="border-b px-3 py-2 flex items-center gap-2">
							<button
								type="button"
								onClick={handleBack}
								disabled={isConnecting}
								className="p-1 rounded hover:bg-accent/50 transition-colors"
							>
								<ArrowLeft className="h-4 w-4" />
							</button>
							<span className="text-sm text-muted-foreground">
								{connectedConnectionName}
							</span>
						</div>

						<div className="border-b px-3 py-2">
							<Input
								placeholder="/home/user/project or ~/project"
								value={remotePath}
								onChange={(e) => setRemotePath(e.target.value)}
								onKeyDown={handleKeyDown}
								disabled={isConnecting}
								className="border-0 shadow-none focus-visible:ring-0 px-0 text-sm h-8"
								autoFocus
							/>
						</div>

						{error && (
							<div className="px-3 py-2 text-sm text-destructive bg-destructive/10 border-b">
								{error}
							</div>
						)}

						<div className="p-3">
							<button
								type="button"
								onClick={handleCreateWorkspace}
								disabled={isConnecting || !remotePath.trim()}
								className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
							>
								{isConnecting ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<FolderOpen className="h-4 w-4" />
								)}
								Open Folder
							</button>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
