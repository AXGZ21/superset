import { db } from "@superset/db/client";
import { mobilePairingSessions, voiceCommands } from "@superset/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * GET /api/mobile/commands?sessionId=XXX
 * Returns pending commands for a pairing session.
 * Desktop polls this endpoint to receive mobile commands.
 */
export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		const sessionId = searchParams.get("sessionId");

		if (!sessionId) {
			return NextResponse.json(
				{ error: "Missing session ID" },
				{ status: 400 },
			);
		}

		// Verify the session is still valid
		const [session] = await db
			.select()
			.from(mobilePairingSessions)
			.where(
				and(
					eq(mobilePairingSessions.id, sessionId),
					eq(mobilePairingSessions.status, "paired"),
					gt(mobilePairingSessions.expiresAt, new Date()),
				),
			)
			.limit(1);

		if (!session) {
			return NextResponse.json(
				{ error: "Invalid or expired session" },
				{ status: 401 },
			);
		}

		// Get pending commands for this session
		const commands = await db
			.select({
				id: voiceCommands.id,
				transcript: voiceCommands.transcript,
				targetType: voiceCommands.targetType,
				targetId: voiceCommands.targetId,
				createdAt: voiceCommands.createdAt,
			})
			.from(voiceCommands)
			.where(
				and(
					eq(voiceCommands.pairingSessionId, sessionId),
					eq(voiceCommands.status, "pending"),
				),
			)
			.orderBy(desc(voiceCommands.createdAt))
			.limit(10);

		return NextResponse.json({ commands });
	} catch (error) {
		console.error("[mobile/commands] Error:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

/**
 * POST /api/mobile/commands
 * Mark a command as executed or failed.
 */
export async function POST(request: Request) {
	try {
		const { commandId, status, error } = await request.json();

		if (!commandId || typeof commandId !== "string") {
			return NextResponse.json(
				{ error: "Missing command ID" },
				{ status: 400 },
			);
		}

		const validStatuses = ["executed", "failed"];
		if (!validStatuses.includes(status)) {
			return NextResponse.json(
				{ error: "Invalid status. Must be 'executed' or 'failed'" },
				{ status: 400 },
			);
		}

		// Update the command status
		const [command] = await db
			.update(voiceCommands)
			.set({
				status,
				executedAt: status === "executed" ? new Date() : null,
				errorMessage: error || null,
			})
			.where(eq(voiceCommands.id, commandId))
			.returning();

		if (!command) {
			return NextResponse.json(
				{ error: "Command not found" },
				{ status: 404 },
			);
		}

		console.log("[mobile/commands] Updated command status:", {
			id: command.id,
			status: command.status,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("[mobile/commands] Error:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
