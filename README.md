# TOTAL MAYHEM  (13 minigames, 11 maps, Rage Bait mode, chat, stamina, public rooms, a coin shop, cosmetic packs, capes and hoodies, power-ups, 52 achievements and music)

An original online party game for friends. You open it in a browser, one person
creates a room, friends join with a 4-letter code, and everybody plays short,
silly minigames. **This version has 13 minigames: "Crumble Floor" (on seven
different floors), "Gold Grab", "Hot Potato", "Hill Hustle", "Prop Hunt", "Meteor Mayhem",
"Crown Chaos", and the new "Paint Panic", "Color Call", "Jump Rope Jam", "Lap Dash", "Dig Dash"
and "Mole Stomp".** A match mixes them. Jump and shove now share one **stamina bar**, and a host can
make a room **public** so anybody can join it from a list on the home page. Finishing rounds earns **coins** that you spend in
the **Shop** on hats, skins and colors (cosmetics only), you can buy small one-round
**power-ups** at a **pit stop** between rounds, and **52 achievements** unlock special hats and
skins that coins cannot buy (all explained in section 3). Nine of the minigames now play on **11 different floor shapes (maps)**, and there are **24 skins**.

---

## 1. Run it (5 minutes)

You need **Node.js 18 or newer** (you said you have it; check with `node --version`).

1. Unzip the project and open a terminal **inside the `total-mayhem` folder**.
   - Windows: open the folder in File Explorer, click the address bar, type `cmd`, press Enter.
   - Mac: right-click the folder > "New Terminal at Folder".
2. Install the two libraries the game uses (only needed once):
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
   You should see `TOTAL MAYHEM server is running!` and a `http://localhost:3000` address.
4. Open **http://localhost:3000** in Chrome, Edge, Firefox or Safari.

Stop the server with `Ctrl+C` in the terminal.

---

## 2. Controls

| Action | Keys |
|---|---|
| Move | `W A S D` or arrow keys |
| **Jump** | `Space` |
| Shove (also: pass the bomb in Hot Potato; drop goo as a Crumble Floor ghost; **disguise / undisguise** as a Prop Hunt hider; **smack** as the Prop Hunt seeker) | `E` or `Shift` |
| Music on / off | `N` (or the music button in the bottom-right corner) |
| Mute / unmute all sound | `M` |
| Send an emoji bubble | `1` to `8` (or the smiley button in the bottom-right corner) |
| Show the FPS / ping panel | `F3` |

At the **pit stop** between rounds you use the mouse: click a power-up card to buy it, click it
again to get your coins back, then click **I'm ready**.

---

## 3. How a match works

A match is **3 rounds** (the host can choose 1, 3 or 5 in the lobby). Every round is a
different minigame: every minigame gets played once before any is repeated, the same
minigame is never played twice in a row, and round 1 always uses a minigame's normal
version (later rounds get a random twist, such as a different floor). After the last
round there is a final scoreboard, and the host can click **Play again** without anybody
leaving the room.

**Points per round** are the same for every minigame: 1st place gets 10 and the rest scale
down by finishing order (with 8 players: 10, 9, 8, 6, 5, 4, 3, 1). Players who tie share a
place. Anybody who leaves mid-round gets 0 for that round.

**Rules that apply everywhere (fairness):**
* Shove has a short 0.7 second cooldown, a generous reach in front of you (115 px, about 1.8 tiles) and
  costs **stamina** (next section). Whoever you hit is dizzy
  for a moment and **cannot be shoved again for 1 second**, so nobody gets bullied repeatedly.
* **Nobody is knocked out of the match.** In Crumble Floor you become a goo-dropping ghost;
  in the other games everybody plays the full round.
* In the open-arena games, **jumping dodges a shove** (you cannot be hit while in the air).
* The games help whoever is behind (see each game below).

### Crumble Floor (Survival)

* **Tiles crack, then fall.** The floor erodes faster and faster. Stand on a
  cracking tile too long and it drops you.
* **Jump over holes.** While you are in the air you cannot fall. A jump carries
  you roughly 2 tiles forward, so a 1-2 tile gap is jumpable and a 3-tile gap is
  not. You land with a small squash, and if you land on a hole you fall.
  (There is a tiny grace period for jumping just after running off an edge, and
  a jump pressed a hair too early still counts.)
* **Shove rivals** toward the edge. You can also jump over other players.
* **Fell? You become a ghost.** You are never fully out. Ghosts float anywhere
  and press `E` to drop up to 3 goo puddles. A puddle shows a dashed warning
  ring for 0.7 seconds, then slows anyone who steps in it (jump over it to
  avoid it). You cannot be splatted again for 3 seconds. Goo never eliminates
  anybody.
* **Extra points:** shoving someone off the edge gives **+2** (they must fall within
  3 seconds of your shove; max 3 KOs counted). Players who survive until the 75 second
  limit tie for first.
* **Seven floors:**
  * *Crumble Floor* - the classic.
  * *Rush Hour* - faster crumbling.
  * *Butter Mode* - everything is slippery.
  * *Lava Lounge* - faster crumbling, with glowing cracks.
  * *Moonbase* - low gravity: floaty jumps that go further.
  * *Candy Crumble* - a slower, friendlier collapse.
  * *Swamp Stomp* - heavy boots: harder to steer, shoves slide you less.

### Gold Grab (Collecting) - 60 seconds

* Coins pop up around the arena; **run over them to collect**. Most coins at the end wins.
* **Shove a rival and they drop up to 3 coins**, which scatter. The victim cannot re-grab
  those coins for 1.2 seconds, so you get the first chance.
* A big **JACKPOT coin (worth 5)** appears every so often and disappears if nobody takes
  it. **It always appears closer to whoever is in last place** (the comeback rule).
* You cannot grab coins while you are in the air.
* Two versions: *Gold Grab* and *Jackpot Jam* (fewer coins, bigger and more frequent jackpots).

### Hot Potato (Tag) - 60 seconds

* One player carries a **ticking bomb** (it shows a countdown). If you are holding it,
  **shove someone to pass it on**. When the fuse runs out it goes BOOM: one "boom" for the
  holder, a stun, and a shockwave that knocks nearby players away.
* **Fewest booms wins** (ties: whoever held the bomb for less time). Nobody is eliminated.
* The next bomb always goes to a player with the **fewest booms so far** (the comeback rule).
* You cannot be handed the bomb straight back (0.9 second protection), and a jump dodges a pass.
  The fuse gets a little shorter as the round goes on, and the holder runs a bit faster.
* Two versions: *Hot Potato* and *Ice Rink* (slippery floor).

### Hill Hustle (King of the Hill) - 60 seconds

* A glowing **hill** sits in the arena. **Stand on it ALONE to score** (one point per second).
  If two or more players are on it, **nobody scores**, so shove the others off!
* The hill **hops to a new spot every 12 seconds**, with a "NEXT" ring shown 2 seconds ahead.
* Most hill time wins. Being in the air does not count as being on the hill. Shoves are a
  little stronger in this game.
* Two versions: *Hill Hustle* and *Moving Day* (the hill moves every 7 seconds, low gravity).

### Prop Hunt (Hide & Seek) - 70 seconds

* One player is the **seeker** (two seekers with 7 or 8 players). Everybody else is a **hider**.
* The seeker is **blindfolded for the first 10 seconds** while the hiders hide. Hiders press
  `E` to **turn into a prop** (a crate, barrel, plant, rock, gift or cactus). You start as the
  prop nearest to you so you blend in at once; `Space` swaps to another prop. A prop cannot move.
  Press `E` again to turn back.
* The arena is full of ordinary props. The seeker presses `E` to **smack** the one they
  think is a player. A real hider is **found**; a plain prop makes the seeker **dizzy for a second**,
  so smacking everything does not work.
* **Found hiders are not out.** They become helper seekers and keep playing.
* Scoring: a hider earns a point for every second hidden (+10 if never found); a hider who was
  found earns 6 for every hider they then find; the seeker gets a base of 25 (never nothing)
  plus 10 per find. If every hider is found the round ends early.
