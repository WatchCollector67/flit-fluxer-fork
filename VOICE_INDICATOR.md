# Local voice transmit indicator

This fork changes your own microphone indicator on your client. It does not change remote-speaker detection or what other participants see in unmodified clients.

Feedback: [Fluxer #1069, comment #9459](https://feedback.fluxer.com/p/1069/c/9459).

## Behaviour

- While push-to-talk is held and the microphone publication is connected, live and unmuted, the local ring stays green, including during silence.
- In voice-activity mode, finite, non-zero RMS on the processed outgoing track lights the ring immediately. The separate remote-speaker display threshold and attack delay no longer hide quiet local audio.
- The analyser window covers at least one nominal 50 ms polling interval at ordinary audio sample rates, reducing missed short clicks.
- A 180 ms release hold keeps brief sounds visible. Explicit suppression, such as muting or disconnecting, bypasses that hold.

The selected microphone, noise suppression, voice-activation gate and input volume remain unchanged. The analyser reads the processed outgoing track, after those settings have affected the audio; it does not add another speech threshold.

## Limitations

- This indicates outgoing signal/transmit enablement, not confirmed receipt by the server or another participant.
- The current patch does not explicitly inspect the sender's upstream-paused state, RTP encoding activity or codec discontinuous transmission.
- PTT intentionally stays green during silence, including when input volume is zero, as long as the checked transmit conditions permit it.
- Browser or OS scheduling can delay polling; a full nominal-interval window is not a guarantee against every missed transient.
- Continuous transmitted background noise can keep the ring green.
- Remote-speaker detection remains unchanged. Other users need the patch for their own local indicators; their clients do not learn your PTT key state from this patch.

## Validation

The original implementation was validated on upstream `4d59c87a2ab054769d4caf59ac004bf02985d76d` with:

- Nine focused regression tests using the real meter/policies and mocked platform/Web Audio dependencies.
- Full application typecheck and a complete Linux development desktop build, including native input/audio modules.
- A Chromium Web Audio smoke test detecting a synthetic 2 ms, 0.00001-amplitude pulse at 48 kHz and checking silent PTT hold/release.
- Startup in the separate development profile. The user also reported that the local indicator worked correctly.

The patch was then applied to this fork's `421981e7dff625fefd4e108674b6a8b362b574cc` base. The four affected runtime source files and app package manifest were unchanged between those bases. Focused regression tests were rerun on the fork branch; the complete desktop build was not repeated on that newer base.

## Run focused tests

Node 22.15 or newer is required. These tests do not require installing workspace dependencies:

```sh
node --experimental-transform-types --test fluxer_app/scripts/tests/VoiceSpeaking.test.mjs
```

With pnpm and dependencies available, the equivalent command is `pnpm --filter fluxer_app test:voice-speaking`.

## Build and run on Linux

Install the pnpm version pinned in `package.json`, a current Rust/Cargo toolchain, Rust's `wasm32-unknown-unknown` target, and the upstream WASM/native build prerequisites. These include a wasm32-capable Clang and development headers for native dependencies such as libfido2 and PipeWire. No machine-specific tools or compiled binaries are included in this patch.

From the repository root:

```sh
pnpm install --frozen-lockfile
bash scripts/voice-indicator/build-linux.sh
bash scripts/voice-indicator/run-linux.sh
```

The launcher verifies development-channel/offline build metadata and disables module updates, keeping the patched interface bundled locally. Here, "offline" refers to interface delivery, not account or server connectivity. Connect to your usual Fluxer instance.

The development client uses `fluxerdevelopment`, separate from the stable `fluxer` and canary `fluxercanary` profiles. It does not replace an installed client. Sign in separately rather than copying the installed client's profile. Quit the development client and open your installed client to return to the original version.

Do not skip native modules when validating global PTT. Windows portable binaries have not yet been built or published for this patch; a Windows-native build and smoke test are still required.

## Real-call checklist

Use headphones and a second participant/device. Avoid speaker feedback.

1. Hold PTT silently: the local ring should stay green. Release: it should clear without the audio release hold.
2. Test self-mute, deafen, server mute and disconnection while PTT is held. The ring should not imply transmission when the checked conditions prohibit it.
3. In voice-activity mode, make quiet mouse/keyboard clicks the listener confirms are audible. Check the local ring lights for them.
4. Repeat with different sensitivity settings and noise suppression enabled/disabled. Sounds blocked to exact silence by processing should not light the audio-driven indicator; transmitted background noise should.
5. Switch microphone, reconnect, and change transmit modes. Check for stale indicators and confirm microphone audio otherwise remains unchanged.
