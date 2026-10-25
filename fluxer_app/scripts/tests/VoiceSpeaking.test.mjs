// SPDX-License-Identifier: AGPL-3.0-or-later

// Run with Node >=22.15: node --experimental-transform-types --test fluxer_app/scripts/tests/VoiceSpeaking.test.mjs
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {getLocalSpeakingOverride} from '../../src/features/voice/engine/VoiceLocalSpeakingGate.ts';
import {
	advanceLocalSpeakingHysteresis,
	advanceSpeakingHysteresis,
	getRemoteSpeakingThresholdRms,
	SILENT_SPEAKING_HYSTERESIS,
	SPEAKING_LOCAL_RELEASE_MS,
} from '../../src/features/voice/engine/VoiceSpeakingThreshold.ts';

// Only browser/platform dependencies are mocked; the actual meter and policies run below.
const stubs = new Map([
	['@app/features/platform/utils/AppLogger', 'export class Logger { warn() {} }'],
	[
		'@app/features/voice/engine/VoiceSharedAudioContext',
		'export function getSharedVoiceAudioContext() { return globalThis.__voiceTestContext; }',
	],
	['@app/features/voice/state/VoiceSettings', 'export default { getVadThreshold: () => 50 };'],
]);
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (stubs.has(specifier)) return {url: `voice-test:${specifier}`, shortCircuit: true};
		if (specifier.startsWith('@app/')) {
			return {url: new URL(`../../src/${specifier.slice(5)}.ts`, import.meta.url).href, shortCircuit: true};
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url.startsWith('voice-test:')) {
			return {format: 'module', source: stubs.get(url.slice(11)), shortCircuit: true};
		}
		return nextLoad(url, context);
	},
});
const {VoiceSpeakingMeter, computeTimeDomainRms, SPEAKING_ANALYSER_INTERVAL_MS} = await import(
	'../../src/features/voice/engine/VoiceSpeakingDetection.ts'
);
hooks.deregister();

const transmitting = {
	selfDeaf: false,
	effectiveSelfMute: false,
	hasMicrophonePublication: true,
	microphonePublicationMuted: false,
	pushToTalkActive: false,
};

test('PTT overrides silence only while transmission is allowed', () => {
	assert.equal(getLocalSpeakingOverride(transmitting), null);
	assert.equal(getLocalSpeakingOverride({...transmitting, pushToTalkActive: true}), true);
	for (const blocked of [
		{selfDeaf: true},
		{effectiveSelfMute: true},
		{hasMicrophonePublication: false},
		{microphonePublicationMuted: true},
	]) {
		assert.equal(getLocalSpeakingOverride({...transmitting, pushToTalkActive: true, ...blocked}), false);
	}
});

test('quiet, single-frame audio activates immediately; exact silence does not', () => {
	assert.equal(advanceLocalSpeakingHysteresis(SILENT_SPEAKING_HYSTERESIS, 0, 0).speaking, false);
	for (const rms of [1e-12, 0.000001, 0.0003, 0.006]) {
		assert.equal(advanceLocalSpeakingHysteresis(SILENT_SPEAKING_HYSTERESIS, rms, 0).speaking, true);
	}
	for (const rms of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
		assert.equal(advanceLocalSpeakingHysteresis(SILENT_SPEAKING_HYSTERESIS, rms, 0).speaking, false);
	}
});

test('release holds a click visibly and another click resets the release timer', () => {
	let state = advanceLocalSpeakingHysteresis(SILENT_SPEAKING_HYSTERESIS, 0.000001, 0);
	state = advanceLocalSpeakingHysteresis(state, 0, 50);
	assert.equal(advanceLocalSpeakingHysteresis(state, 0, 50 + SPEAKING_LOCAL_RELEASE_MS - 1).speaking, true);
	assert.equal(advanceLocalSpeakingHysteresis(state, 0, 50 + SPEAKING_LOCAL_RELEASE_MS).speaking, false);
	state = advanceLocalSpeakingHysteresis(state, 0.000001, 100);
	state = advanceLocalSpeakingHysteresis(state, 0, 150);
	assert.equal(advanceLocalSpeakingHysteresis(state, 0, 250).speaking, true);
});

test('remote thresholds and attack timing remain unchanged', () => {
	assert.equal(getRemoteSpeakingThresholdRms(50), 0.006);
	assert.equal(advanceSpeakingHysteresis(SILENT_SPEAKING_HYSTERESIS, 0.000001, 0.006, 0).speaking, false);
	const state = advanceSpeakingHysteresis(SILENT_SPEAKING_HYSTERESIS, 0.01, 0.006, 0);
	assert.equal(state.speaking, false);
	assert.equal(advanceSpeakingHysteresis(state, 0.01, 0.006, 50).speaking, true);
});