* **It is a real secret.** Each player gets their own snapshot from the server. The seeker's
  snapshot lists a disguised hider as just one more `[x, y, type]` prop, with no marker, and
  hides the "who" of disguise events. Nothing in what the seeker's browser receives
  says which props are players. (Watching someone transform in front of you still gives them
  away, as in any hide and seek.) While blindfolded, the seeker is sent no hiders and no props at all.
* Two versions: *Prop Hunt* and *Crowded Closet* (26 props, 8 seconds to hide).
* Playing alone is a hiding practice round (no seeker).

### Meteor Mayhem (Survival) - 60 seconds

* Red circles appear on the floor, fill up, and a meteor lands there 1.35 seconds later.
  Stand in one when it lands and you are knocked flying and dizzy. **Jump** just as it lands
  and you hop over the blast.
* **The fewest hits wins** (a tie goes to whoever went longest without a hit). Nobody is out.
  After a hit you have a 1.4 second breather, and the storm starts gentle and speeds up.
* Some meteors land near a random player, so staying in one spot does not work, but they never
  target the last place player on purpose.
* Two versions: *Meteor Mayhem* and *Icy Hail* (slippery, smaller and faster).

### Crown Chaos (Keep-away) - 60 seconds

* One crown. **Wear it and score a point every second.** The wearer is a little slower.
* **Shove the wearer and the crown pops off**; whoever grabs it next wears it. The player who
  just lost it cannot grab it back for 1.3 seconds, and a shoved wearer has a short shield.
* The crown **overheats** and flings itself off after 10 seconds of continuous wearing
  (5 seconds in the *Hot Crown* version), so nobody can sit on it all round.
* Most crown time wins.

At the end of every round, the results screen hands out silly titles such as
"Gravity's Favorite", "Coin Goblin", "Human Firework", "King of the Hill", "Master of
Disguise" or "Untouchable".

### Stamina (jump and shove share it)

You have one **stamina bar** (bottom of the screen, next to the Jump and Shove buttons). A **jump costs 25**
and a **shove costs 35** out of a bar of **100**, so you can do about four jumps, or two shoves and a jump,
before you are out. It starts refilling **0.45 seconds** after you last used it, at 20 per second.
Two small marks on the bar show where a jump and a shove would end up.

* Too tired? The bar shakes, you hear a little "puff", and the move simply does not happen. A jump or shove
  you press just a moment early is remembered and happens as soon as you have enough.
* **Big Lungs** (bigger bar) and **Second Wind** (faster refill) are new power-ups for the pit stop.
* Hiders in Prop Hunt shove for free (their shove is how they disguise), and nobody pays during the hide phase.
* The numbers are in `server/stamina.js`.

### Rage Bait mode (host setting)

In the lobby the host can tick **Rage Bait**. It is deliberately almost unfair, and it is **the same for everybody in the room**:

