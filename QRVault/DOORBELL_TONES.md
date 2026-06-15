# Bundled doorbell tones

The app ships a runtime AudioTrack synthesiser as a final fallback, so a
ring always makes sound even with no audio assets bundled. For polished
v1 you can drop real `.ogg` files into `app/src/main/res/raw/`:

| File                | Picked from SecurityDialog → Ringtone | `ringtone_resource` value |
|---------------------|---------------------------------------|---------------------------|
| `doorbell_ring.ogg` | Default                               | `null`                    |
| `doorbell_soft.ogg` | Soft chime                            | `bundled:soft`            |
| `doorbell_chime.ogg`| Classic chime                         | `bundled:chime`           |
| `doorbell_buzz.ogg` | Buzzer                                | `bundled:buzz`            |

## Audio specs

- OGG Vorbis or OPUS, mono or stereo
- 44.1 kHz or 48 kHz, 16-bit
- 2–5 s loopable (fade-in 5 ms, fade-out 50 ms to avoid loop clicks)
- Target loudness ~ −14 LUFS short-term
- Royalty-free license — Mixkit, Pixabay, freesound.org with permissive
  license. Record the URL + license in the commit message.

## Suggested character per slot

- `doorbell_ring` — house-default; modern bell, 3–4 s, neutral.
- `doorbell_soft` — 2–4 s, gentle mallet/bell timbre, no startle transient.
- `doorbell_chime` — classic westminster ding-dong, 2–5 s.
- `doorbell_buzz` — apartment intercom buzzer, 2–4 s, attention-grabbing.

## Fallback behaviour

`IncomingRingActivity.startRinging` runs through these tiers:

1. Owner picked `bundled:<name>` → look up `R.raw.doorbell_<name>`.
2. Else `system:default` → `RingtoneManager.getDefaultUri(TYPE_RINGTONE)`.
3. Else built-in default `doorbell_ring.ogg` (this list, first row).
4. Else the system default ringtone.
5. Else `ToneSynth` — pure-PCM westminster ding-dong via AudioTrack.

Tier 5 always succeeds; missing audio assets degrade gracefully.
