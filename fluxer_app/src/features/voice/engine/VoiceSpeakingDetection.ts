// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/features/platform/utils/AppLogger';
import {getSharedVoiceAudioContext} from '@app/features/voice/engine/VoiceSharedAudioContext';
import {
	advanceLocalSpeakingHysteresis,
	getRemoteSpeakingThresholdRms,
	SILENT_SPEAKING_HYSTERESIS,
	type SpeakingHysteresis,
} from '@app/features/voice/engine/VoiceSpeakingThreshold';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';

const logger = new Logger('VoiceSpeakingDetection');
export const SPEAKING_ANALYSER_INTERVAL_MS = 50;
const SPEAKING_ANALYSER_FFT_SIZE = 512;
const SPEAKING_ANALYSER_SMOOTHING = 0.2;

export function computeTimeDomainRms(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sumSquares = 0;
	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i]!;
		sumSquares += sample * sample;
	}
	return Math.sqrt(sumSquares / samples.length);
}

export function readSpeakingThresholdRms(): number {
	return getRemoteSpeakingThresholdRms(VoiceSettings.getVadThreshold());
}

export function createSpeakingAnalyser(context: BaseAudioContext): AnalyserNode {
	const analyser = context.createAnalyser();
	analyser.fftSize = SPEAKING_ANALYSER_FFT_SIZE;
	analyser.smoothingTimeConstant = SPEAKING_ANALYSER_SMOOTHING;
	return analyser;
}

export function createSpeakingSamples(fftSize = SPEAKING_ANALYSER_FFT_SIZE): Float32Array<ArrayBuffer> {
	return new Float32Array(new ArrayBuffer(fftSize * Float32Array.BYTES_PER_ELEMENT));
}

interface SpeakingMeterTap {
	context: BaseAudioContext;
	source: MediaStreamAudioSourceNode;
	analyser: AnalyserNode;
	samples: Float32Array<ArrayBuffer>;
}

export class VoiceSpeakingMeter {
	private track: MediaStreamTrack | null = null;
	private tap: SpeakingMeterTap | null = null;
	private hysteresis = SILENT_SPEAKING_HYSTERESIS;
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(
		private readonly readTrack: () => MediaStreamTrack | null,
		private readonly onChange: () => void,
		private readonly readSpeakingOverride: () => boolean | null = () => null,
	) {
		this.timer = setInterval(() => this.tick(performance.now()), SPEAKING_ANALYSER_INTERVAL_MS);
	}

	get speaking(): boolean {
		return this.hysteresis.speaking;
	}

	tick(nowMs: number): void {
		const override = this.readSpeakingOverride();
		if (override !== null) {
			this.closeTap();
			this.update({...SILENT_SPEAKING_HYSTERESIS, speaking: override});
			return;
		}
		const tap = this.syncTap();
		if (!tap) {
			this.update(SILENT_SPEAKING_HYSTERESIS);
			return;
		}
		const running = tap.context.state === 'running';
		if (!running) {
			this.update(SILENT_SPEAKING_HYSTERESIS);
			return;
		}
		tap.analyser.getFloatTimeDomainData(tap.samples);
		const rms = computeTimeDomainRms(tap.samples);
		this.update(advanceLocalSpeakingHysteresis(this.hysteresis, rms, nowMs));
	}

	dispose(): void {
		clearInterval(this.timer);
		this.closeTap();
		this.hysteresis = SILENT_SPEAKING_HYSTERESIS;
	}

	private syncTap(): SpeakingMeterTap | null {
		const candidate = this.readTrack();
		const track = candidate?.readyState === 'live' && candidate.enabled && !candidate.muted ? candidate : null;
		if (track === this.track && this.tap) return this.tap;
		this.closeTap();
		this.track = track;
		this.hysteresis = {...SILENT_SPEAKING_HYSTERESIS, speaking: this.hysteresis.speaking};
		const context = track ? getSharedVoiceAudioContext() : null;
		if (!track || !context) return null;
		try {
			const source = context.createMediaStreamSource(new MediaStream([track]));
			const analyser = createSpeakingAnalyser(context);
			// Cover at least a complete polling interval instead of leaving gaps between snapshots.
			const intervalSamples = (context.sampleRate * SPEAKING_ANALYSER_INTERVAL_MS) / 1000;
			analyser.fftSize = Math.min(
				32768,
				2 ** Math.ceil(Math.log2(Math.max(SPEAKING_ANALYSER_FFT_SIZE, intervalSamples))),
			);
			source.connect(analyser);
			this.tap = {context, source, analyser, samples: createSpeakingSamples(analyser.fftSize)};
		} catch (error) {
			logger.warn('Failed to attach the local speaking analyser', {error});
		}
		return this.tap;
	}

	private closeTap(): void {
		const tap = this.tap;
		this.track = null;
		this.tap = null;
		if (!tap) return;
		tap.source.disconnect();
		tap.analyser.disconnect();
	}

	private update(next: SpeakingHysteresis): void {
		const changed = next.speaking !== this.hysteresis.speaking;
		this.hysteresis = next;
		if (changed) this.onChange();
	}
}