* **Shoves hit about 3x as hard**: players fly several tiles, are dizzy more than twice as long, and can be shoved again after 0.5 seconds (combos!).
* **Everything is slippery** (steering grip is cut to 60%).
* **No stamina**: jumping and shoving are free, so the stamina bar is hidden and you can mash both as much as you like.
* **Every minigame is retuned to be much harder** (the numbers are in each game's `RAGE` table, plus `server/rage.js`):
  Crumble Floor's tiles fall much faster; Hot Potato has a shorter fuse and a huge explosion; Meteor Mayhem drops more, faster and bigger meteors;
  Color Call gives you about a second; Jump Rope Jam spins faster and knocks harder; Lap Dash puts a hurdle in every gap and weakens the rubber band;
  Dig Dash has far more bombs and slower digging; Mole Stomp has many more biting red moles; Hill Hustle has a smaller hill that moves every 7 seconds;
  Gold Grab has fewer coins; Crown Chaos overheats sooner; Paint Panic splats 7 tiles per shove and removes the catch-up brush; Prop Hunt hides the seeker's blindfold time shorter.
* A red **RAGE BAIT** badge and a red glow around the whole window (not only the game picture) show that it is on, the intro card warns everybody, and the public list shows a flame.
* It is still **fair play**: nobody is ever out for good, coins and power-ups work exactly as in a normal match (no extra rewards for suffering), and it can only be switched on or off between matches.

### Maps (host setting, v0.11.0)

Nine minigames (Crumble Floor, Gold Grab, Hot Potato, Hill Hustle, Prop Hunt, Meteor Mayhem, Crown Chaos,
Paint Panic and Dig Dash) can be played on different **floor shapes**. Color Call, Jump Rope Jam, Lap Dash
and Mole Stomp keep their own fixed arenas. In the lobby the host sees a **Map** drop-down:

* **Random mix** (the default): about a third of rounds use the classic oval, the rest pick one of the 10 new maps.
* Or pin one map for the whole match: **Classic Oval, Plus Plaza, Donut Hole, Picture Frame, Diamond Dash,
  Hourglass, Stepping Stones, Twin Peaks, Swiss Cheese, Open Field, Tiny Table**.
* The intro card names the map. Spawn points are spread out automatically for any number of players (2-8),
  the Hill and the Crown start in the middle (or the nearest floor if the middle is a pit, like on Donut Hole),
  and Crumble Floor's tiles crack starting from that map's shape. Maps work together with Rage Bait.
* Like Rage Bait, the map can only be changed between matches.

To add a map, add one entry (a 14 x 9 grid of `#` = floor and `.` = empty) to the list in `server/maps.js`.
`tests/maps.test.js` then checks it automatically (one connected piece, enough room for 8 players, standable
spawn points) and plays it in every minigame that uses maps. The one other place to touch is the `ALL_MAPS`
list at the top of `public/js/achievements.js` (a test fails if the two lists differ).

### Emoji bubbles and text chat

* **Emoji bubbles:** press **`1` to `8`** (or click the smiley button) to pop a bubble over your head for 2.5 seconds. There are 8 fixed emojis and no
  typing, so it is safe to use mid-round. You can send one every 0.6 seconds.
* **Text chat between rounds:** a chat box appears in the lobby, on the results screen, in the pit stop and on the final scoreboard (never during a round
  or the intro). Rules, all enforced by the server: plain text only, 140 characters at most, 1 message per 1.2 seconds (5 per 10 seconds), and a basic
  swear-word filter that masks whole words (`server/chat.js`, add your own words to `BAD_WORDS`). It is a **basic** filter: it catches things like
  `f*ck` and `sh1t`, but not every trick, and it does not understand other languages. The last 40 messages are kept for people who join late.
  Messages are shown as plain text, so nothing a player types can become HTML or a link.
* The server admin can **switch chat off for everybody** (and read a room's chat) in the admin panel. To start with chat off, set `CHAT_ENABLED: false` in `server/config.js`.

### Admin panel (secret code)

There is a small **Admin** link at the bottom of the title screen. It asks for a **secret code**, and nothing works without it.

* **Where the code comes from:** it is never in the source code. If you do nothing, the server invents a **random code every time it starts** and prints it in the terminal
  window ("ADMIN CODE ..."). To choose your own (6 or more characters), set `ADMIN_CODE` before starting:
  Mac/Linux: `ADMIN_CODE="my secret words" npm start`    Windows PowerShell: `$env:ADMIN_CODE="my secret words"; npm start`.
  On a hosting website, add `ADMIN_CODE` in its environment-variables settings (never write the code into a file you upload or share).
* **What it can do:** see the server's uptime, rooms, players, memory; see every room (host, phase, players, public/rage tags); **kick** a player; **close** a room;
  send an **announcement** that pops up for everybody online; **switch chat on/off** and read a room's chat. It never shows reconnect tokens.
* **How it is protected:** the code is checked on the server in constant time; 5 wrong tries from one connection address lock it out for 5 minutes (twice as long the next
  time), and 30 wrong tries from anywhere lock everybody out for 10 minutes; admin rights last only for that browser connection (closing or reloading the page locks it again),
  and every admin action is checked on the server again. Anyone with the code has full admin powers, so keep it private. Admin actions are written to the server's terminal log.

### Room size (2 to 8 players)

In the lobby the host picks **Players: up to 2 ... up to 8** (the default is 8). The room refuses newcomers once it is
full, the public list shows the chosen size, you cannot set it lower than the number of players already inside,
and it cannot be changed during a match. The overall limit is `MAX_PLAYERS` in `server/config.js`
(the game was only tested with up to 8).

### Public rooms

In the lobby the host can tick **Public room**. The room then appears in the **Public rooms** box on the home
page of everybody else, with the host's name, how many players are in, and whether it is in the lobby or playing.
Click a row to join it. Untick it to make the room private again. Rooms are private by default.

* The list refreshes every 5 seconds (or press the refresh button) and only shows rooms with space.
* It shows the 4-letter code but never anything secret (no player ids or reconnect tokens).
* Asking for the list is rate-limited per connection so nobody can hammer the server with it.
* Anyone who has the code can still join a private room, as before. Public simply means "listed".

### The six newest minigames

**Paint Panic (Territory) - 60 seconds.** Every tile you walk over turns your colour. Most tiles wins. Jump to
travel without painting; **shove** somebody and up to 3 tiles around them flip to you. Far behind (8 tiles)? You get a wide brush that paints two
tiles at once. Versions: *Paint Panic* and *Sugar Rush* (faster feet).

**Color Call (Party) - 60 seconds.** The floor shows four coloured zones. A colour is called, a timer counts down, and you
must be standing in it when the time runs out, or you get splatted (dizzy, no point; nobody is out). Calls get
faster as the round goes. A last-second shove can push a rival out. Versions: *Color Call* and *Anything But*
(two zones are lava and the other two are safe).

**Jump Rope Jam (Dodging) - 60 seconds.** A giant rope spins around the middle of the floor and gets faster. **Be in the air when it passes** to
score a point; it hits both ends of the rope. If you are on the ground it tangles you (stun and a knock, no point).
The hub in the middle is safe. A jump that fails for lack of stamina means you get caught. Versions: *Jump Rope Jam* and *Wild Rope*
(it reverses direction every 11 seconds, with a warning first).

**Lap Dash (Racing) - 60 seconds.** An oval track with six numbered gates. Run through them **in order** to score; the most gates wins
(a lap is 6). Hurdles trip you unless you jump them (or run around). Anyone far behind the leader runs a little faster (a rubber band). Versions:
*Lap Dash* (three hurdles) and *Hurdle Gauntlet* (every gap has one).

**Dig Dash (Treasure hunt) - 60 seconds.** Big X marks appear. **Stand still on one** for about 1.2 seconds to dig it up. It holds treasure worth 1 to 5
points, or a **bomb** that costs the digger 2 points and blasts everybody close by. **What is buried is secret**: the server never sends it, so
nobody can peek. Two diggers on the same X: the first to finish gets it. A shove fills the hole back in. Versions: *Dig Dash* and *Bomb Squad*
(many more bombs, faster digging).

**Mole Stomp (Whack-a-mole) - 60 seconds.** Moles pop out of nine burrows. A mound **rumbles** first, then the mole rises: **jump on it** to
score (+1). **Red** moles bite (lose 2 points, dizzy), and a **gold** mole is worth +3 and appears near whoever is losing. Walking over a mole does
nothing, you have to land on it. Versions: *Mole Stomp* and *Mole Frenzy* (more moles, faster).

### Music

There is background music, and **it is made entirely by code** (no audio files, no downloads, no
licensing): the browser plays every note live, the same way as the sound effects. Each part of the
game has its own little tune: the title screen and lobby, the intro card, each of the 13 minigames
(each in its own key, tempo and mood, e.g. a sneaky low one for Prop Hunt and a frantic one for Hot
Potato), the pit stop, the results and the final scoreboard. The music fades between scenes and goes
quiet during the 3-2-1 countdown so you can hear the ticks.

* **`N`** or the music button turns just the music off (remembered in your browser); **`M`** mutes everything.
* It starts after your first click or key press (browsers do not allow sound before that).
* It pauses while the tab is in the background.
* The music is kept quieter than the sound effects. To change the loudness, edit `MUSIC_VOLUME` at the
  bottom of `public/js/music.js`.
* All tunes are original loops (simple chord progressions). To change or add one, see the `STYLES` list at
  the top of `public/js/music.js`: tempo, key, chords, bass, drums and the melody's rhythm.

### Pit stop and power-ups (between rounds)

After a round (except the last), if somebody has enough to afford one, the room gets a **pit stop**
of up to 15 seconds. It ends early as soon as everybody clicks **I'm ready**. Players who are
away or disconnected never hold it up.

| Power-up | Effect for the next round | Price |
|---|---|---|
| Speedy Shoes | run 12% faster | 20 |
| Bouncy Boots | jump 18% higher | 20 |
| Quick Hands | shove recharges 30% faster | 25 |
| Long Arms | shove reaches 25% further | 20 |
| Sturdy Soles | shoves push you 35% less | 20 |
| Big Lungs | stamina bar 40% bigger | 25 |
| Second Wind | stamina refills 50% faster | 25 |

**Why this is not "pay to win" (the original brief says no pay-to-win):**
* They are bought with a separate **pit-stop purse**, not your shop coins. Everybody's purse starts
  at **0 at the start of every match** and fills with the same amount a round pays out in coins.
  Nothing carries over from older matches, and nothing is ever bought with real money.
* Boosts are small, **last one round only**, and you can carry **at most two**.
* **Last place pays 30% less** (when there are 3 or more players and scores are not all level).
* The server keeps the purse and does every purchase, so a modified browser cannot give itself
  free power-ups. You can refund a power-up until the pit stop closes.
* If nobody can afford even the cheapest power-up, the pit stop is skipped. To switch power-ups
  off completely, set `PITSTOP_MS: 0` in `server/config.js`. Prices and numbers are in
  `server/powerups.js`.

### Achievements and trophy hats (cosmetics only)

Click **Trophies** on the title screen, in the lobby or on the final scoreboard to see all 52
achievements with progress bars. A pop-up appears when you unlock one. Examples: win a round,
win a match, win each of the 13 minigames, jump 100 times, earn 10 silly titles, knock out 3
players in one Crumble Floor round, earn 500 coins in total. The 20 newest (v0.11.0) cover maps
(play on 5 or on all 11 maps, win on Donut Hole / Tiny Table / Stepping Stones / Swiss Cheese / Twin Peaks, win on 5 different maps),
Rage Bait (finish a round, win a round, finish 10), chat and emoji (10 messages, 25 bubbles, all 8 emoji), win streaks,
top-3 finishes in big rooms, and long-term totals (500 shoves, 1000 jumps, 100 rounds, 2000 coins).

Fourteen of them give a **special hat or skin that coins cannot buy**: Laurel wreath, Golden trophy,
Hard hat, Space helmet, Detective cap, Jester hat, and the Bubbles, Flames, Galaxy, Gold, Lava (win a Rage Bait round),
Circuit (play on every map), Frost (win on 5 different maps) and Disco (earn 2000 coins) skins. There are also
8 new skins you can buy with coins: Polka, Camo, Waves, Argyle, Tiger, Lightning, Cow and Confetti. In the Shop they show a trophy instead of a price, and tell you which achievement unlocks
them. They change only how you look.

* Wins and finished matches **only count when somebody else was in the room**, so you cannot
  unlock the match achievements by practising alone.
* Each round and match is counted once, even if you refresh the page on the results screen.
* Saved in your browser (`tm_trophies`), like your coins. A person who edits their own saved data
  can give THEMSELVES a hat; it cannot affect anybody else's game.

### Trophy items in the Shop (v0.8.1)

Trophy hats and skins show a **Trophy** tag. Before you earn the achievement the button reads
"Locked - earn the trophy first" and the hint shows your progress (for example "0 / 500").
The moment the achievement unlocks, the item is handed over automatically; if it is ever
missing (for example you cleared your wallet), the shop shows a green **Claim your reward!**
button that gives it to you. Coins still never buy these.

### Smoothness (v0.8.0)

If the game felt choppy, these are the fixes (the measurements are in section 9):

* The page's animated rainbow background is switched off while you are in the arena (it was
  repainting a huge moving gradient every frame for nothing).
* The floor is painted **once** into a hidden picture and copied each frame; only cracking
  tiles are painted live. This removed thousands of drawing commands per frame.
* The picture's resolution is capped at 1.5x, and if your computer cannot keep up the game
  **lowers it automatically** (and raises it again when there is spare speed).
* The connection uses **WebSocket first** (lowest delay; plain polling is only a fallback),
  and the server's clock wakes up more often so the world advances evenly instead of in bursts.
* Other players are drawn a short moment in the past so they glide; that delay now **adapts**
  (about 55-160 ms) to how steady your connection is.
* **F3** shows an FPS / ping / snapshots-per-second panel so you can tell which kind of lag you have.

### Less input lag: movement prediction (v0.9.0)

Your keys have to travel to the server and the new position has to come back, so on a slow connection
your own character used to react about one ping late. Now the browser **replays your recent key presses** on top of
the newest server position (using the same steering rule as the server) and draws your character where the server
is about to put it. It is only a drawing guess: the server still decides everything, the guess is redone from
every snapshot, and small differences fade out smoothly. It is not used while you are stunned or frozen, and it
does not guess knockbacks, collisions with other players or jumps (those still wait for the server).

* Measured in simulated slow connections (server rules, 20 / 50 / 100 ms each way): the drawn position was
  3-6 px from the server's real position, instead of 11-37 px with the old method.
* Measured in real headless Chromium with a 60 ms-each-way delay: pressing a key to the first visible movement went
  from about 150 ms to about 40 ms.
* Add `?nopredict` to the address (for example `http://localhost:3000/?nopredict`) to switch it off and compare how it feels.
  If prediction ever looks wrong, that switch is the first thing to try.
* Other players are still drawn slightly in the past so they move smoothly, so you may be a little "ahead" of them on a slow
  connection. That is normal for online games.
* Ping itself cannot be removed by code. If the server is far away from you, the best fix is a server near you.

### Back items, Packs and Outfits (v0.12.0, cosmetics only)

* **Back items:** a new Shop tab and a new picker under Hat and Skin. **21 capes, cloaks and hoodies** (Red cape ... Galaxy cloak, Frog hoodie, Cat hoodie, ...).
  Capes and cloaks hang behind you and flutter when you run; hoodies show a hood and sleeves. They are drawn on everybody's screen.
* **Skins and hats:** 13 new skins and 30 new hats (your five collections: Disaster, Magical Nonsense, Snack Attack, Show-Off and Weird Science).
  A few have tiny **idle animations** that are purely cosmetic: the Emergency chicken squawks "BAWK!" every few seconds, the UFO's little alien waves,
  the Tiny crown wobbles when you fall or are dizzy, the Spinning siren flashes, the Satellite dish turns, the Noodle nest steams, the Popcorn pops.
* **Packs** (title screen or lobby, **Packs** button). Four packs, a bit like trading-card packs. Each card is one skin, hat or back item, or a whole **Outfit**
  (a matching skin + back item + hat). Cards are Common, Uncommon, Rare, Epic or Legendary.

  | Pack | Price | Cards | Guarantee |
  |---|---|---|---|
  | Basic | 120 | 3 | none (mostly Common) |
  | Super | 300 | 4 | at least 1 Uncommon |
  | Ultra | 700 | 5 | at least 1 Rare |
  | Legend | 1500 | 5 | at least 1 Epic (and a chance of Legendary) |

  The exact odds of each pack are shown on the Packs screen. The best card is revealed last; click a card to flip it, or "Flip all".
* **Friendly rules:** packs use only in-game coins (there is **no real money anywhere**). A card you already own pays coins back (5 / 15 / 40 / 100 / 250 by rarity, outfits pay double) -
  never more than a small part of the price (a test checks this), so you cannot make coins by opening packs. A "lucky streak protection" counter guarantees an Epic or better
  card after 10 packs without one. Everything is cosmetic: nothing in a pack changes how a minigame plays.
* **The Outfit book** (bottom of the Packs screen) lists 28 outfits. Own all three pieces (pieces can come one by one or all at once) and click the outfit to wear it.
* **A note on the old "no gambling" rule:** packs are random, so they bend it. The safeguards above (coins only, shown odds, guarantees, refunds, no pay-to-win) are why I think it
  fits the spirit of the rule, but if you would rather not have any randomness, the shop could sell pack items for fixed coin prices instead - tell me.
* **Where it is saved:** in your browser with the rest of your wallet. As with the Shop, someone who edits their own saved data can only give THEMSELVES items.

### Coins and the Shop (cosmetics only)

* **Earning:** everybody who plays a round with others earns **10 coins**, plus the points
  they scored that round, +5 for winning the round, +3 for getting a silly title. At the end of
  a match everybody earns **+5**, the winner **+10**. A 3-round match with friends pays roughly
  50 to 60 coins. Leaving mid-round earns nothing for that round, and playing **alone** only
  earns a flat 3 coins per round so nobody can farm the shop. The server decides the amounts.
* **Spending:** click **Shop** on the title screen, in the lobby, or on the final scoreboard.
  Pick Hats, Skins or Colors, click an item to preview it on your character, then Buy. Some
  items are free from the start; the cheapest paid ones are about one match, and the best
  (the Crown hat, the Rainbow skin) take a few matches. Locked colors show a padlock, and the
  ten trophy items show a trophy (see above).
* **It only buys looks.** Nothing in the shop changes how a minigame plays, and nothing costs real money.
  Since v0.12.0 there are also **cosmetic packs** (random cards, paid ONLY with coins you earn by playing) - see the next section.
  Items that only come out of packs show a gift tag in the Shop; clicking "Find it in Packs" jumps to the packs screen.
* **Where it is saved:** in your browser (`localStorage`), like your name and look. It stays
  on that browser and survives restarts, but it does not follow you to another device, and
  clearing the browser's site data wipes it. Because it lives in your browser, a person who
  edits their own saved data can give THEMSELVES items; that cannot affect anybody else's game.


---

## 4. Test it with several players

There are four different levels of "multiplayer", and it matters which one you are testing:

| Level | What it proves | How |
|---|---|---|
| A. One browser window | The game and screens work | Create a room alone and press "Start solo practice" |
| B. Several windows on **your** computer | The server really syncs several clients | See below |
| C. Several devices on your **home Wi-Fi** | Real networking between computers | See below |
| D. Friends over the **internet** | Deployed online | See section 7 |

**B - several windows on one computer**

1. Window 1: open http://localhost:3000, type a name, click **Create a room**. Note the 4-letter code.
2. Window 2: open http://localhost:3000 (a second browser window, a private/incognito window, or a different browser), type another name, enter the code, click **Join**.
3. Both lobby screens now show two characters. In window 2 click **I'm ready!**, then in window 1 click **Start match**.
4. Note: your keyboard controls only the window you last clicked. The other character will stand still and eventually fall - that is normal for solo testing, and handy as a punching bag.
   Tabs in the same browser are separate players too (each tab remembers its own seat).

**C - other devices on your Wi-Fi**

1. When the server starts, it prints a line like `On your Wi-Fi/LAN: http://192.168.1.23:3000`.
2. On another computer on the same Wi-Fi, open that address.
3. If it does not load, your computer's firewall is probably blocking Node.js. On Windows, when a popup asks whether to allow Node.js, choose **Private networks**. On Mac: System Settings > Network > Firewall.
4. Phones can *open* the page, but this milestone has **keyboard controls only** (no touch controls yet).

### Manual test checklist

Tick these off yourself (I tested the same flows with automated tests, but nothing replaces eyes and fingers):

- [ ] Title screen shows; the colour swatches (12), hat arrows and skin arrows change the character (you start with a handful; the rest come from the Shop or Trophies)
- [ ] Resize the browser window very wide and very tall: there are **no black bars**, the background colour just continues to the edges
- [ ] After a round with coins in your purse, a **Pit stop!** screen appears: buy a power-up, click it again to refund, click "I'm ready"; the next intro card lists "Your power-ups"
- [ ] Finishing your first round pops up "Achievement unlocked!"; the **Trophies** screen shows progress
- [ ] "Create a room" gives a 4-letter code and a lobby
- [ ] Second window joins with the code and appears in the first window's lobby
- [ ] "Copy invite link" copies a link; opening it pre-fills the code
- [ ] "I'm ready!" shows "Ready!" on the other screen
- [ ] Host starts: intro card -> 3,2,1,GO
- [ ] You can walk with WASD/arrows and the character turns to face your direction
- [ ] **Space makes you jump (squash + stretch, shadow shrinks)**
- [ ] **You can jump across a 1-tile and a 2-tile hole and keep standing**
- [ ] Walking into a hole drops you; you become a ghost
- [ ] `E` shoves the other player; they fly back and show stars; you hear a sound
- [ ] Shoving someone off the edge shows "KO! +2"
- [ ] As a ghost, `E` over solid floor drops goo; over a hole it complains
- [ ] Results screen lists everyone with points and titles
- [ ] After 3 rounds, the final scoreboard appears; host can "Play again" or return to the lobby
- [ ] Refresh the page mid-match: you come back into the same room
- [ ] Close one window mid-round: the other player's round still finishes
- [ ] Join a room *during* a round: you watch, then play the next round
- [ ] Gold Grab: coins spin and disappear when you run over them (and you hear a "ding"); a shove makes the victim's coins pop out; the big jackpot coin shows a shrinking ring
- [ ] Hot Potato: the bomb appears next to one player with a countdown that flashes faster near the end; shoving passes it ("TAG!"); BOOM shakes the screen; a jump dodges the shove
- [ ] Hill Hustle: standing alone on the hill makes it your colour with a crown; two players turn it red; a "NEXT" ring appears before it hops
- [ ] The top-right pill and the score chips make sense in each game (coins / booms / seconds)
- [ ] Press `M`: sound toggles. Press `N`: only the music toggles
- [ ] Music plays after your first click, changes between the lobby, each minigame, the pit stop and the final screen, and is quiet during 3-2-1
- [ ] The music is not too loud next to the sound effects (if it is, lower `MUSIC_VOLUME` in `public/js/music.js`)

---

## 5. Automated tests

```
npm test
```

runs **341 automated tests** (about a minute and a half):

* `tests/game.test.js` (28 tests) - the Crumble Floor rules: standing, falling,
  **jumping over 2-tile holes (and failing to clear 3-tile ones)**, no falling while
  airborne, jump buffering, shove range/cone/cooldown/immunity, KO credit, ghosts and
  goo, scoring and ties, disconnects, hostile inputs, the seven floors, and 21 randomized full rounds.
* `tests/minigames.test.js` (42 tests) - the shared arena rules and the three new minigames:
  coins (pickup, drops, cap, lock, jackpot catch-up rule), the bomb (pass, no hand-back, jump
  dodge, boom, fairest next holder, holder leaving, solo practice, nobody eliminated), the hill
  (alone vs contested, warning and hop, staying inside the arena), the countdown, walls,
  shove rules, hostile inputs, players leaving, fuzzed full rounds for every game and
  variant, and the match schedule.
* `tests/minigames2.test.js` (47 tests) - Prop Hunt, Meteor Mayhem and Crown Chaos: roles, the
  blindfold, disguise / swap / cooldown, **the seeker's snapshot never lists a disguised hider**
  and trims who-did-it events, smack rules (nearest target, dizzy on a plain prop, jump dodge),
  found players staying in the game, scoring and the early finish, a seeker leaving, solo
  practice, meteor warning / landing / jump-over / breather / fewest hits wins, crown pickup,
  knock-off, lockout, shield, overheat, crown leaving the arena, and fuzzed full rounds for
  every variant and 1-8 players.
* `tests/powerups.test.js` (22 tests) - the catalogue and price rules, the pit stop in a room (only open
  between rounds, cannot overspend / duplicate / carry a third / buy nonsense, last-place discount,
  exact refunds, ends when everyone is ready or time is up, skipped when nobody can afford anything,
  boosts last one round, the purse starts at 0 each match) and the effect of every boost inside the
  games (including Prop Hunt) and that junk values cannot break a game.
* `tests/achievements.test.js` (18 tests) - every achievement and reward is valid, each round/match is
  counted once (reload-safe), no wins from solo practice, Hat Trick must be in one match, per-game
  wins, totals that unlock hats and skins, rewards are unlock-only and granted once, damaged saved
  data is repaired, and the server sends the fields the trophy case needs.
* `tests/maps.test.js` (17 tests) - all 11 maps are valid, connected, have room for 8 and standable spawn points;
  the classic map is exactly the old floor; **every map x every minigame that uses maps x Rage Bait on/off** is played with
  8 button-mashing players and nobody may ever leave the floor; the host's pick is validated and reaches the arena info;
  the browser's prediction rule matches the server's for every map; a real-network test picks a map and checks the match uses it.
* `tests/v011.test.js` (15 tests) - the 24 skins, the 20 new achievements (map, Rage Bait, streak, podium, chat/emoji,
  long-term totals), old saves still load, hostile saved data is cleaned, and **every browser script parses**
  (a typo there would leave the title screen dead, and no other test loads `main.js`).
* `tests/music.test.js` (8 tests) - every tune has a sensible tempo, key, chords and drums; every note is
  in a comfortable range and not silent; each tune is identical every time and loops cleanly; the melody
  never leaves its key; each tune is different from the others; every screen and every minigame has music
  and the countdown is silent; and the player is safe to call before the browser unlocks sound.
* `tests/shop.test.js` (17 tests) - coin rewards (everybody earns, winning is only a little more,
  leaving earns nothing, solo is flat) and the shop (free starter items, exact prices, cannot
  buy twice or when too poor, coins paid once per round even if a screen is replayed, damaged or
  hand-edited saves are repaired, the < > buttons only visit owned items, old saved looks are
  swapped for owned ones, how long a match takes to earn an item, and that trophy items cannot be bought
  with any number of coins).
* `tests/minigames3.test.js` (40 tests) - the six newest minigames: scripted rules for each (tile stealing, calls and
  splats, rope sweeps and the wild reversal, gate order and hurdles, buried treasure staying secret, mole stomping),
  plus random full rounds of every game and variant with 1-8 players, and each game running inside a real Room.
* `tests/stamina.test.js` (10 tests) - the shared jump/shove stamina: costs, refill delay, buffering, the power-ups,
  Crumble Floor and Prop Hunt exceptions.
* `tests/predict.test.js` (7 tests) - the movement prediction: replays a whole round against the real server rules
  with 20-100 ms delays and checks the guess is far closer than the old method, walls, smoothing, and that every
  game's snapshot carries the steering info.
* `tests/rage.test.js` (8 tests) - Rage Bait: no stamina, no getting stuck in Lap Dash hurdles, shoves ~3x harder, longer stun, harder tables that only change real settings, every game and
  variant finishing in rage mode with 1-8 players, and Lap Dash's extra hurdles matching what the browser draws.
* `tests/packs.test.js` (17 tests) - back items and catalogue sizes, your five hat collections, pack-only items (cannot be bought, all appear in a pack), outfits,
  odds and prices, the "duplicates never make a profit" check, guarantees over thousands of random packs, pity, duplicate refunds, wallet saving and hostile saved data,
  drawing every new cosmetic without errors, and the server keeping/clamping the back item.
* `tests/social.test.js` (17 tests) - the Rage Bait room setting, emoji bubbles (valid, rate-limited, same-room only), the admin lock (wrong codes, lockouts, short or missing
  codes, no tokens leaked, kick/close/announce), and text chat (phases, filter, limits, history, admin switch).
* `tests/network.test.js` (28 tests) - a real server with real WebSocket clients: rooms,
  joining, 8-player limit, host-only controls, a complete match from lobby to final
  scoreboard, play again, cheating attempts, input flooding, late joins, disconnect +
  reconnect + host migration, seat expiry, leaving mid-round, duplicate-message safety, and
  a 5-round match that mixes every minigame over the network, coin rewards in the results and
  final standings (and a new match id per match), a Prop Hunt match where the seeker's real
  network data is checked for leaks, and a pit stop over real sockets (the server keeps the purse,
  rejects cheats, shows everybody's loadout, and the boost is gone after one round).

(There is more testing that is not part of `npm test`: I also loaded the real web page in
a real headless Chromium against the real server, with several browser windows playing, and
clicked through the shop, a full match and each new minigame. That harness is not part of
the project, so it will not appear in `npm test`.)

---

## 6. How it works (the important idea)

```
 Browser (what you see)                     Server (the referee)
 ----------------------                     --------------------
 reads your keys        --- controls --->   runs the REAL game 30x per second:
                                            movement, jumping, collisions, shoving,
 draws the world        <-- snapshots ---   tiles, goo, timer, scoring, results
 plays sounds/effects
```

* **The server is the referee.** The browser only says "I am holding right + jump"
  and the server decides what happens. There is no message a browser can send
  that says "give me points", so cheating by editing the page does not work.
* The server sends a **snapshot** of the whole world 30 times per second.
  Your browser draws other players slightly in the past (about 0.1 s) and
  blends between snapshots so they look smooth.
* **Rooms** live in the server's memory. A room code is 4 consonants (so random
  codes can never spell a word). If your connection drops, your seat is kept
  for 30 seconds and you automatically return to it. The "seat" is stored in the
  tab's `sessionStorage`.
* **Phases:** lobby -> intro -> playing -> results -> (pit stop) -> intro ... -> final.

### Project layout

```
total-mayhem/
  package.json            list of libraries + the `npm start` / `npm test` commands
  README.md               this file
  server/
    index.js              starts the server (what `npm start` runs)
    app.js                web server + all the Socket.IO messages
    room.js               rooms, lobby, match flow, disconnect handling
    config.js             numbers you may want to change (round length, players...)
    util.js               small helpers (room codes, name cleaning, safe numbers)
    games/
      index.js            the list of minigames + which ones a match plays
      crumbleFloor.js     ALL the rules of Crumble Floor (tuning numbers are at the top)
      arenaBase.js        shared code for the open-arena games: movement, jump, shove, results
      goldGrab.js         ALL the rules of Gold Grab
      hotPotato.js        ALL the rules of Hot Potato
      hillHustle.js       ALL the rules of Hill Hustle
      propHunt.js         ALL the rules of Prop Hunt (and the per-player secret snapshots)
      meteorMayhem.js     ALL the rules of Meteor Mayhem
      crownChaos.js       ALL the rules of Crown Chaos
      paintPanic.js, colorCall.js, jumpRope.js, lapDash.js, digDash.js, moleStomp.js   the six newest games
    stamina.js            the shared jump/shove stamina numbers and helpers
    maps.js               the 11 floor shapes, spawn points and centres (add a map here)
    rage.js               Rage Bait mode physics (each game also has a RAGE table)
    admin.js              the admin panel's lock (code, lockouts)
    chat.js               chat rules: length, rate limit, swear filter
    emotes.js             the 8 emoji bubbles
    rewards.js            how many coins a round / match is worth
    powerups.js           the pit-stop power-ups: catalogue, prices, limits
  public/                 everything the browser downloads
    index.html            the screens
    style.css             colours and layout of menus
    js/
      main.js             connects everything: screens, snapshots, effects, HUD
      renderer.js         draws characters, hats, tiles, coins, bomb, hill, props, meteors, crown, goo, particles (no image files!)
      shop.js             the shop catalogue, prices and the coin wallet (no drawing, easy to test)
      packs.js            the packs: rarities, odds, outfits, opening rules (pure rules, easy to test)
      wardrobe.js         drawing of the back items (capes, cloaks, hoodies), pack skins and the funny hats with idle animations
      music.js            the background music: tunes as data + the player (no audio files)
      achievements.js     the 52 achievements, counting, and which ones give a hat or skin (easy to test)
      constants.js        colours, skin names, hat names, floor themes
      audio.js            synthesized placeholder sound effects
      input.js            keyboard handling
      net.js              Socket.IO wrapper + saved seat
      predict.js          guesses where your own character is right now (hides ping; knows each map's floor)
  tests/
    game.test.js          Crumble Floor rules tests
    minigames.test.js     Gold Grab / Hot Potato / Hill Hustle + schedule tests
    minigames2.test.js    Prop Hunt / Meteor Mayhem / Crown Chaos tests
    minigames3.test.js    Paint Panic / Color Call / Jump Rope / Lap Dash / Dig Dash / Mole Stomp tests
    stamina.test.js       jump + shove stamina tests
    predict.test.js       movement prediction tests
    rage.test.js          Rage Bait tests
    social.test.js        emoji, chat and admin panel tests
    shop.test.js          coin rewards + shop tests
    powerups.test.js      pit stop + power-up tests
    achievements.test.js  trophy case tests
    maps.test.js          the 11 maps + their use in the minigames
    v011.test.js          new skins, new achievements, browser scripts parse
    packs.test.js         back items, packs, odds, outfits, wallet, server back item
    music.test.js         music tests
    network.test.js       multiplayer tests
```

### Things you can safely tweak

* **How fast the floor crumbles:** `_updateWaves()` in `server/games/crumbleFloor.js`
  (the three lines that compute `count`, `crackDur` and `interval`).
* **How the character feels** (speed, jump height, gravity, shove strength and
  cooldown, goo): the `TUNING` block at the top of `server/games/crumbleFloor.js`.
  Example: `jumpSpeed: 430` -> `520` makes jumps higher and longer.
* **The other minigames' numbers:** the `TUNING` and `VARIANTS` blocks at the top of
  `goldGrab.js` (coin cap, jackpot timing, how many coins a shove drops), `hotPotato.js`
  (fuse length, pass protection, shockwave) and `hillHustle.js` (hill size, how often it
  hops). The shared feel (speed, jump, shove) is the `TUNING` block in `arenaBase.js`.
* **Shop prices:** the three `*_PRICES` lists at the top of `public/js/shop.js` (0 = free from
  the start, `U` = unlock-only). **How many coins things pay:** the `REWARD` block in `server/rewards.js`.
* **Match length / number of players / intro and results duration:** `server/config.js`.
* **Colours, hats, skins, floor looks:** names and colours are in `public/js/constants.js`;
  the drawing code (`drawHat`, `drawSkin`, `drawTileDeco`) is in `public/js/renderer.js`.
  If you add a hat or skin, also raise `HAT_COUNT` / `SKIN_COUNT` (and `COLOR_COUNT`
  for colours) in `server/config.js`, because the server range-checks those numbers, add a
  price (or `U`) in `shop.js`, and a height in `HAT_HEIGHT` in `renderer.js` for hats.
* **Achievements:** the `ACHIEVEMENTS` list at the top of `public/js/achievements.js` (name,
  goal, and an optional `reward: { kind, index }` for a trophy hat or skin).
* **Power-ups:** `server/powerups.js` (effects, prices, how many you may carry, the last-place
  discount). **Pit-stop length:** `PITSTOP_MS` in `server/config.js`.
* **Adding a floor:** add an entry to `VARIANTS` in `server/games/crumbleFloor.js`
  (name, tagline, speed multipliers, a `theme` name; optional `gravity` / `jump`
  multipliers) and a matching theme in `THEMES` in `public/js/constants.js`.
  It is added to the match schedule automatically.

### Adding another minigame (how the framework works)

Every minigame is one file in `server/games/` that offers the same small set of functions
(see the comment at the top of `arenaBase.js`). The rooms, lobby, scoring, results screen and
network code never need to know which game is running. To add one:

1. Copy `goldGrab.js` (or `hillHustle.js`) to `server/games/yourGame.js`. It extends
   `ArenaGame`, so movement, jumping, shoving, the countdown and the results table are
   already done. You fill in the blanks: `_update()` (what happens every tick),
   `_rankKey()` (who is winning), `_detail()` (the text on the results screen),
   `_titles()` (funny titles) and what to include in the snapshot.
2. Give it a `VARIANTS` table (name, tagline, theme, small rule tweaks) and a `GAME_ID`.
3. Register it in `server/games/index.js` (one line in `GAMES`). Its variants join the
   match schedule automatically. (Does your game have secrets, like hidden players? Set
   `this.perViewer = true` and fill in `_visible()`, `_eventFor()` and the `viewerId` argument of
   `_extraSnapshot()`. Then every player gets their own snapshot. See `propHunt.js`.)
4. In the browser, add a small drawing function for its objects in `public/js/renderer.js`
   (see `drawArenaGame`) and, if it has new events, a `case` in `handleEvents` in
   `public/js/main.js`. Everything else (HUD, chips, results) already works.
5. Add tests (see `tests/minigames2.test.js` for examples), then run `npm test`.

After changing a server file, stop the server (`Ctrl+C`) and run `npm start` again.
(`npm run dev` restarts automatically for you.) Changes to files in `public/` only need a browser refresh.

---

## 7. Getting friends in from the internet

Right now the game runs on **your** computer, so only people on your Wi-Fi can
reach it. To play with friends elsewhere you need the server running somewhere
they can reach. I have **not** deployed it, so treat these as options to explore
in Milestone 6, not as tested instructions:

* **Quick tunnel (free, nothing to deploy):** keep `npm start` running and use a
  tunnelling tool such as `cloudflared` or `ngrok` to get a public `https://...`
  address that forwards to `localhost:3000`. Friends open that address. Your
  computer must stay on while you play.
* **Real hosting:** you need a host that runs a **Node.js server continuously and
  supports WebSockets** (examples of the type: Render, Railway, Fly.io, or a small VPS).
  Plain static hosts (GitHub Pages, plain Netlify/Vercel static sites) will **not** work,
  because the game needs a live server. Some free tiers put the server to sleep when idle,
  which makes the first load slow. Check current pricing and limits before choosing.
  The server already reads the `PORT` environment variable that these hosts provide
  and has a `/health` address for their health checks.

### About saving progress

Nothing is saved on the server and there are no accounts. What exists today:

* Your name, colour, hat and skin are remembered in your browser (`localStorage`).
* Your **coins and the items you bought** are remembered the same way (`tm_wallet`), and your
  **achievements** too (`tm_trophies`).
* The **pit-stop purse is the exception**: the server keeps it, for the match only.
* Match scores last for the match only.

`localStorage` is free and simple but tied to one browser and editable by the player, which is
fine for purely cosmetic unlocks. The alternative, accounts plus a database (progress follows
you across devices and cannot be edited), adds sign-in, hosting cost and privacy duties. If you
ever want coins to follow players between devices, that is the step to take.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `npm is not recognized` / `command not found` | Node.js is not installed or the terminal was opened before installing. Install from nodejs.org, then open a **new** terminal. |
| `Cannot find module 'express'` | Run `npm install` inside the project folder. |
| `Port 3000 is already in use` | The game is already running in another terminal, or another program uses 3000. Close it, or run on another port: Mac/Linux `PORT=3001 npm start`; Windows PowerShell `$env:PORT=3001; npm start`. |
| Page loads but shows "Connection lost. Reconnecting..." | The server stopped. Look at the terminal; restart with `npm start`. |
| "No room found with code ..." | Check the code letters. If the server was restarted, old rooms are gone - create a new one. |
| Another computer cannot open the LAN address | Same Wi-Fi? Firewall allowing Node.js on private networks? Some guest/public Wi-Fi blocks devices from talking to each other. |
| No sound | Click anywhere on the page first (browsers require it), and check the speaker button in the corner. |
| The second window's character does not move | Keyboard input goes to the window you last clicked. That is normal. |
| The game feels laggy / choppy | Press **F3** in the game (or open the page with `?debug` on the end of the address). It shows **FPS** (should be about 60), **ping** and **snapshots/s** (about 30). *Low FPS* = your computer is struggling: the game already lowers its own resolution automatically, but closing other heavy tabs/apps helps most. *High ping* (over ~80 ms) = the internet connection to the server is the slow part; hosting closer to your friends helps. Press F3 again to hide it. |
| Changes to server files have no effect | Restart the server (`Ctrl+C`, then `npm start`). |

---

## 9. What is verified and what is not

**Verified (by me, in a test environment):**
* All 341 automated tests pass.
* The server starts from a clean install, serves the page, and handles complete matches.
* The real web page and its scripts, run in a simulated browser against the real server,
  completed the full flow: create room, join, ready, start, intro, countdown 3-2-1-GO,
  keyboard input reaching the server (move and jump), results, final scoreboard, play again,
  back to lobby, reconnect after a dropped connection, and leave.
* The renderer draws every hat/colour/skin/mood combination without errors, and I looked at
  rendered images of all 16 hats, all 8 skins (on a light and a dark colour) and frames of
  every floor to check the visuals. I have NOT seen them move in a real browser.
* The three new minigames were played by random "bot" inputs thousands of times (all
  variants, 1-8 players) and always finished with valid results; their rules are covered by
  the tests above. The real page also played a 3-round Gold Grab, Hot Potato, Hill Hustle
  match in the simulated browser, and I looked at rendered images of every game.
* **Real browsers:** I played the new games with three headless Chromium windows against the
  real server and looked at screenshots from each player's point of view: the blindfolded
  seeker, a hider disguised as a gift box with their "YOU" marker, meteor warnings and impacts,
  and the crown. I also bought items in the shop, saw the items stay after a reload, watched coins
  being paid in the results and final screens, and checked that reloading the page in the
  middle of the final screen does not pay twice. No page errors appeared.
* **Real browsers, this release:** three headless Chromium windows (one very wide, one tall) played
  a match against the real server: the pit-stop screen, buying, refunding, "I'm ready", the
  last-place discount, the intro listing your power-ups, the black-bar fix (checked pixel colours at
  the edge of the game), the trophy screen, unlock pop-ups, the unlock-only hints in the shop, and
  all ten new hats and skins drawn up close. Reloading on the results/final screen did not count
  anything twice. No page errors appeared.
* **Music, measured but not heard:** in real Chromium I measured the actual audio output of every tune
  (they all play, at moderate volume without clipping), checked that `N` and `M` silence it, that the
  countdown is quiet and that the tune changes with the screen. I cannot hear it, so whether it sounds
  *good* (and how loud it is on your speakers) is for your ears to judge.
* The new floors' *feel* (Moonbase jump height, Swamp Stomp steering, how fast Lava Lounge
  collapses) is untuned: the tests prove they run and finish, not that they are fun.
