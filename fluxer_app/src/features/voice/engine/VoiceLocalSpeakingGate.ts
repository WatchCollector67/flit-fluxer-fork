// SPDX-License-Identifier: AGPL-3.0-or-later

interface LocalSpeakingSuppressionInput {
	selfDeaf: boolean;
	effectiveSelfMute: boolean;
	hasMicrophonePublication: boolean;
	microphonePublicationMuted: boolean;
}

export function isLocalSpeakingSuppressed(input: LocalSpeakingSuppressionInput): boolean {
	return (
		input.selfDeaf || input.effectiveSelfMute || !input.hasMicrophonePublication || input.microphonePublicationMuted
	);
}

export function getLocalSpeakingOverride(
	input: LocalSpeakingSuppressionInput & {pushToTalkActive: boolean},
): boolean | null {
	if (isLocalSpeakingSuppressed(input)) return false;
	return input.pushToTalkActive ? true : null;
}
