export type MicPermissionStatus =
	| "not-determined"
	| "granted"
	| "denied"
	| "restricted";

/**
 * Voice sidecar events emitted by the Python child process via stdio JSON lines.
 * These are the events the tRPC subscription forwards to the renderer.
 */

export type VoiceSidecarEvent =
	| { type: "ready" }
	| { type: "recording" }
	| { type: "audio_captured"; audioB64: string; durationS: number }
	| { type: "error"; message: string }
	| { type: "idle" };

/**
 * Raw JSON events from the Python process stdout.
 * Converted to VoiceSidecarEvent by voice-process.ts.
 */
export interface PythonVoiceEvent {
	event: "ready" | "recording" | "audio_captured" | "error" | "idle";
	audio_b64?: string;
	duration_s?: number;
	message?: string;
}

/**
 * Commands sent to the Python process via stdin.
 */
export interface PythonVoiceCommand {
	cmd: "start" | "stop";
}
