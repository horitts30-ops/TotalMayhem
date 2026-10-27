# TOTAL MAYHEM  (seven minigames, a coin shop, power-ups, achievements and music)

An original online party game for friends. You open it in a browser, one person
creates a room, friends join with a 4-letter code, and everybody plays short,
silly minigames. **This version has seven minigames: "Crumble Floor" (on seven
different floors), "Gold Grab", "Hot Potato", "Hill Hustle", "Prop Hunt", "Meteor Mayhem"
and "Crown Chaos".** A match mixes them. Finishing rounds earns **coins** that you spend in
the **Shop** on hats, skins and colors (cosmetics only), you can buy small one-round
**power-ups** at a **pit stop** between rounds, and **26 achievements** unlock special hats and
skins that coins cannot buy (all explained in section 3).

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
* Shove has a 1.4 second cooldown and a short range in front of you. Whoever you hit is dizzy
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

### Music

There is background music, and **it is made entirely by code** (no audio files, no downloads, no
licensing): the browser plays every note live, the same way as the sound effects. Each part of the
game has its own little tune: the title screen and lobby, the intro card, each of the seven minigames
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

Click **Trophies** on the title screen, in the lobby or on the final scoreboard to see all 26
achievements with progress bars. A pop-up appears when you unlock one. Examples: win a round,
win a match, win each of the seven minigames, jump 100 times, earn 10 silly titles, knock out 3
players in one Crumble Floor round, earn 500 coins in total.

Ten of them give a **special hat or skin that coins cannot buy**: Laurel wreath, Golden trophy,
Hard hat, Space helmet, Detective cap, Jester hat, and the Bubbles, Flames, Galaxy and Gold
skins. In the Shop they show a trophy instead of a price, and tell you which achievement unlocks
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
* **It only buys looks.** Nothing in the shop changes how a minigame plays. There is no
  gambling, no random boxes and nothing for real money.
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

runs **207 automated tests** (about 45 seconds):

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
* `tests/network.test.js` (25 tests) - a real server with real WebSocket clients: rooms,
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
    rewards.js            how many coins a round / match is worth
    powerups.js           the pit-stop power-ups: catalogue, prices, limits
  public/                 everything the browser downloads
    index.html            the screens
    style.css             colours and layout of menus
    js/
      main.js             connects everything: screens, snapshots, effects, HUD
      renderer.js         draws characters, hats, tiles, coins, bomb, hill, props, meteors, crown, goo, particles (no image files!)
      shop.js             the shop catalogue, prices and the coin wallet (no drawing, easy to test)
      music.js            the background music: tunes as data + the player (no audio files)
      achievements.js     the 26 achievements, counting, and which ones give a hat or skin (easy to test)
      constants.js        colours, skin names, hat names, floor themes
      audio.js            synthesized placeholder sound effects
      input.js            keyboard handling
      net.js              Socket.IO wrapper + saved seat
  tests/
    game.test.js          Crumble Floor rules tests
    minigames.test.js     Gold Grab / Hot Potato / Hill Hustle + schedule tests
    minigames2.test.js    Prop Hunt / Meteor Mayhem / Crown Chaos tests
    shop.test.js          coin rewards + shop tests
    powerups.test.js      pit stop + power-up tests
    achievements.test.js  trophy case tests
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
* All 207 automated tests pass.
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

**Not verified (please check these yourself):**
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
| 5. Sabotage variety, achievements, cosmetic unlocks | **Done:** coin shop, pit-stop power-ups, 26 achievements with trophy hats and skins. Still planned: more sabotage variety |
| 6. Polish, prediction, touch controls, deployment guide | Planned |

**Why I reordered:** the brief suggests networking in Milestone 4, but I built the first
minigame as server-authoritative from day one. Retrofitting networking onto a
local-only game later would have meant rewriting the movement and scoring code. Milestone 4 is
now about testing and hardening rather than building from scratch.
