import { trpc } from "renderer/lib/trpc";
import { useWorkspaceViewModeStore } from "renderer/stores/workspace-view-mode";
import {
	DEFAULT_GROUP_TABS_POSITION,
	DEFAULT_NAVIGATION_STYLE,
} from "shared/constants";
import { SidebarControl } from "../../SidebarControl";
import { WorkspaceControls } from "../../TopBar/WorkspaceControls";
import { ChangesContent } from "./ChangesContent";
import { ContentHeader } from "./ContentHeader";
import { TabsContent } from "./TabsContent";
import { GroupStrip } from "./TabsContent/GroupStrip";

export function ContentView() {
	const { data: activeWorkspace } = trpc.workspaces.getActive.useQuery();
	const workspaceId = activeWorkspace?.id;

	// Subscribe to the actual data, not just the getter function
	const viewModeByWorkspaceId = useWorkspaceViewModeStore(
		(s) => s.viewModeByWorkspaceId,
	);

	const viewMode = workspaceId
		? (viewModeByWorkspaceId[workspaceId] ?? "workbench")
		: "workbench";

	// Get navigation style to conditionally show sidebar toggle
	const { data: navigationStyle } = trpc.settings.getNavigationStyle.useQuery();
	const isSidebarMode =
		(navigationStyle ?? DEFAULT_NAVIGATION_STYLE) === "sidebar";

	// Get group tabs position setting
	const { data: groupTabsPosition } =
		trpc.settings.getGroupTabsPosition.useQuery();
	const effectivePosition = groupTabsPosition ?? DEFAULT_GROUP_TABS_POSITION;

	// Show GroupStrip only in workbench mode with content-header position
	const showGroupStrip =
		viewMode === "workbench" && effectivePosition === "content-header";

	// Show ContentHeader if:
	// 1. In sidebar navigation mode (needs SidebarControl and WorkspaceControls), OR
	// 2. GroupStrip should be shown
	const showContentHeader = isSidebarMode || showGroupStrip;

	// Render WorkspaceControls in ContentHeader when in sidebar mode
	const workspaceControls = isSidebarMode ? (
		<WorkspaceControls
			workspaceId={activeWorkspace?.id}
			worktreePath={activeWorkspace?.worktreePath}
		/>
	) : undefined;

	if (viewMode === "review") {
		return (
			<div className="h-full flex flex-col overflow-hidden">
				{isSidebarMode && (
					<ContentHeader
						leadingAction={<SidebarControl />}
						trailingAction={workspaceControls}
					>
						{/* Review mode has no group tabs */}
						<div />
					</ContentHeader>
				)}
				<div className="flex-1 overflow-hidden bg-tertiary p-1">
					<div className="h-full bg-background rounded-lg overflow-hidden border border-border">
						<ChangesContent />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col overflow-hidden">
			{showContentHeader && (
				<ContentHeader
					leadingAction={isSidebarMode ? <SidebarControl /> : undefined}
					trailingAction={workspaceControls}
				>
					{showGroupStrip ? <GroupStrip /> : <div />}
				</ContentHeader>
			)}
			<TabsContent />
		</div>
	);
}
