# Birthday song (cashier) — design

Date: 2026-10-03, revised 2026-10-17 · Status: recorded songs, no name

## What
A floating on/off badge on the cashier session list (`/cashier` with no `sessionId`)
and on the dashboard (stacked above the weather button). Tap it to loop two bundled
recordings back to back — the SharEat birthday song, then Happy Birthday — and tap it
again to stop (it turns red and pulses while playing). No modal (retired 2026-10-17).
Playback lives in the player module, so it keeps going while the cashier moves between
screens. Playing pauses other audio on the tablet (Spotify, YouTube, tabs).

## Songs
- `public/sounds/birthday-shareat.mp3` — upbeat Taglish "Sharelebrate" song, made by
  Ian in Suno (paid plan, so commercial use is allowed).
- `public/sounds/happy-birthday.mp3` — Happy Birthday recording supplied by Ian.
Both ship inside the APK, so playback works offline. A file that fails to play skips
to the other one rather than going silent.

## Playback and audio focus
On Android the plugin plays the MP3s with MediaPlayer (the WebView <audio> stopped
responding after a stop, 2026-10-17); a plain browser uses <audio>. Native
`requestAudioFocus(AUDIOFOCUS_GAIN, USAGE_MEDIA)` before playing; abandoned on
Stop. Apps that honour focus pause; we cannot force-stop apps that
ignore it.

## History
The 2026-10-03 version sang a typed name with pitch-tuned Android text-to-speech. It
sounded robotic, so it was replaced. Singing a typed name naturally needs an AI music
service (Google Lyria via the Gemini key was the leading option, about $0.04 a song,
with this recording as the offline fallback). Parked by Ian on 2026-10-17.

## Files
- `android/.../BirthdaySongPlugin.java` (audio focus; registered in `MainActivity`)
- `src/lib/birthday/player.ts` (playlist loop + focus; `player.test.ts`)
- `src/components/cashier/BirthdaySongButton.tsx` (on/off badge)
- `src/app/cashier/page.tsx` (list view) and `src/components/dashboard/DashboardPageClient.tsx`
