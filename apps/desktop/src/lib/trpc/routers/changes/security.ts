import { worktrees } from "@superset/local-db";
import { eq } from "drizzle-orm";
import { localDb } from "main/lib/local-db";

/** Type for worktree record returned from localDb */
export type WorktreeRecord = typeof worktrees.$inferSelect;

/**
 * Validates that a worktreePath exists in localDb.worktrees.
 * This prevents arbitrary filesystem/git access by ensuring the path
 * is a known, registered worktree.
 *
 * SECURITY: This is critical - without this check, a compromised renderer
 * could access arbitrary files/repos by passing worktreePath="/" or similar.
 *
 * @returns The worktree record from the database
 * @throws Error if worktreePath is not found in the database
 */
export function assertWorktreePathInDb(worktreePath: string): WorktreeRecord {
	const worktree = localDb
		.select()
		.from(worktrees)
		.where(eq(worktrees.path, worktreePath))
		.get();

	if (!worktree) {
		throw new Error("Unauthorized: worktree path not found in database");
	}

	return worktree;
}

/**
 * Non-throwing version of assertWorktreePathInDb.
 * Returns true if the worktreePath exists in localDb.worktrees.
 */
export function validateWorktreePathInDb(worktreePath: string): boolean {
	const worktree = localDb
		.select()
		.from(worktrees)
		.where(eq(worktrees.path, worktreePath))
		.get();
	return !!worktree;
}
