# Proximity Voice Chat
Turns Foundry VTT's built-in voice chat into proximity voice chat: you hear other players louder the closer their tokens are to yours. Walls and closed doors muffle voices instead of cutting them off, and sound carries around corners.

This is a fork of [MrCrackerplays/proximity-voice-chat](https://github.com/MrCrackerplays/proximity-voice-chat) (1.1.0) for Foundry v14, with fixes, GM narrator controls, a replacement for the camera dock, (from 2.0) louder voices and sound that travels through and around walls, and (from 2.2) a noise filter and voice gate for every microphone. Upstream has [a video showcase](https://www.youtube.com/watch?v=jV3ZPuTRQKw) of the original features.

Differences from upstream (and why) can be found [here](#differences-from-upstream).

## Install
In Foundry, choose **Install Module** and paste this manifest URL:

```
https://github.com/N0-Chance/proximity-voice-chat/releases/latest/download/module.json
```

Updates arrive through Foundry's own **Check for Updates**. Requires Foundry v14 with the built-in audio/video chat set to Audio Only or Audio/Video.

**Be aware:** this addon is not a simple install-and-forget. It will most likely require a relay (TURN) server, which is no easy feat if you want to self-host. See [Relay (TURN) server](#relay-turn-server).

## How it works
Each token has **speakers**: the users whose voice comes from it.

- **Owners speak automatically.** A player speaks through tokens of their assigned character, and of actors they've been given Owner permission on. Most player tokens need no setup.
- **The speaker list adds anyone else**, such as a player voicing a companion NPC. Tick users in the token's **Proximity** tab, or as a GM use the podcast button in the token HUD to add or remove yourself.

- **Speaking:** your voice comes from every token you're a speaker of.
- **Listening:** you hear from your selected tokens. If none are selected, you hear from every token you own or speak through.
- **The listen list adds extra listening points.** If you're on a token's listen list, you always hear through it as well, even with your own token selected. Use it for a player riding along after their character dies, or a token everyone hears through. Tick users in the token's **Proximity** tab.
- **Volume** fades with distance out to the token's proximity radius.
- **Walls** muffle a voice or send it the long way round; see [Sound through and around walls](#sound-through-and-around-walls).

The radius is set per token, per scene, or as a world default, in pixels or grid tiles. A scene can also turn proximity off entirely, so everyone hears everyone. Without a canvas (e.g. "Disable Game Canvas"), you hear only global speakers.

## Features
### GM controls
GMs are narrators by default: everyone hears you, and you hear everyone. Two toggles change that:

- **Global Listening** (podcast icon): turn it off to hear only players near your selected tokens, or near the tokens you speak through if none are selected.
- **Global Speaking** (bullhorn icon): turn it off to be heard only near your selected tokens and the tokens you speak through, for example to voice an NPC.

GMs can also turn either one on or off for any other user from the players list's right-click menu. For example, a user that records the session can hear everyone. The players list marks players who have either turned on, so the table can see who hears everything.

### Voice modes
Everyone can **whisper** or **yell**. This changes how far their voice carries:

- **Whisper** reaches 25% of your normal radius, so only those right next to you hear.
- **Yell** reaches 200%.

The GM sets both percentages. Walls still muffle a voice or make it go round, and a route around walls can be no longer than the voice carries. Because volume fades with distance, a yell also sounds louder further away.

- **Switching modes:** click the mode button on the voice bar to cycle Normal → Whisper → Yell, and right-click it to return to Normal. You can also bind the **Whisper** and **Yell** hotkeys: tap one to switch and stay (tap again for Normal), or hold it while talking to switch back when you let go.
- **What you see:**
  - The mode button turns blue for Whisper and orange for Yell, and your own row in the players list keeps showing your mode.
  - For about 2 seconds after switching, your token outlines where your voice now reaches in a clear line, walls included. A fainter circle shows how far it can carry through and around walls.
- **What others see while you talk:** a dotted ring for Whisper and a thick, rippling ring for Yell, or the matching icons in the other cue styles. A whisper someone can't hear shows them no cue at all, so private conversations stay private.
- **Global Speaking overrides your mode:** a narrating GM is heard by everyone. Global Listening still hears whispers, which suits a session recorder.
- **Modes are temporary:** they aren't saved, and everyone starts each session on Normal.

### Sound through and around walls
Before 2.0, a wall cut a voice off completely: you heard only the people you had a clear line to, and someone one step around a corner went silent. Now you hear the **clearer** of two paths:

- **Straight through the walls**, muffled by each wall and closed door on the line. Muffling mostly dulls the voice and only slightly quietens it. Someone behind a door sounds like they're behind a door, not far away.
- **Around the walls**, through open space: round a corner, through an open doorway, past a tree. The voice fades with the length of that route, not the straight-line distance, and each bend dulls it a little.

The GM sets how much each kind of wall muffles, from 0% (no effect) to 100% (blocks completely, so the voice can only come round):

| Wall or door | Default | What it sounds like |
|---|---|---|
| Limited walls | 40% | Clearly muffled, easy to follow |
| Closed doors | 50% | Muffled, still intelligible |
| Locked doors | 60% | A bit more than a closed door |
| Normal walls | 75% | Heavily muffled: you can tell who's talking, and catch some of it |
| Proximity and Distance walls | 75% | The same, whenever Foundry's threshold rule says they block |
| Secret doors | 75% | The same as a Normal wall |

- **Several crossings compound.** Two closed doors come to 75%; anything at 100% blocks whatever else is crossed. Past 97% a voice counts as blocked, which three Normal walls reach.
- **Open doors and walls with no sound restriction do nothing**, and one-way walls muffle from one side only, as they do for Foundry's own sounds.
- **Keep secret doors the same as the wall they sit in**, or a player can hear that part of the wall is different.
- **Whisper and Yell** scale how far a voice carries, including around corners. **Global Listening and Global Speaking** ignore walls, as they ignore distance.
- **Floors and ceilings** on multi-level scenes still block completely.
- **One path or the other, never a mix.** A voice doesn't go round a corner and then through a door; you hear whichever of "straight through everything" and "all the way round" is clearer.
- **To go back to walls blocking completely,** turn off **Sound Travels Through and Around Walls**.

### Louder voices
Players found proximity voices too quiet, even side by side. Foundry plays each voice through a camera element, which can't go above 100% volume. With **Advanced Voice Audio** (on by default) the module plays voices through the browser's audio engine instead:

- **Voice Boost** makes every voice louder: 150% by default, up to 300%. A limiter keeps loud voices from distorting.
- **Each player can turn any one person up to 200%**: right-click them in the players list and choose Voice Volume.
- **Muffling is done with a filter**, so a wall changes how a voice sounds more than how loud it is.
- **It starts on your first click or key press after the page loads.** Browsers don't let a page start audio before that. Until then voices play the old way.
- **A browser that can't do it falls back by itself** to the old way, tells you why, and tells the GM. Voice Diagnostics shows which way each browser is using.
- **Any player can switch back** with **Use the Old Audio Path on This Device**. The old way has no boost and no directional voice, and a wall can only make a voice quieter: 50% muffle is half as loud.
- **Use headphones.** Chrome has historically not cancelled echo for audio played this way, so a player on speakers may send everyone's voices back into the call. If that happens, that player should switch to the old audio path.

### Directional voice
With **Directional Voice (Headphones)** on, each voice sits to your left or right, by where the speaker's token is on screen relative to yours. It's off by default and each player chooses for themselves.

- **Around a corner, the voice comes from the corner**, since that's where the sound reaches you from.
- **Global speakers, and anyone you hear without a token, stay centred.**
- **Directional Voice Strength** sets how far to the side a voice can go. At 100%, a voice directly to your left is in your left ear only.
- It needs Advanced Voice Audio, and headphones to make sense.

### Microphone cleanup
Each player's microphone goes through a noise filter and a voice gate in their own browser before it's sent. Their voice goes through untouched, and breathing, drinks, mouth noises, keyboards, fans, the room and the birds outside stay out.
- **Why:** with **Always Enabled**, Foundry sends everything the microphone hears. **Voice Activation** isn't much better:
  - It reacts to the loudest single pitch, so a bird counts as much as a voice.
  - It waits for about 150 ms of sound before opening, so first syllables are lost.
  - It cuts off hard half a second after the last loud moment, so word endings are lost.
  - Its threshold slider only changes how loud you have to be, not what counts as a voice.
- **The noise filter** is RNNoise, a small open-source filter trained on speech (the one Jitsi Meet uses). It removes what isn't a voice, and every 10 ms it says how sure it is that it's hearing one.
- **The gate** sends sound only while you're speaking:
  - It opens on speech, not loudness. Breathing, birdsong, clicks and typing don't open it, even when they're as loud as your voice.
  - It learns your room's background level while you're quiet, and your speaking level while you talk. Another voice in the room, or a TV, is too quiet to open it. A shout or a laugh barely moves your speaking level, so it doesn't make the gate stricter for what you say next.
  - Short, loud, excited words ("Boo!", "Ha!") are over before the filter is sure they're speech, so a sound as loud as you usually speak needs much less certainty.
  - It listens ahead of what it sends (100 ms by default; the GM sets it with **Microphone Cleanup Delay**). The quiet first sound of a sentence, like the "h" of "hello" or the "s" of "so", doesn't sound like speech to the filter until the vowel arrives. The look-ahead lets the gate open in time, and that first moment is sent unfiltered so the filter doesn't remove it.
  - It stays open through short pauses and fades out instead of cutting off, so word endings survive.
- **Your voice mode:**
  - **Always Enabled** and **Voice Activation** now behave the same: the gate decides when you're heard. In Voice Activation it replaces Foundry's own detector.
  - **Push-to-talk:** the key decides, so only the noise filter applies.
  - **Whisper:** whispers don't sound like speech to the filter, so while you're in Whisper mode the gate asks for less and lets some unfiltered sound through.
- **Mic Setup** (the sliders button on the voice bar, or **Configure Settings → Proximity Voice Chat**) is each player's own:
  - The cleanup on, off, or following the GM's default.
  - **Remove background noise:** untick it if your voice sounds wrong to you; the gate still works.
  - **Automatic**, with a **Strictness** slider from Relaxed to Strict. If quiet words get lost, move towards Relaxed. If other voices in your room get through, move towards Strict.
  - **Manual:** untick Automatic, and the slider becomes a loudness threshold drawn over a live meter.
  - **Hear yourself** plays your cleaned-up microphone back to you for 30 seconds, so you hear what everyone else hears.
- **The GM sets the default** with **Microphone Cleanup for Players**. It's on unless the GM turns it off, and each player can still choose for themselves.
- **The GM sets the delay** with **Microphone Cleanup Delay**, from 30 to 150 ms. Longer keeps more of the first sound of each sentence; shorter feels snappier. In testing, quiet first consonants came through whole at 100 ms, and about 9 dB quieter at 50 ms. A change reaches every player at once and takes effect in their next pause, so you can adjust it mid-session until it feels right. Push-to-talk never adds the look-ahead, since the key already decides.
- **What it costs:**
  - Your voice reaches others later by the Microphone Cleanup Delay: 100 ms by default, less than a typical phone call adds.
  - About 12% of one CPU core on each player's computer.
  - A 3.6 MB file each browser downloads once.
- **It starts on your first click or key press after the page loads.** Browsers don't let a page process audio before that, so until then your microphone is sent as it is. Already-connected players get the cleaned-up voice straight away, without reconnecting.
- **A browser that can't run it falls back by itself** and sends the microphone as it is. Voice Diagnostics shows each player's state and why.
- **How it was tested:** recorded speech, mixed with breathing, birdsong, clicks, typing, a whisper and a voice from across the room, was played as the microphone in Chrome and Firefox and sent over a real voice connection.
  - Speech came through unchanged.
  - Breathing, birdsong, clicks and typing were silenced in both browsers: at least 72 dB quieter in Chrome, and completely silent in Firefox.
  - The voice from across the room was blocked.
  - A whisper lost about 20 dB in Normal mode and about 6 dB in Whisper mode.
  - A loud one-word shout after silence, and the next sentence after it, came through whole. In 2.2.0, one 300 ms shout raised the gate's bar by 15 dB; now it's under 2.
- **Singing and instruments** may be treated as noise, since the filter is trained on speech. For a bard's song, untick **Remove background noise** or switch the cleanup off for a moment.

### Voice UI
The camera dock is hidden by default. Everything it did lives in the players list instead.

- **Speaking cues:** the players list highlights whoever is talking. Their tokens show a ring, a centre icon, or a corner badge in their player colour. Speaking is measured on the audio you actually receive, so it works in always-on, voice-activated, and push-to-talk modes.
  - For someone whose [microphone cleanup](#microphone-cleanup) is on, the cue shows exactly while their voice is being sent: the gate sends true silence between words, so any sound arriving means they're being heard. No threshold to tune.
  - For someone whose cleanup is off, each player can tune how loud counts as speaking.
  - **Out of earshot:** when someone talks through a token you can see but can't hear, the token gets a thin, faint ring (or, with the icon and badge styles, a speech bubble with dots), and their row in the players list is dimmed. You can see their lips moving, but the words don't reach you. Whispers get the same faint cue on the token, so you can catch someone whispering about you, but it doesn't say they're whispering, and a whisper you can't hear stays out of the players list.
  - **Several people at once:** when two or more people talk through the same token, such as the party token on a travel map, or the GM speaking through a player's token, the ring is checkered in all their colours. The badge is split into one slice per person. The cue takes the loudest of their voice modes.
- **Join and leave alerts:** when someone joins or leaves voice chat, you hear a short chime (rising for joining, falling for leaving) on the same headphones as the voices, and a pop-up says who it was. That way nobody gets startled by a voice that suddenly appears. Each player chooses chime, pop-up, both, or neither, and how loud the chime is.
  - Nobody is announced for the first 15 seconds after you load, so joining a full table doesn't set off a chime per person.
  - A voice that drops for a moment and comes back (Foundry replacing a connection) isn't announced. Someone whose audio stops while they stay in Foundry is announced as leaving after 15 seconds; someone who closes Foundry, straight away.
  - Someone without a microphone sends no audio, so they're never announced.
  - There's no chime while you've deafened yourself; the pop-up still shows.
- **Voice bar:** the last row of the players list holds mic, voice mode, deafen, audio/video settings, and Mic Setup, plus Global Listening and Global Speaking for GMs.
- **Hotkeys:** every voice bar control can be bound under **Configure Controls**. They start unbound, and each button's tooltip shows its hotkey.
- **Right-click a player** to set their volume, up to 200% (see [Louder voices](#louder-voices)). GMs can also block or allow their audio, and turn their Global Listening or Global Speaking on or off.

### Reliability fixes
- **Voice connection drops:** Foundry's voice chat replaces any connection that takes more than about 8 seconds to set up, on both ends at once, so slow connections never finish. The module works around this. Symptoms in the console are `Called in wrong state` and `order of m-lines ... doesn't match`. Someone who reloads reconnects within seconds.
- **Deafen:** Foundry 14.369's own deafen button does nothing (a typo in its camera template). The module applies deafen itself.
- **Mute in Voice Activation:** in Foundry 14.369, muting and unmuting in Voice Activation mode switches off the detector that opens your mic, so nobody hears you again until you reload. It happens with Foundry's own mute button too. The module restarts the detector.
- **Fixes to upstream's proximity logic:** see [Differences from upstream](#differences-from-upstream).

## Settings
| Setting | Scope | Default | What it does |
|---|---|---|---|
| Whisper Range (% of normal) | World | 25 | How far a whisper carries, as a percentage of the speaker's radius |
| Yell Range (% of normal) | World | 200 | How far a yell carries, as a percentage of the speaker's radius |
| Owners Speak Through Their Tokens | World | On | Players speak through tokens they own without being on the speaker list |
| Advanced Voice Audio | World | On | Plays voices through the browser's audio engine: boost, muffling by tone, directional voice |
| Voice Boost (%) | World | 150 | How much louder every voice is, from 100 to 300; needs Advanced Voice Audio |
| Use the Old Audio Path on This Device | Client | Off | Switches this device back to Foundry's own playback |
| Sound Travels Through and Around Walls | World | On | Walls muffle and voices carry around corners; off, walls block completely |
| Muffle: Limited Walls (%) | World | 40 | How much each crossing muffles, from 0 (nothing) to 100 (blocks) |
| Muffle: Normal Walls (%) | World | 75 | As above |
| Muffle: Proximity Walls (%) | World | 75 | As above, when the wall's threshold makes it block |
| Muffle: Distance Walls (%) | World | 75 | As above, when the wall's threshold makes it block |
| Muffle: Closed Doors (%) | World | 50 | As above |
| Muffle: Locked Doors (%) | World | 60 | As above |
| Muffle: Secret Doors (%) | World | 75 | As above; keep it the same as the wall the door sits in |
| Directional Voice (Headphones) | Client | Off | Places each voice left or right by where its token is on screen |
| Directional Voice Strength (%) | Client | 60 | How far to the side a voice can go |
| Default Proximity Radius | World | 1200 | How far voices carry, unless a token or scene sets its own radius |
| Radius Type | World | Pixels | Whether the default radius is in pixels or grid tiles |
| Hide Camera Dock | World | On | Hides Foundry's camera dock for everyone; voice keeps working |
| Show Camera Dock Anyway | Client | Off | Brings the dock back on your device, e.g. to see video |
| Speaking Cue on Tokens | World | Ring | The table's default cue: ring, icon, badge, or off |
| My Speaking Cue on Tokens | Client | GM's default | Your own choice of cue |
| Speaking Cue Threshold (dB) | Client | −45 | Only for players whose microphone cleanup is off: how loud a voice must be to show a cue; raise it if background noise lights them up |
| Join and Leave Alerts | Client | Chime and pop-up | What you get when someone joins or leaves voice: chime and pop-up, chime only, pop-up only, or off |
| Join and Leave Chime Volume | Client | 50 | How loud the chime is, in percent |
| Microphone Cleanup for Players | World | On | Players' microphones go through the noise filter and voice gate unless they choose otherwise |
| Microphone Cleanup Delay (ms) | World | 100 | How far ahead the voice gate listens: longer keeps the first sound of each sentence, shorter is snappier |
| Microphone Cleanup | Client | GM's default | Your own choice: the GM's default, on, or off; the rest is in Mic Setup |
| Fix Voice Connection Drops | World | On | The connection workaround above; everyone must reload after changing it |
| Debug Logging | Client | Off | Logs every volume change, and why, to the browser console |

The token's **Proximity** tab holds its speaker list, listen list, and radius. The scene's **Proximity** tab holds its default radius and an option to disable proximity.

## Relay (TURN) server
**Why you may need one:** Foundry's voice chat is peer to peer, so every pair of players connects directly, and Foundry's default relay setting adds no relay at all. A pair behind strict routers, carrier-grade NAT or a firewall never connects, and their console shows `ICE failed, add a TURN server`. A self-hosted TURN relay fixes this, and players change nothing: Foundry sends the relay settings to every browser.

**Connecting it to Foundry:** in **Configure Audio/Video → Server**, set **Relay Server** to **Custom**, then enter the URL (e.g. `turn:turn.example.com:3478`, starting with `turn:`), username and password.
- Foundry accepts only one URL, and setting it replaces the browser's default STUN servers. A TURN server such as coturn also answers STUN, so direct connections are still tried first.
- The username and password reach every player's browser, so treat them as public. The relay must be safe even when anyone has them, for example by refusing to relay to private addresses.

**Size it for the whole table.** Each browser opens a relay allocation per person it connects to, and sometimes one per network interface, so a 7-player table can need 80–100+ at once. A relay that can't hold that many still hands out addresses to whoever asks first, then refuses everyone else (error 486). That's what happened at my table's first game day. This module's self-test, end-to-end relay test and Voice Diagnostics will show it (see [Troubleshooting](#troubleshooting)).

**What I did:** [RELAY.md](RELAY.md) records how I set up my own coturn relay for this module, and what I had to fix along the way: the config, the firewall and DNS, monitoring, testing, and the game-day capacity failure. It's a record of my setup, not a general guide to running a relay.

## Troubleshooting
**Voice Diagnostics** shows, in plain language, whether your voice chat is working and why not. Open it from **Configure Settings → Proximity Voice Chat → Voice Diagnostics**, or right-click yourself in the players list.
- **The summary** at the top says how many players you're connected to and lists any problems with your own browser, with the fix. That includes whether your microphone is really capturing and, if not, why: blocked by the browser, turned off in Foundry, or a device that isn't connected. Foundry alone just calls all of these "muted". It also covers push-to-talk, and whether "Fix Voice Connection Drops" is off.
- **One row per player** says whether you can hear them and why not, so "out of range" (normal) is distinct from "no voice connection" (a problem). It also says whether the connection is direct or relayed, and checks audio in **both directions**: whether theirs reaches you, and whether yours reaches them. A user who sends no audio at all, such as a recording client without a microphone, is shown as such rather than as a fault.
- **How each player sounds:** under their status, a row says how their voice reaches you, e.g. "around a corner (route 14 tiles, 1 bend)" or "through 1 closed door (muffled 50%)", and what the audio path is doing to it: volume, filter and left/right placement.
- **Which audio path the browser is on:** advanced or old, with the boost, and if it's the old one, why.
- **Microphone cleanup:** whether it's on, how it's set, how much of the time it's been sending, and if it isn't working, why.
- **Hidden users:** if you've hidden someone (Foundry's "Hide User"), their row says so and offers **Show Again**. A GM viewing a player's report gets **Ask to Show Again**, which makes that player's browser show them again, with a notice to the player.
- **Buttons:**
  - **Run Again**
  - **Copy Report**, plain text for Discord
  - **Copy Details**, the full technical data, in the Details section
  - **Send to GM**
- **For GMs:** right-click any player and choose **Request Voice Diagnostics**. Their browser runs it and sends the report back, and they see a short notice that you did. Reports arrive as chat cards whispered to the GMs, with a button that opens the full report, and they stay in the chat log for later.
- **Privacy:** a player's own window hides the names of tokens they can't see, other players' voice modes unless they can hear them, and whether a wall they're hearing through is a secret door. Reports sent to GMs keep full detail. The GM's browser posts the card, because a player could otherwise read their own whispered report in their chat log.
- **Only a GM can make a player's browser act.** Request Voice Diagnostics and Ask to Show Again are written onto the player's user record. Foundry's server only lets a GM (or the player themselves) write there, and it reports who made the change. The player's browser acts only when that server-supplied author is a GM, so a player can't fake either request.

**Every browser checks itself when it loads.** It gathers its own network addresses the way a voice connection would, using your relay server if one is set. You get a message that stays on screen if:
- WebRTC is disabled in the browser.
- The browser offers no network addresses at all, so nobody can connect to it. This is usually a Firefox privacy setting or a browser extension.
- A relay server is configured but this browser can't reach it.

It also checks that advanced voice audio can start. If it can't, the browser carries on with the old audio path, and a short warning says why, to you and to the GM.

**With a relay configured, each player's browser also tests the relay end to end.** It makes a small test connection to the GM's browser where the player's side may only use the relay, then sends a few test packets and times the round trip. Getting a relay address isn't enough: a relay can hand out addresses yet carry nothing, if its port forwards, outbound NAT or capacity are wrong. When the relay refuses a request, the browser's error code is shown in plain words: 486 "relay server is full", 508 "out of bandwidth capacity", 401 "username or password rejected", 701 "unreachable from this network". The relay's own log may not show these.

Failures are reported to the GM by player name, so players don't need to watch their consoles. When a GM changes the relay settings, every browser re-checks, and the GM is told straight away whether the relay works.

For the same data with more technical detail, run this in the browser console (F12):

```js
game.modules.get("proximity-voice-chat").api.diagnose()
```

It prints one row per other user. Each row shows their current volume and why, whether your voice connection to them really finished, and whether it runs **direct** or **relayed**. It also shows the state of their audio. Above the table, it lists your relay server and the types of network address your browser offers.

- **You can hear someone but they can't hear you** (or the other way round): the one who can't hear has probably hidden the other. Foundry then connects but plays none of their audio, and with the camera dock hidden that's invisible. Right-click the person in the players list and choose **Show User**, or use **Show Again** in Voice Diagnostics.
- **The start of sentences gets clipped:** raise **Microphone Cleanup Delay**. If voices feel laggy, lower it.
- **Someone's quiet words or word endings get lost:** in their Mic Setup, move **Strictness** towards Relaxed. If their voice sounds odd, they can untick **Remove background noise**. To rule the cleanup out entirely, set it to Off.
- **Breathing or room noise still gets through for someone:** check that their cleanup is on in Voice Diagnostics. If it's waiting for a click, they should click anywhere on the page. If other voices in their room get through, they should move **Strictness** towards Strict.
- **Everyone is too quiet:** raise **Voice Boost**. If one person is quiet, right-click them and raise their Voice Volume, up to 200%.
- **No boost, or walls make voices quieter instead of muffled, on one device:** that browser is on the old audio path. Voice Diagnostics says why: "Use the Old Audio Path on This Device" is on, the page hasn't been clicked yet, or advanced audio failed there. After a failure, switching that setting on and off again makes the browser try again, and so does choosing another output device if the device was the cause.
- **Echo of the table's own voices:** someone is on speakers. They should use headphones, or switch on "Use the Old Audio Path on This Device".
- **A voice comes from the wrong side, or you'd rather it didn't move:** Directional Voice is each player's own setting; turn it off or lower its strength.
- **A red "old cached copy" error:** the browser is running a stale script. Clear the site's cached files and reload; in Chrome, open F12, right-click reload, and choose **Empty Cache and Hard Reload**.
- **`ICE failed` in the console:** the two browsers can't reach each other directly. Set up a relay server; see [Relay (TURN) server](#relay-turn-server).
- **Firefox won't connect at all:** check `about:config`. `media.peerconnection.enabled` must be true, and `media.peerconnection.ice.no_host`, `.default_address_only`, `.relay_only`, and `.proxy_only` must be false.

## Differences from upstream
Compared with upstream 1.1.0, which was verified on Foundry 14.363.

The upstream proof of concept (at the time of writing) was largely solid and well implemented (all credit to them), but actually using it showed a series of issues and friction that my group wanted resolved. My whole table was very interested in the concept, hoping that it would bring back the cross-talk and smaller roleplay moments that we had long missed from our in-person days. I am no programmer, just a passionate home-labber and power user, so I pointed Claude (Opus 5.5) at the problem (as you can see from the commits), and this repo is the result. Thus, the differences from upstream are largely down to our tastes and use case, along with a few fixes.

### Speaker and listen lists
- **Tokens have a listen list**: users who hear through the token on top of their own.
  - Why: upstream only listens from your own tokens, so there's no way for a player to ride along with another after their character dies, or for everyone to hear through one token.
- **Owners speak through their tokens automatically** ("Owners Speak Through Their Tokens").
  - Why: upstream needs every token's speaker list filled in by hand, even for each player's own character.
  - Owners always count, not only when a token's list is empty. Otherwise a GM adding themselves to a player's token would silently stop the player speaking through it.
  - Default "all players" ownership doesn't count, so shared tokens such as loot piles don't carry everyone's voice.
- **The speaker and listen lists are a checkbox per user**, not a text field of user UUIDs.
  - Owners show ticked and locked. The flag keeps upstream's comma-separated format, so the API and existing worlds are unaffected.

### GM behaviour
- **The GM is heard and hears everyone by default.**
  - Why: upstream only lets you be heard through tokens whose speaker list includes you. A GM is on none, so players heard nothing until the GM found the Global Speaking button.
- **Global Listening with nothing selected now means listening only through tokens you speak through.**
  - Why: upstream fell back to every token you own. A GM owns them all, including each player's own token, so turning Global Listening off changed nothing.
- **A GM speaks through their selected tokens** when Global Speaking is off. The selection is shared with players through a user flag, and is cleared when the GM changes scene.
  - Why: selecting a monster to voice it is what GMs naturally do. Upstream only allowed speaking through tokens whose speaker list includes you.
- **Global Listening is a per-user flag, not a client setting**, and a GM can set it, or Global Speaking, for any user.
  - Why: it follows the user across browsers and devices, and it works the same way as Global Speaking. Setting it for others covers users like a session recorder, and the players list marks them so the table knows.
- **Toggling either one shows a short on-screen message saying what changed.**

### Proximity and volume
- **Movement is tracked through Foundry's `refreshToken` hook.**
  - Why: v14 animates the token document itself. Upstream ran its own copy of each movement animation, which drifted out of sync when a token moved again mid-animation.
- **Volumes keep updating in background tabs.**
  - Why: upstream's movement tracking ran on the canvas animation loop, which browsers stop in hidden tabs. Players alt-tabbed to a character sheet stopped getting updates. Updates now use timers, and while a tab is hidden, sound positions use each token's real destination.
- **Volumes are re-applied every second.**
  - Why: Foundry resets each camera's volume whenever it redraws a camera tile or a stream connects, and there's no hook for the latter. Upstream re-applied after fixed 100–500 ms delays, which connections often outlast.
- **Muted users are no longer forced to volume 0.**
  - Why: Foundry already silences them. Setting the volume to 0 could leave Chrome's audio element paused after they unmuted.
- **Players also listen through tokens they speak through**, not only tokens they own.
  - Why: a player voicing a companion NPC was heard near it but couldn't hear anyone there.
- **Only tokens on the scene you're viewing are voice sources.**
  - Why: upstream rebuilt a source whenever any token's settings changed, including tokens on other scenes. Every scene's default level has the same ID, so such a token acted as a phantom voice at its coordinates on your map.
- **Without a canvas, only global speakers are heard.**
  - Why: upstream stopped managing volumes entirely, so a player using "Disable Game Canvas" heard everyone at full volume.
- **Walls and doors update what you hear** when created, changed, or deleted.
  - Why: upstream's wall hook re-initialized each sound source with no data, which doesn't rebuild its shape.
- **Sound sources carry the token's scene Level, and use Foundry's own `getSoundOrigin`/`getListenerPosition`.**
  - Why: on v14 multi-level scenes, a source without a level takes whichever level the viewing client is on. The core methods replace upstream's hand-rolled centre-point maths.
- **Smaller fixes:**
  - The GM's camera-dock buttons no longer throw an error, which skipped that volume update, when the GM's own camera tile isn't rendered.
  - The token HUD button is null-guarded.
  - A movement call that passed a position as a speaker list is fixed.

### Audio and walls
- **Voices play through Web Audio, with a boost and a limiter** ("Advanced Voice Audio").
  - Why: upstream sets the volume of Foundry's camera element, as Foundry itself does, and an element's volume stops at 100%. My players found that too quiet even side by side.
  - The camera element stays attached and muted. Chrome only passes a remote voice to Web Audio while it's also attached to a media element.
  - The output is one hidden audio element rather than the audio engine's own output, because choosing an output device on that is still experimental in Firefox.
  - Any browser that can't do this goes back to the camera element's volume by itself, and each player can choose to.
- **Walls muffle instead of blocking, and sound carries around corners.**
  - Why: upstream uses Foundry's sound source, the same as ambient sounds, so a voice is either in line of sight or silent. That suits ambience. At my table it meant someone a step round a corner, or behind a tree, couldn't be heard at all.
  - How: the walls a straight line crosses are counted with Foundry's own rules for which walls apply (open doors, one-way walls, Proximity and Distance thresholds). The way round is the shortest path through a graph of the walls' outside corners.
  - Limited walls are muffled at each crossing. Foundry's rule for them (the first is free, the second blocks) has no in-between.
- **The muffle is the module's own low-pass filter**, not Foundry's muffled-sound effect.
  - Why: Foundry's effect cuts everything above 100 to 1000 Hz, which works for ambience but leaves speech unintelligible. Voices need roughly 2 to 3 kHz. The module's filter runs from no filtering down to 300 Hz, and a closed door sits near 2.4 kHz.
- **Directional voice**, which upstream doesn't have, as each player's own choice.

### Voice modes
- **Whisper and Yell, which upstream doesn't have.**
  - They scale the radius rather than the volume: a nearby voice is already at full volume, and nothing is heard past the radius, so only range changes who can hear.
- **Modes travel over the module's socket, not on the user record.**
  - Why: switching often (hold-to-whisper) would otherwise write to the database each time, and starting every session on Normal means nobody is stuck whispering after a reload.

### Voice connections
- **Workaround for Foundry's connection churn** ("Fix Voice Connection Drops").
  - The problem: Foundry checks every 8 seconds and replaces any connection that hasn't fully finished setting up, on both ends at once, without closing the old one. A leftover connection that later fails then tears down its replacement.
  - The module's fix: only one side of each pair calls, a connection gets 30 seconds to finish, events from replaced connections are ignored, and a fresh offer from a reloaded browser replaces the old connection immediately.
  - A browser that loads or reloads asks the other side to call it over the module's socket. It reconnects in seconds, not after the next 8-second poll.
  - A leftover reply to a connection request that has already been answered is ignored. Foundry's voice library would otherwise close the connection over it (`Cannot set remote answer in state stable` in the console), and voice would drop until it reconnected.
- **A connection self-test in every browser**, reported to the GM, plus an **end-to-end relay test** from each player to the GM, and relay error codes from the browser.
  - Why the relay test: on a game day the relay handed out addresses but couldn't carry the table: it ran out of bandwidth capacity, refusing with 486s that its log didn't show. A check that only gets a relay address passed throughout.
  - Why: a browser that offers no network addresses, or can't reach the relay, fails silently. Speaking cues still light up, because Foundry's speaking signal travels over its server connection, so it looks like everything works except the audio.
- **Deafen works.**
  - Why: Foundry 14.369's camera template reads `mutaAll` instead of `muteAll`, so its deafen button does nothing.
- **Unmuting works in Voice Activation.**
  - Why: when only the mute setting changes, Foundry 14.369 restarts voice detection with the voice mode from the list of changes, which doesn't include it, so detection stops for good. In Voice Activation that detector is what opens the mic, so after unmuting you stayed silent until a reload. The module fills in the current mode.

### Microphone
- **Microphone cleanup, which upstream doesn't have:** a noise filter and a voice gate on each player's microphone, as described in [Microphone cleanup](#microphone-cleanup).
  - Why: at my table, Always Enabled sent breathing, drinks and birds to everyone. Foundry's Voice Activation clipped the start and end of what people said, and still let noise through, so several players chose Always Enabled anyway.
  - How: the module swaps the cleaned-up track into Foundry's own outgoing stream, and swaps it back whenever the cleanup can't run, so Foundry still owns the microphone, muting and device changes.
- **In Voice Activation, the module's gate decides when you transmit**, instead of Foundry's detector.
  - Why: Foundry's detector measures the loudest single pitch over 50 ms, needs 3 of its last 10 readings above the threshold before it opens, and cuts off when all 10 are below.
- **The look-ahead is a GM setting** ("Microphone Cleanup Delay"), not a fixed number.
  - Why: how much delay a table will trade for whole first syllables is a matter of taste. In 2.2.0 it was fixed at 50 ms, which still clipped the quiet start of some sentences at my table.

### Interface
- **The camera dock is hidden by default**, with speaking cues and a voice bar in the players list.
  - Why: for audio-only proximity play, the dock takes space and shows nothing useful. It's moved off-screen rather than removed, because voice audio plays through its video elements.
- **Speaking is detected from the audio you receive**, with its own threshold setting.
  - Why: Foundry's own "speaking" signal stays on permanently in always-on voice mode. A separate threshold means tuning cues doesn't change when anyone transmits in voice-activated mode.
  - For players whose microphone cleanup is on, there's no threshold: each browser says over the module's socket whether its microphone is cleaned up, and the cue shows whenever any sound arrives from them. It's still measured on the audio you receive, so a cue never shows for a voice that isn't reaching you.
- **New hotkeys, right-click volume and audio blocking, and `diagnose()`** with a Debug Logging setting.
- **Voice Diagnostics**: a window in place of the console, and GM-requested reports delivered as chat cards.
  - Why: asking players to open the browser console is unreliable, and the GM is the one who needs the data.
- **GM-only requests are verified by Foundry's server**, not by the message content.
  - Why: Foundry doesn't tell module socket listeners who sent a message, so a "from" field is only a claim, and any player could have put a GM's ID there. The other socket messages (voice modes, reconnect requests, self-test results, and reports to the GM) still can't prove their sender. A player at your table could fake them, but none of them reveals data or grants access.
- **A stale-script check:** the scripts know their own version and show an error that stays on screen when a browser runs an old cached copy.

### Packaging
- **The manifest and downloads point at this fork**, so Foundry's update check never replaces it with upstream.
- **Minimum Foundry version is 14** (upstream: 13), verified on 14.369. The fixes rely on v14 APIs: Levels, document-driven animation, and the v14 A/V client.
- **Node test suites and a release script** (see [Development](#development)).

## API
Available at `game.modules.get("proximity-voice-chat").api` for macros and other modules.

### Speakers
* `get_token_speakers(token: TokenDocument): string[]`: user UUIDs of everyone speaking through the token (owners, speaker list, and a GM who has it selected)
* `get_owner_speakers(actor: Actor): User[]`: the players who speak through an actor's tokens as owners
* `get_userlist(token: TokenDocument): string | undefined`: the speaker list itself, as comma-separated user UUIDs
* `set_userlist(token: TokenDocument, userlist: string): Promise<any>`
* `is_user_in_userlist(token: TokenDocument, user_uuid: string): boolean`
* `add_user_to_userlist(token: TokenDocument, user_uuid: string): Promise<any>`
* `remove_user_from_userlist(token: TokenDocument, user_uuid: string): void | Promise<any>`

### Listen lists
* `get_listenlist(token: TokenDocument): string | undefined`: comma-separated user UUIDs who also listen through the token
* `set_listenlist(token: TokenDocument, listenlist: string): Promise<any>`
* `is_user_in_listenlist(token: TokenDocument, user_uuid: string): boolean`
* `add_user_to_listenlist(token: TokenDocument, user_uuid: string): Promise<any>`
* `remove_user_from_listenlist(token: TokenDocument, user_uuid: string): void | Promise<any>`

### Radius
* `RADIUS_TYPE.PIXELS`, `RADIUS_TYPE.TILES`
* `get_calculated_token_radius(token: TokenDocument): number`
* `get_calculated_token_radius_type(token: TokenDocument): RADIUS_TYPE`
* `get_token_radius(token: TokenDocument): number | undefined`
* `get_token_radius_type(token: TokenDocument): RADIUS_TYPE`
* `set_token_radius(token: TokenDocument, radius: number | null): Promise<any>`
* `set_token_radius_type(token: TokenDocument, radius_type: RADIUS_TYPE): Promise<any>`
* `get_scene_radius(scene: Scene): number | undefined`
* `get_scene_radius_type(scene: Scene): RADIUS_TYPE`
* `set_scene_radius(scene: Scene, radius: number | null): Promise<any>`
* `set_scene_radius_type(scene: Scene, radius_type: RADIUS_TYPE): Promise<any>`

### Scenes
* `is_scene_disabled(scene: Scene): boolean`
* `set_scene_disabled(scene: Scene, disabled: boolean): Promise<any>`

### Global Listening and Speaking
* `is_global_listener(user: User): boolean`
* `is_global_speaker(user: User): boolean`
* `set_global_listener(user: User, enabled: boolean): Promise<any>` (a GM can set it for any user)
* `set_global_speaker(user: User, enabled: boolean): Promise<any>` (a GM can set it for any user)
* `toggle_global_listener(): Promise<void>` (for the current user)
* `toggle_global_speaker(): Promise<void>` (for the current user)

### Voice modes
* `VOICE_MODES.NORMAL`, `VOICE_MODES.WHISPER`, `VOICE_MODES.YELL`
* `get_voice_mode(user: User | string): string`
* `set_voice_mode(mode: string): void`: sets your own mode and tells everyone
* `get_voice_reach(user: User): PIXI.Polygon[]`: the areas that user's voice reaches in a clear line, one per token they speak through
* Hook `proximityVoiceModeChanged(user: User, mode: string)` fires on every client when anyone's mode changes

### Diagnostics
* `run_relay_test(): Promise<object | null>`: tests the relay end to end from this (player's) browser to the active GM's. Its `status` is `ok` (with `rttMs`), `no-allocation`, `no-route`, `no-answer`, `no-gm`, `is-gm` or `error`, and `error` holds the relay's error code where there was one.
* `collect_diagnostics({ redact?: boolean }): Promise<object>`: the report behind Voice Diagnostics: this browser's setup and one entry per other active user. `redact` hides what a player couldn't otherwise know.

### Voice state
* `get_user_volume(user_id: string): number`: how loud that user currently is for you by distance, from 0 to 1. It's 0 when walls block them completely.
* `get_user_hearing(user_id: string): object | null`: how that user currently reaches you: `volume`, `muffle` (0 to 1), `cutoff` (the filter in Hz; 20000 is none), `pan` (−1 left to 1 right), and when heard by proximity, `via` (`open`, `through`, `around` or `blocked`), `walls` (how many of each kind are crossed), and the `length` in pixels and `bends` of a route around
* `get_voice_range(user: User): {x, y, radius}[]`: how far that user's voice can travel at most, per token they speak through; empty when sound propagation is off
* `get_audio_status(): object`: which audio path this browser is on: `path` (`advanced` or `old`), `reason` (`disabled`, `opted-out`, `waiting`, `other-client`, or a problem: `unsupported`, `resume`, `sink`, `output`, `error`), `problem` (whether that reason is a fault), `detail`, and `boost`
* `get_user_voice_volume(user_id: string): number`: that user's volume as you've set it, from 0 to 2, where 1 is 100%
* `set_user_voice_volume(user_id: string, volume: number): Promise<void>`: sets it; above 1 only takes effect on the advanced audio path
* `get_speaking_token_uuids(user: User): string[]`: the tokens in the current scene that user speaks through
* `diagnose(): Promise<object[]>`: see [Troubleshooting](#troubleshooting)

### Microphone cleanup
* `get_mic_status(): object`: what the cleanup is doing in this browser. `state` is `active`, `off`, `no-mic`, `starting`, `waiting` (for a click) or `failed`, with `reason` (`unsupported`, `worklet`, `rate`, `resume` or `error`) and `detail` when it failed. It also gives `filter` (whether the noise filter loaded), `gate` (`auto`, `manual` or `open` for push-to-talk), `strictness`, `threshold` and `whisper`.
* `open_mic_setup(): Promise<Application | null>`: opens Mic Setup
* `has_mic_cleanup(user_id: string): boolean`: whether that user's microphone goes through the cleanup, as their browser has said (for you, whether yours does)
* Hook `proximityMicCleanupChanged(status: object)` fires in this browser when the cleanup starts, stops or fails, with the same object as `get_mic_status()`

## Development
* Tests: `node test/smoke.mjs`, `node test/peers.mjs`, `node test/ui.mjs`, `node test/propagation.mjs`, `node test/audio.mjs`, and `node test/input.mjs`. They stub just enough of Foundry, and of the browser's Web Audio, to run in Node. `test/input.mjs` also runs the real noise filter on synthetic noises.
* Third-party code: the noise filter, `scripts/vendor/rnnoise/rnnoise.wasm`, is RNNoise (BSD licence) as built by `@shiguredo/rnnoise-wasm` (Apache 2.0). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
* Release: `tools/release.sh <version> "<what changed>"` sets the version everywhere, runs the tests, commits, tags, and pushes. The tag starts `.github/workflows/release.yml`, which publishes `module.json` and `module.zip` as a GitHub release.