* **The balance of the new minigames is untested by humans**: how many coins spawn, how
  long the bomb fuse is, how big the hill is, how strong shoves are, how long Prop Hunt hiders
  have to hide, how strong the seeker is, how fast meteors fall, and how long the crown lasts.
  Likewise the **shop prices, coin rewards, power-up strengths and prices, and achievement goals** are first guesses. These are first guesses
  and need a few real play sessions to tune.

* **Real browser, this release (v0.9.0):** headless Chromium played each of the six new minigames against the real
  server (moving, jumping and shoving) and I looked at a screenshot of each: Paint Panic tiles turning to the
  player's colour, Color Call's zones and called colour, the Jump Rope sweeping across the floor, Lap Dash's gates and hurdles, Dig Dash's X marks and
  Mole Stomp's burrows and a red mole. The stamina bar is on screen and drains when you jump and shove. Two browser windows tried **public rooms**: the list was empty,
  the host ticked Public, the other window saw the room and clicked it to join, and unticking removed it. The pit stop showed all
  seven power-ups. No page errors appeared. Along the way this found two real bugs (the home-page list could start empty
  until the next refresh, and F3 reacted a second late); both are fixed.
* **The balance of the six newest games and of stamina is untested by humans.** How big the bar is, the costs, the rope speed, how long
  a Color Call lasts, how many bombs Dig Dash buries, how often moles appear, and how strong the Lap Dash rubber band is are first guesses. Bots prove the
  games run and finish, not that they are fun. The bigger shove reach (115) may also make shoving feel too strong. Tune the numbers
  at the top of each game file and in `server/stamina.js`.
