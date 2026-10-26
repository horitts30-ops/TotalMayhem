# TOTAL MAYHEM  (Milestone 2: Crumble Floor)

An original online party game for friends. You open it in a browser, one person
creates a room, friends join with a 4-letter code, and everybody plays short,
silly minigames. **This milestone contains one complete minigame, "Crumble
Floor", played in three twisted versions per match.** More minigames come in
Milestone 3.

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
| Shove (or drop goo, when you are a ghost) | `E` or `Shift` |
| Mute / unmute | `M` |

---

## 3. How a round works

* **Tiles crack, then fall.** The floor erodes faster and faster. Stand on a
  cracking tile too long and it drops you.
* **Jump over holes.** While you are in the air you cannot fall. A jump carries
  you roughly 2 tiles forward, so a 1-2 tile gap is jumpable and a 3-tile gap is
  not. You land with a small squash, and if you land on a hole you fall.
  (There is a tiny grace period for jumping just after running off an edge, and
  a jump pressed a hair too early still counts.)
* **Shove rivals** toward the edge. Shove has a 1.4 second cooldown, a short
  range in front of you, and the player you hit is dizzy for a moment and
  **cannot be shoved again for 1 second** - nobody gets bullied repeatedly.
  You can also jump over other players.
* **Fell? You become a ghost.** You are never fully out. Ghosts float anywhere
  and press `E` to drop up to 3 goo puddles. A puddle shows a dashed warning
  ring for 0.7 seconds, then slows anyone who steps in it (jump over it to
  avoid it). You cannot be splatted again for 3 seconds. Goo never eliminates
  anybody.
* **Points per round:** 1st place gets 10, and the rest scale down by finishing
  order (with 8 players: 10, 9, 8, 6, 5, 4, 3, 1). **Shoving someone off the edge
  gives +2** (they must fall within 3 seconds of your shove; max 3 KOs counted).
  Players who survive until the 75 second limit tie for first.
* **A match is 3 rounds** (you can choose 1, 3 or 5 in the lobby): Classic,
  *Rush Hour* (faster crumbling), and *Butter Mode* (everything is slippery).
  Then a final scoreboard, and the host can click **Play again** without anybody
  leaving the room.

At the end of every round, the results screen hands out silly titles such as
"Gravity's Favorite", "Absolute Menace" or "Forgot Jumping Exists".

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

- [ ] Title screen shows, hat and colour pickers change the character
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
- [ ] Press `M`: sound toggles

---

## 5. Automated tests

```
npm test
```

runs **43 automated tests** (about 15 seconds):

* `tests/game.test.js` (26 tests) - the Crumble Floor rules: standing, falling,
  **jumping over 2-tile holes (and failing to clear 3-tile ones)**, no falling while
  airborne, jump buffering, shove range/cone/cooldown/immunity, KO credit, ghosts and
  goo, scoring and ties, disconnects, hostile inputs, and 12 randomized full rounds.
* `tests/network.test.js` (17 tests) - a real server with real WebSocket clients: rooms,
  joining, 8-player limit, host-only controls, a complete match from lobby to final
  scoreboard, play again, cheating attempts, input flooding, late joins, disconnect +
  reconnect + host migration, seat expiry, leaving mid-round, duplicate-message safety.

