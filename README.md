# Proximity Voice Chat
Turns Foundry VTT's built-in voice chat into proximity voice chat: you hear other players louder the closer their tokens are to yours, and walls block sound the same way they do for Foundry's ambient sounds.

This is a fork of [MrCrackerplays/proximity-voice-chat](https://github.com/MrCrackerplays/proximity-voice-chat) (1.1.0) for Foundry v14, with fixes, GM narrator controls, and a replacement for the camera dock. Upstream has [a video showcase](https://www.youtube.com/watch?v=jV3ZPuTRQKw) of the original features.

## Install
In Foundry, choose **Install Module** and paste this manifest URL:

```
https://github.com/N0-Chance/proximity-voice-chat/releases/latest/download/module.json
```

Updates arrive through Foundry's own **Check for Updates**. Requires Foundry v14 with the built-in audio/video chat set to Audio Only or Audio/Video.

## How it works
Each token has a **speaker list**: the users whose voice comes from that token. Edit it in the token's **Proximity** tab (comma-separated user UUIDs, e.g. `User.TyKhb00c4SFsBeGc`), or as a GM use the podcast button in the token HUD to add or remove yourself.

- **Speaking:** your voice comes from every token whose speaker list includes you.
- **Listening:** you hear from your selected tokens, or from all tokens you own if none are selected.
- **Volume** fades with distance out to the token's proximity radius, and walls block it.

The radius is set per token, per scene, or as a world default, in pixels or grid tiles. A scene can also turn proximity off entirely, so everyone hears everyone.

## Features
### GM controls
GMs are narrators by default: everyone hears you, and you hear everyone. Two toggles change that:

- **Global Listening** (podcast icon): turn it off to hear only players near your selected tokens, or near the tokens you speak through if none are selected.
- **Global Speaking** (bullhorn icon): turn it off to be heard only near your selected tokens and the tokens you speak through, for example to voice an NPC.

### Voice UI
The camera dock is hidden by default. Everything it did lives in the players list instead.

- **Speaking cues:** the players list highlights whoever is talking, dimmed if they're out of your earshot. Their tokens show a ring, a centre icon, or a corner badge in their player colour. Speaking is measured on the audio you actually receive, so it works in always-on, voice-activated, and push-to-talk modes.
- **Voice bar:** the last row of the players list holds mic, deafen, and audio/video settings, plus Global Listening and Global Speaking for GMs.
- **Hotkeys:** every voice bar control can be bound under **Configure Controls**. They start unbound, and each button's tooltip shows its hotkey.
- **Right-click a player** to set their volume, or as a GM to block or allow their audio.

### Reliability fixes
- **Voice connection drops:** Foundry's voice chat replaces any connection that takes more than about 8 seconds to set up, on both ends at once, so slow connections never finish. The module works around this. Symptoms in the console are `Called in wrong state` and `order of m-lines ... doesn't match`.
- **Deafen:** Foundry 14.369's own deafen button does nothing (a typo in its camera template). The module applies deafen itself.
- **Fixes from upstream:**
  - Movement is tracked with Foundry v14's own token animation.
  - Doors and walls update line of sight.
  - Volumes keep updating in background tabs.
  - Muted players no longer come back silent after unmuting.
  - Sound sources use the token's scene Level.

## Settings
| Setting | Scope | Default | What it does |
|---|---|---|---|
| Default Proximity Radius | World | 1200 | How far voices carry, unless a token or scene sets its own radius |
| Radius Type | World | Pixels | Whether the default radius is in pixels or grid tiles |
| Hide Camera Dock | World | On | Hides Foundry's camera dock for everyone; voice keeps working |
| Show Camera Dock Anyway | Client | Off | Brings the dock back on your device, e.g. to see video |
| Speaking Cue on Tokens | World | Ring | The table's default cue: ring, icon, badge, or off |
| My Speaking Cue on Tokens | Client | GM's default | Your own choice of cue |
| Fix Voice Connection Drops | World | On | The connection workaround above; everyone must reload after changing it |
| Debug Logging | Client | Off | Logs every volume change, and why, to the browser console |

The token's **Proximity** tab holds its speaker list and radius. The scene's **Proximity** tab holds its default radius and an option to disable proximity.

## Troubleshooting
Run this in the browser console (F12):

```js
game.modules.get("proximity-voice-chat").api.diagnose()
```

It prints one row per other user. Each row shows their current volume and why, and whether your voice connection to them really finished. It also shows the state of their audio.

- **A red "old cached copy" error:** the browser is running a stale script. Clear the site's cached files and reload; in Chrome, open F12, right-click reload, and choose **Empty Cache and Hard Reload**.
- **`ICE failed` in the console:** the two browsers can't reach each other directly. Set up a TURN relay in Foundry's audio/video settings: **Relay Server → Custom**.
- **Firefox won't connect at all:** check `about:config`. `media.peerconnection.enabled` must be true, and `media.peerconnection.ice.no_host`, `.default_address_only`, `.relay_only`, and `.proxy_only` must be false.

## API
Available at `game.modules.get("proximity-voice-chat").api` for macros and other modules.

### Speaker lists
* `get_userlist(token: TokenDocument): string | undefined`
* `set_userlist(token: TokenDocument, userlist: string): Promise<any>`
* `is_user_in_userlist(token: TokenDocument, user_uuid: string): boolean`
* `add_user_to_userlist(token: TokenDocument, user_uuid: string): Promise<any>`
* `remove_user_from_userlist(token: TokenDocument, user_uuid: string): void | Promise<any>`

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
* `toggle_global_listener(): Promise<void>` (for the current user)
* `toggle_global_speaker(): Promise<void>` (for the current user)

### Voice state
* `get_user_volume(user_id: string): number`: how loud that user currently is for you, from 0 to 1
* `get_speaking_token_uuids(user: User): string[]`: the tokens in the current scene that user speaks through
* `diagnose(): object[]`: see [Troubleshooting](#troubleshooting)

## Development
* Tests: `node test/smoke.mjs`, `node test/peers.mjs`, and `node test/ui.mjs`. They stub just enough of Foundry to run in Node.
* Release: `tools/release.sh <version> "<what changed>"` sets the version everywhere, runs the tests, commits, tags, and pushes. The tag starts `.github/workflows/release.yml`, which publishes `module.json` and `module.zip` as a GitHub release.