* **Room size and prediction in a real browser:** the lobby's Players menu works for the host, is greyed out for guests, and
  limits joining (tests + Chromium). With a simulated slow connection, movement started on screen about 110 ms sooner. I have
  **not** felt it with my hands, and I have not tested real-internet ping or a crowded 8-player match with prediction on.
* **Rage Bait, emoji, chat and admin in real Chromium:** the host's checkbox (hidden for guests), the red badge and glow, emoji bubbles over heads in the
  game and in the lobby, the emoji picker, the chat box appearing between rounds and hiding during rounds, typed text staying text (an injected `<b>` stayed
  plain), the swear mask, unread counter, a wrong admin code being refused, the right one opening the panel, an announcement appearing for another player,
  a kick sending that player to the title screen, and the admin chat switch disabling everybody's chat box. No page errors appeared.
* **Rage Bait is only bot-tested for balance.** The tests prove every minigame still runs and finishes with it on; whether it is funny-hard or just
  impossible is for you and your friends to judge, and you will want to tune the `RAGE` tables. The red glow is subtle on some floors.
* **Chat moderation is basic.** The swear filter is a small word list; a determined person can get around it, and it does not know other languages. If kids play,
  consider switching chat off (`CHAT_ENABLED: false`) or keeping an eye on rooms in the admin panel.