(There is one more test: I also loaded the real web page and its JavaScript in a
simulated browser and clicked through the whole game. That harness is not part of
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
* **Phases:** lobby -> intro -> playing -> results -> (repeat) -> final.

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
  public/                 everything the browser downloads
    index.html            the screens
    style.css             colours and layout of menus
    js/
      main.js             connects everything: screens, snapshots, effects, HUD
      renderer.js         draws characters, hats, tiles, goo, particles (no image files!)
      constants.js        colours, hat names, themes
      audio.js            synthesized placeholder sound effects
      input.js            keyboard handling
      net.js              Socket.IO wrapper + saved seat
  tests/
    game.test.js          rules tests
    network.test.js       multiplayer tests
```

### Things you can safely tweak

* **How fast the floor crumbles:** `_updateWaves()` in `server/games/crumbleFloor.js`
  (the three lines that compute `count`, `crackDur` and `interval`).
* **How the character feels** (speed, jump height, gravity, shove strength and
  cooldown, goo): the `TUNING` block at the top of `server/games/crumbleFloor.js`.
  Example: `jumpSpeed: 430` -> `520` makes jumps higher and longer.
* **Match length / number of players / intro and results duration:** `server/config.js`.
* **Colours, hats, themes:** `public/js/constants.js` and the drawing code in `public/js/renderer.js`.

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

* Your name, colour and hat are remembered in your browser (`localStorage`).
* Scores last for the match only.

When we add achievements and cosmetic unlocks (Milestone 5), the options are:
`localStorage` (free and simple, but tied to one browser and editable by the player -
fine for purely cosmetic unlocks), or accounts plus a database (progress follows you
across devices and cannot be edited, but it adds sign-in, hosting cost and privacy
duties). My recommendation is to start with `localStorage`.

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
| Controls feel laggy | Close heavy tabs. On the same computer lag should be tiny. Over the internet some delay is expected (prediction is on the Milestone 6 list). |
| Changes to server files have no effect | Restart the server (`Ctrl+C`, then `npm start`). |

---

## 9. What is verified and what is not

**Verified (by me, in a test environment):**
* All 43 automated tests pass (and I ran the rules tests repeatedly to check they are not flaky).
* The server starts from a clean install, serves the page, and handles complete matches.
* The real web page and its scripts, run in a simulated browser against the real server,
  completed the full flow: create room, join, ready, start, intro, countdown 3-2-1-GO,
  keyboard input reaching the server (move and jump), results, final scoreboard, play again,
  back to lobby, reconnect after a dropped connection, and leave.
* The renderer draws every hat/colour/mood combination without errors, and I looked at
  rendered frames of all three themes to check the visuals.

**Not verified (please check these yourself):**
* I could not open the game in a real browser, so I have **not** felt the controls,
  heard the sounds, or seen the animation at 60 frames per second. The checklist in
  section 4 covers this. **The jump distance, shove strength and crumble speed are
  my best guesses; expect to tune them after your first few rounds.**
* Playing across different browsers, high-DPI screens and slow connections.
* Real internet play (nothing is deployed).

**Known limitations in this milestone:**
* Only one minigame (in three variants). Milestone 3 adds more.
* Keyboard only; no touch/gamepad controls.
* No bots, so solo testing means an idle second window.
* Your own movement waits for the server's answer (a few milliseconds on a home
  network). A smoother "client-side prediction" is planned for Milestone 6.
* Sounds are generated placeholders. Cosmetics are all free for now; unlockable
  cosmetics and achievements are Milestone 5.
* Room data lives in memory: restarting the server ends all rooms.

---

## 10. Roadmap

| Milestone | Status |
|---|---|
| 1. Design decisions | Done: top-down 2D, Node + Socket.IO, server-authoritative, up to 8 players |
| 2. First playable minigame | **This version** (and it is already networked, see the reordering note below) |
| 3. Minigame framework + 2 more minigames (e.g. Parcel Panic, Flip Orders) | Next. The framework seed exists in `server/games/`. |
| 4. Online multiplayer hardening | Mostly done early; remaining: deployment testing, stress tests |
| 5. Sabotage variety, achievements, cosmetic unlocks | Planned |
| 6. Polish, prediction, touch controls, deployment guide | Planned |

**Why I reordered:** the brief suggests networking in Milestone 4, but I built the first
minigame as server-authoritative from day one. Retrofitting networking onto a
local-only game later would have meant rewriting the movement and scoring code. Milestone 4 is
now about testing and hardening rather than building from scratch.