function makeMeter({sampleRate = 48000, contextAvailable = true} = {}) {
	const previousMediaStream = globalThis.MediaStream;
	const previousContext = globalThis.__voiceTestContext;
	globalThis.MediaStream = class {};
	const track = {readyState: 'live', enabled: true, muted: false};
	let changes = 0;
	let override = null;
	const analyser = {
		fftSize: 512,
		amplitude: 0,
		getFloatTimeDomainData(samples) {
			assert.equal(samples.length, this.fftSize);
			samples.fill(0);
			samples[0] = this.amplitude;
		},
		disconnect() {},
	};
	const context = {
		state: 'running',
		sampleRate,
		createAnalyser: () => analyser,
		createMediaStreamSource: () => ({connect() {}, disconnect() {}}),
	};
	globalThis.__voiceTestContext = contextAvailable ? context : null;
	const meter = new VoiceSpeakingMeter(
		() => track,
		() => changes++,
		() => (typeof override === 'function' ? override() : override),
	);
	return {
		meter,
		track,
		analyser,
		context,
		get changes() {
			return changes;
		},
		set override(value) {
			override = value;
		},
		dispose() {
			meter.dispose();
			globalThis.MediaStream = previousMediaStream;
			globalThis.__voiceTestContext = previousContext;
		},
	};
}

test('meter captures a tiny click in a full-interval window at common sample rates', () => {
	assert.equal(computeTimeDomainRms(new Float32Array()), 0);
	for (const sampleRate of [44100, 48000, 96000, 192000]) {
		const fixture = makeMeter({sampleRate});
		try {
			fixture.meter.tick(0);
			assert.ok(fixture.analyser.fftSize / sampleRate >= SPEAKING_ANALYSER_INTERVAL_MS / 1000);
			fixture.analyser.amplitude = 0.000001;
			fixture.meter.tick(50);
			assert.equal(fixture.meter.speaking, true);
			assert.equal(fixture.changes, 1);
			fixture.analyser.amplitude = 0;
			fixture.meter.tick(100);
			fixture.meter.tick(300);
			assert.equal(fixture.meter.speaking, false);
		} finally {
			fixture.dispose();
		}
	}
});

test('PTT lights without an analyser and clears immediately on release or suppression', () => {
	const fixture = makeMeter({contextAvailable: false});
	try {
		fixture.override = true;
		fixture.meter.tick(0);
		assert.equal(fixture.meter.speaking, true);
		fixture.meter.tick(1000);
		assert.equal(fixture.meter.speaking, true);
		fixture.override = false;
		fixture.meter.tick(1050);
		assert.equal(fixture.meter.speaking, false);
		assert.equal(fixture.changes, 2);
	} finally {
		fixture.dispose();
	}
});

test('silent PTT recovers after asynchronous publication unmute without an audio-level change', async () => {
	const fixture = makeMeter({contextAvailable: false});
	const state = {...transmitting, pushToTalkActive: true, microphonePublicationMuted: true};
	try {
		fixture.override = () => getLocalSpeakingOverride(state);
		fixture.meter.tick(0);
		assert.equal(fixture.meter.speaking, false);
		await Promise.resolve().then(() => {
			state.microphonePublicationMuted = false;
		});
		fixture.meter.tick(50);
		assert.equal(fixture.meter.speaking, true);
		state.pushToTalkActive = false;
		state.effectiveSelfMute = true;
		fixture.meter.tick(100);
		assert.equal(fixture.meter.speaking, false);
	} finally {
		fixture.dispose();
	}
});

test('ended, disabled, muted tracks and suspended contexts clear without a release delay', () => {
	for (const block of [
		(fixture) => {
			fixture.track.readyState = 'ended';
		},
		(fixture) => {
			fixture.track.enabled = false;
		},
		(fixture) => {
			fixture.track.muted = true;
		},
		(fixture) => {
			fixture.context.state = 'suspended';
		},
	]) {
		const fixture = makeMeter();
		try {
			fixture.analyser.amplitude = 0.000001;
			fixture.meter.tick(0);
			assert.equal(fixture.meter.speaking, true);
			block(fixture);
			fixture.meter.tick(50);
			assert.equal(fixture.meter.speaking, false);
		} finally {
			fixture.dispose();
		}
	}
});

test('meter retries an audio context that was initially unavailable', () => {
	const fixture = makeMeter({contextAvailable: false});
	try {
		fixture.meter.tick(0);
		globalThis.__voiceTestContext = fixture.context;
		fixture.analyser.amplitude = 0.000001;
		fixture.meter.tick(50);
		assert.equal(fixture.meter.speaking, true);
	} finally {
		fixture.dispose();
	}
});