* **The admin code protects a feature, not your computer:** I tested the lockouts and the permission checks, but I have not had the panel security-reviewed by anyone else.
  Keep the code secret, and use a long one (random is best) on a public server.
* I did not test public rooms across the real internet, only on one machine, and did not look at the mobile layout of the new list
  beyond checking that it fits a narrow window.

**Added in v0.12.0 and how it was checked:**
* In real headless Chromium I drew every new back item (21), skin (13) and hat (30) in the Shop preview and looked at contact sheets: capes, cloaks and hoodies are
  visible and clearly different; the new skins are readable. I opened a Legend pack by clicking, flipped cards, saw NEW!/Duplicate labels, saw the wallet and
  items saved across a page reload, saw "Find it in Packs" for a pack-only item, and played a Rage Bait round in a wide window: the red glow covers the whole window and
  the stamina bar is hidden. No page errors appeared.
* Packs: the guarantee, pity, duplicate refunds (always far below the price) and outfit rules are covered by tests, including thousands of random packs.
* Rage Bait: a test checks that jumping and shoving work with an empty bar and spend nothing.

**v0.12.1 fixes:** (1) In Lap Dash with Rage Bait you could get **stuck in a hurdle bar for good** - the trip stun (1.1 s) was longer than the safety time after it (0.6 s),
so you re-tripped on the same bar over and over (my test showed 13 trips and 7.7 s stuck). The safety time now starts when the stun ends, and a test checks you trip once and walk on.
(2) The little menu characters are no longer redrawn while their screen is hidden, and only at 30 pictures a second (less work every frame). (3) The Rage Bait red glow is now a cheap gradient
instead of a big blurred shadow (cheaper on large Retina screens). I could not reproduce slowness in my own tests (steady 60 FPS, small network traffic, tiny server cost), so I do **not**
know that these fully fix the lag you feel; the stuck-in-the-bar bug was real and is fixed.

