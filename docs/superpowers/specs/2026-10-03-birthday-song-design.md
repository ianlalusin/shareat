# Birthday song (cashier) — design

Date: 2026-10-03, revised 2026-10-17 · Status: recorded songs, no name

## What
A floating speaker badge on the cashier session list (`/cashier` with no `sessionId`).
Tapping it opens a modal with Play. Play loops two bundled recordings back to back —
the SharEat birthday song, then Happy Birthday — until the cashier presses Stop or
closes the modal. Playing pauses other audio on the tablet (Spotify, YouTube, tabs).

## Songs
- `public/sounds/birthday-shareat.mp3` — upbeat Taglish "Sharelebrate" song, made by
  Ian in Suno (paid plan, so commercial use is allowed).
- `public/sounds/happy-birthday.mp3` — Happy Birthday recording supplied by Ian.
Both ship inside the APK, so playback works offline. A file that fails to play skips
to the other one rather than going silent.

## Audio focus
Native `requestAudioFocus(AUDIOFOCUS_GAIN, USAGE_MEDIA)` before playing; abandoned on
Stop and on modal close. Apps that honour focus pause; we cannot force-stop apps that
ignore it.

## History
The 2026-10-03 version sang a typed name with pitch-tuned Android text-to-speech. It
sounded robotic, so it was replaced. Singing a typed name naturally needs an AI music
service (Google Lyria via the Gemini key was the leading option, about $0.04 a song,
with this recording as the offline fallback). Parked by Ian on 2026-10-17.

## Files
- `android/.../BirthdaySongPlugin.java` (audio focus; registered in `MainActivity`)
- `src/lib/birthday/player.ts` (playlist loop + focus; `player.test.ts`)
- `src/components/cashier/BirthdaySongButton.tsx` (badge + modal)
- `src/app/cashier/page.tsx` (mount on the list view only)
