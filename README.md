# Proximity Voice Chat
A Module for Foundry VTT that transforms Foundry's built-in voice chat into a proximity voice chat.

You can watch [a showcase of the module's features](https://www.youtube.com/watch?v=jV3ZPuTRQKw) on youtube.

This module is designed so that a gamemaster only has to add players' UUIDs to the userlist of the relevant tokens. Then it'll automatically do volume calculations based the location of the user's controlled tokens to other users' proximity tokens using the same volume system as Foundry's placeable Ambient Sounds.

## About this fork
This is a locally patched copy of [MrCrackerplays/proximity-voice-chat](https://github.com/MrCrackerplays/proximity-voice-chat) 1.1.0, checked against Foundry 14.365 and 14.369. Install it in Foundry with this manifest URL: `https://github.com/N0-Chance/proximity-voice-chat/releases/latest/download/module.json`. Updates then arrive through Foundry's own update check, from this fork rather than upstream.

To release: `tools/release.sh <version> "<what changed>"` bumps `module.json`, runs the smoke test, commits, tags, and pushes to Forgejo (`origin`) and GitHub (`github`). The tag triggers `.github/workflows/release.yml`, which publishes `module.json` and `module.zip` as a GitHub release.

Changes from upstream:
* **GMs are narrators by default.** A GM hears everyone and is heard by everyone without touching anything. The two camera-dock buttons (podcast = Global Listening, bullhorn = Global Speaking) start lit; turn one off to drop into proximity, e.g. to speak only through an NPC token you've added yourself to with the token HUD button. Both are now per-user flags, so the old client-only "Global Listening" setting is gone.
* Muted users are no longer forced to volume 0, which could leave their audio paused after they unmuted.
* Token movement is tracked with Foundry v14's own animation (the `refreshToken` hook) instead of a duplicate animation that could drift out of sync.
* Volumes are re-applied every second, and updates use timers that still fire in background tabs, so a player alt-tabbed to a character sheet still hears the party move around.
* Sound sources get the token's scene Level (v14), instead of whatever level the viewing client happened to be on.
* Opening or closing doors and creating or deleting walls now updates line of sight. Upstream's wall hook didn't rebuild anything.
* Troubleshooting: a "Debug Logging" client setting, and `game.modules.get("proximity-voice-chat").api.diagnose()`, which prints a table of every other user's computed volume, the reason for it, and the state of their audio element.

## Features
Automatic user volume adjustments depending on the distance between your controlled tokens and the other user's proximity tokens, respecting walls.

<small>The following only appear for gamemasters (`game.user.isGM`).</small>

Buttons to toggle global listening and global speaking (ignore proximity) that can be found alongside foundry's voicechat buttons.

A toggle button in the token HUD to quickly add/remove yourself to/from that token's userlist.

## Settings
Token settings to define what users are speaking through that token and optionally a token-specific proximity radius & radius type, these can also be changed for an actor's prototype token.

Scene settings to define a scene-specific default proximity radius & radius type, and a toggle to disable proximity for that scene.

Game settings to define the default proximity radius & radius type, and toggle global speaking for yourself.

## API
A number of helper functions and enums are available for modules to interact with the proximity system and can be accessed at `game.modules.get("proximity-voice-chat").api`.

### Interacting with a token's userlist
* `get_userlist(token: foundry.documents.TokenDocument): string | undefined`
* `set_userlist(token: foundry.documents.TokenDocument, userlist: string): Promise<any>`
* `is_user_in_userlist(token: foundry.documents.TokenDocument, user_uuid: string): boolean`
* `add_user_to_userlist(token: foundry.documents.TokenDocument, user_uuid: string): Promise<any>`
* `remove_user_from_userlist(token: foundry.documents.TokenDocument, user_uuid: string): void | Promise<any>`

### Proximity radius type definitions
* `RADIUS_TYPE.PIXELS: number`
* `RADIUS_TYPE.TILES: number`

### Getting and setting proximity radius
* `get_calculated_token_radius(token: foundry.documents.TokenDocument): number`
* `get_calculated_token_radius_type(token: foundry.documents.TokenDocument): RADIUS_TYPE`
* `get_token_radius(token: foundry.documents.TokenDocument): number | undefined`
* `get_token_radius_type(token: foundry.documents.TokenDocument): RADIUS_TYPE`
* `set_token_radius(token: foundry.documents.TokenDocument, radius: number | null): Promise<any>`
* `set_token_radius_type(token: foundry.documents.TokenDocument, radius_type: RADIUS_TYPE): Promise<any>`
* `get_scene_radius(scene: foundry.documents.Scene): number | undefined`
* `get_scene_radius_type(scene: foundry.documents.Scene): RADIUS_TYPE`
* `set_scene_radius(scene: foundry.documents.Scene, radius: number | null): Promise<any>`
* `set_scene_radius_type(scene: foundry.documents.Scene, radius_type: RADIUS_TYPE): Promise<any>`

### Getting and setting a scene's proximity disabled/enabled status
* `is_scene_disabled(scene: foundry.documents.Scene): boolean`
* `set_scene_disabled(scene: foundry.documents.Scene, disabled: boolean): Promise<any>`