**Not verified in v0.12.0 (please check yourself):**
* **Pack prices, odds and refund amounts are first guesses.** I have not watched real people earn coins and open packs, so I do not know if 1500 coins for a Legend pack is too slow or too fast
  (a 3-round match pays roughly 50-60 coins). If it feels wrong, the numbers are at the top of `public/js/packs.js` (and the coin rewards in `server/rewards.js`).
* I looked at the idle animations only as still frames, so I have **not** seen the chicken squawk, the alien wave or the crown wobble in motion. The drawing code runs without errors for every animation state.
* A few hats are quite small or simple (Unpaid unicorn, Satellite dish, Robot colander). Capes are mostly hidden behind your body from the front; they show best when you run.
* I did not test two real people comparing back items across a match in this milestone beyond the server test (the back item is sent and kept like the hat and skin).

**Added in v0.11.0 and how it was checked:**
* Maps: every map in every map-using minigame, with and without Rage Bait, was played by 8 random bots for 25 simulated seconds each
  (nobody ever left the floor). In real headless Chromium I played goldGrab on all 11 maps and one round of each other map-using minigame
  on a map, picked the map from the lobby drop-down, and saw the correct floor drawn; a two-window game on Hourglass showed the same floor
  to the host and the guest, and the non-host does not see the map picker. No page errors appeared.
