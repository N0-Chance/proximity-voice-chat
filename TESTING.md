# Table test plan for 2.0
The Node tests check the maths and the wiring. They can't hear anything, so this is the checklist I run with the table before trusting a release: how voices actually sound through walls, around corners, boosted, and placed left and right.

It takes two people about 20 minutes, three for the last part. Everyone wears headphones.

## Before starting
1. Update the module, then have everyone reload with the cache cleared. Nobody should see the red "old cached copy" error.
2. Everyone opens **Voice Diagnostics** (right-click yourself in the players list). Under the table of players it should say **Voice audio: advanced (boost 150%)**.
   - If it says to click the page first, click anywhere and run it again.
   - If it says **old path**, note the reason it gives and whose browser it is, then carry on: that browser is testing the fallback.
3. Use a scene with a room, a door, a corridor with a corner, and something small to stand behind (a pillar or a tree drawn with walls). Leave the module's settings on their defaults.
4. The GM turns **Global Listening** and **Global Speaking** off to take part as a normal listener, or leaves the listening to two players.

Throughout: **A** talks steadily (counting works), **B** listens and moves.

## 1. Loudness
| Step | Expected | OK? |
|---|---|---|
| A and B stand next to each other | B hears A comfortably, clearly louder than on 1.6.6 | |
| GM sets **Voice Boost** to 300% | A gets louder straight away, without crackling or distortion, even when A talks loudly | |
| GM sets it to 100% | A is as loud as on 1.6.6 | |
| Back to 150%. B right-clicks A, **Voice Volume**, drags to 200% | The slider goes past 100% and A gets louder for B only | |
| B sets A back to 100% | Back to normal | |
| B walks away to the edge of A's range | A fades smoothly, with no clicks or steps, and is silent past the radius | |

## 2. Doors
| Step | Expected | OK? |
|---|---|---|
| A in a room, B outside, door **closed**, a few tiles apart | A sounds muffled, as if behind a door, and B can still follow the words. A is only a little quieter | |
| Open the door | A clears up within a moment | |
| Close it, then **lock** it | A bit more muffled than closed | |
| B opens Voice Diagnostics | A's row says "through 1 closed door (muffled 50%)" or "locked door (muffled 60%)" | |

## 3. Walls
| Step | Expected | OK? |
|---|---|---|
| A and B on opposite sides of a plain wall, with no nearby way round | A is heavily muffled: B can tell A is talking and catch some of it | |
| Two walls between them | Much fainter and duller, or silent | |
| A wall whose sound restriction is **Limited** | Clearly muffled but easy to follow, more like the door than the wall | |
| GM sets **Muffle: Normal Walls** to 100% | Through the wall, A is silent. Diagnostics says the walls block the sound | |
| GM sets it to 0% | A sounds as if the wall weren't there | |
| Back to 75% | | |

## 4. Corners
| Step | Expected | OK? |
|---|---|---|
| A in a corridor, B just around the corner | A is clear, only slightly dulled, and about as loud as that walking distance would be | |
| B walks further down the side corridor | A fades with the walking distance. No sudden jumps as B moves | |
| B opens Voice Diagnostics | A's row says "around a corner (route N tiles, 1 bend)", and N looks right | |
| A stands behind a pillar or tree, B on the other side | A is clear, barely different from open ground | |
| A in a room with an open doorway, B outside and off to one side | A is heard clearly through the doorway, not muffled through the wall | |
| A yells (voice mode), B around a corner past normal range | A is heard. Back on Normal, A isn't | |
| A whispers, B just around the corner but further than whisper range | A isn't heard | |

## 5. Directional voice
B turns on **Directional Voice (Headphones)** in the module's settings.

| Step | Expected | OK? |
|---|---|---|
| A stands to the left of B on screen, then to the right | A's voice moves to the left ear, then the right, smoothly as A walks | |
| A stands directly above or below B on screen | Centred | |
| A walks through B's square | The voice passes through the centre; it doesn't flip sides | |
| A is on B's left but heard around a corner on B's right | The voice comes from the right, where the corner is | |
| The GM talks with Global Speaking on | Centred | |
| B sets **Directional Voice Strength** to 100%, then 20% | Fully in one ear at 100%; a slight lean at 20% | |
| B turns Directional Voice off | Everyone centred | |

## 6. Falling back to the old audio path
| Step | Expected | OK? |
|---|---|---|
| B turns on **Use the Old Audio Path on This Device** | B still hears everyone. No boost. Behind the closed door, A is quieter, not muffled | |
| B opens Voice Diagnostics | "Voice audio: old path", with that setting as the reason | |
| B turns it off again, and clicks the page | Back to advanced: boost and muffling return | |
| GM turns **Advanced Voice Audio** off, then on | The same for everyone at once | |
| B picks a different output device in Configure Audio/Video | Voices move to that device | |
| GM turns **Sound Travels Through and Around Walls** off | Walls block completely, as on 1.6.6: A is silent behind the door and around the corner | |
| Back on | | |

## 7. What must not have changed
Run these once on the advanced path, and once with B on the old path.

| Step | Expected | OK? |
|---|---|---|
| B clicks **Deafen** | Silence. Click again: voices return | |
| GM turns Global Speaking on, far from B | B hears the GM at full volume, unmuffled, whatever walls are between them | |
| GM gives B Global Listening | B hears everyone, anywhere, unmuffled | |
| B hides A (camera dock, "Hide User"), A talks | B doesn't hear A. Diagnostics offers Show Again; after it, B hears A | |
| A mutes their microphone, then unmutes | B stops hearing A, then hears A again within a second or two | |
| A reloads the page | B hears A again within a few seconds, at the right volume and muffling | |
| Speaking cues while A talks behind the door | A's token and row light up for B, as before | |
| A talks behind a wall set to 100%, with no way round | A's row shows dimmed for B (out of earshot), with no cue on the token | |

## 8. Both browsers
Repeat sections 1, 2, 4 and 6 with one listener on **Chrome** (or Edge) and one on **Firefox**. Anything that differs between them is worth writing down, with each browser's Voice Diagnostics report (Copy Report).

## 9. The whole table
With everyone connected and tokens spread through a dungeon:

| Check | Expected | OK? |
|---|---|---|
| Several people talk at once near one listener | All clear, no pumping or distortion | |
| Someone drags their token around quickly while others talk | No stutter, clicks, or frame drops on anyone's screen | |
| A player on speakers, if there is one | If the table hears itself echoed, that player switches to the old audio path and the echo stops | |
| After an hour of play | Voices still sound right, and nobody has silently dropped to the old path. The GM gets a warning if a browser does | |

## If something's wrong mid-session
These switch things back without reloading or downgrading:

- **Voices sound bad for one person:** they turn on **Use the Old Audio Path on This Device**.
- **Voices sound bad for everyone:** the GM turns off **Advanced Voice Audio**.
- **Walls behave strangely:** the GM turns off **Sound Travels Through and Around Walls**.

With both of the GM's settings off, voices work as they did in 1.6.6.