* Skins: all 12 new skins were drawn in the real Shop preview and looked right to me. A few (Polka, Waves, Argyle) are subtle on some colours.
* Achievements: all 52 appear in the trophy case; the new counting rules are covered by tests. The chat/emoji counters count what YOUR browser sent.
* A bug I made while building this (a broken line in `main.js` that killed the title screen) was caught by the real-browser run, which is
  why there is now a test that every browser script parses.

**Not verified (please check these yourself):**
* **The new maps have not been played by real people.** Whether Tiny Table with 8 players is fun or just a pile-up, whether Stepping Stones
  is too punishing, and whether Rage Bait on narrow maps is playable are all unknown. Maps are easy to tweak or remove in `server/maps.js`.
* The new achievement goals and skin prices are first guesses, like the old ones.
* I cannot play it as a human: I have **not** felt the controls,
  heard the sounds, or watched the animation at 60 frames per second. The checklist in
  section 4 covers this. **The jump distance, shove strength and crumble speed are
  my best guesses; expect to tune them after your first few rounds.**
* Playing across different browsers, high-DPI screens and slow connections.
* Real internet play (nothing is deployed).
* **Smoothness on YOUR computer.** In a headless Chromium on a 2-core cloud machine (software
  drawing, no graphics card) the arena went from 43-49 FPS to a steady 60 FPS at 1920x1080
  (also with a 2x hi-res display), and the 3-window stress test improved from 19 to about
  22-32 FPS (all three windows were fighting over 2 CPU cores, so that number says little).
  I could not test a real graphics card, a real laptop, or a real internet connection. If it is
  still laggy for you, press **F3** and tell me the FPS and ping numbers.

**Known limitations in this milestone:**
* Seven minigames so far. More can be added with the steps in section 6.
* Prop Hunt with only two players is lopsided (one seeker, one hider); it is best with 4 or more.
* Keyboard only; no touch/gamepad controls.
* No bots, so solo testing means an idle second window.
* Your own movement waits for the server's answer (a few milliseconds on a home
  network, but your ping over the internet). "Client-side prediction" would hide that
  and is planned for Milestone 6.
* Sounds and music are generated by code (simple synthesizer tones), not recorded: they are charming
  but basic. Real recorded music could replace them later.
* Achievements are counted in the player's own browser, so they follow that browser, not a person.
* Power-ups are tuned by guess: 12-30% boosts that are meant to be fun, not decisive.
* Coins live in each player's own browser (see "Coins and the Shop").
* Room data lives in memory: restarting the server ends all rooms.

---

## 10. Roadmap

| Milestone | Status |
|---|---|
| 1. Design decisions | Done: top-down 2D, Node + Socket.IO, server-authoritative, up to 8 players |
| 2. First playable minigame | Done (and it is already networked, see the reordering note below) |
| 3. Minigame framework + more minigames | Done: shared `ArenaGame` framework + Gold Grab, Hot Potato, Hill Hustle, Prop Hunt, Meteor Mayhem, Crown Chaos |
| 4. Online multiplayer hardening | Mostly done early; remaining: deployment testing, stress tests |
| 5. Sabotage variety, achievements, cosmetic unlocks | **Done:** coin shop, pit-stop power-ups, 52 achievements with trophy hats and skins. Still planned: more sabotage variety |
| 6. Polish, prediction, touch controls, deployment guide | Planned |

**Why I reordered:** the brief suggests networking in Milestone 4, but I built the first
minigame as server-authoritative from day one. Retrofitting networking onto a
local-only game later would have meant rewriting the movement and scoring code. Milestone 4 is
now about testing and hardening rather than building from scratch.
