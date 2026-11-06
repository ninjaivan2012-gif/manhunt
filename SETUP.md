# Manhunt — setup guide (Windows + Android)

This gets the app from this folder onto your Android phones. It takes about 30–45 minutes the first time. You only do steps 1–3 once.

---

## 1. Install the tools (once)

1. Install **Node.js** (the "LTS" version) from https://nodejs.org. Click Next through the installer.
2. Unzip the `manhunt` folder somewhere easy, like your Desktop.
3. Open the folder, click the address bar at the top of the window, type `cmd`, and press Enter. A black terminal window opens **inside the folder**.
4. In that window, type this and press Enter (it downloads everything the app needs, takes a few minutes):

   ```
   npm install
   ```

Keep this terminal window — every command below goes in it.

---

## 2. Set up Firebase (the online database, free)

Firebase is where everyone's phones share locations, pings and tags.

1. Go to https://console.firebase.google.com and sign in with a Google account.
2. Click **Create a project** → name it `manhunt` → you can turn off Google Analytics → **Create**.
3. **Turn on sign-in:** left menu → **Build → Authentication** → **Get started** → **Sign-in method** tab → click **Anonymous** → switch it on → **Save**.
   (Players don't make accounts; each phone gets an anonymous ID.)
4. **Create the database:** left menu → **Build → Firestore Database** → **Create database** → pick the location closest to you → **Start in production mode** → **Create**.
5. **Add the rules:** in Firestore, open the **Rules** tab. Delete everything there, open the file `firestore.rules` from this folder in Notepad, copy all of it, paste it in, and click **Publish**.
   (These rules stop hunters from secretly seeing runners' live locations, and make tags only work by scanning the runner's phone.)
6. **Get your settings:** click the ⚙️ gear next to "Project Overview" → **Project settings** → scroll to **Your apps** → click the **`</>`** (Web) icon → give it any nickname → **Register app**. You'll see a block of code with `apiKey`, `authDomain`, and so on.
7. Open `src/firebaseConfig.ts` from this folder in Notepad and replace each `PASTE_HERE` with the matching value. Keep the quotes. Save.

---

## 3. Build the Android app (free Expo account)

Expo builds the installable app (an `.apk` file) on their servers, so you don't need Android Studio.

1. Make a free account at https://expo.dev/signup.
2. In the terminal, run these one at a time:

   ```
   npm install -g eas-cli
   eas login
   eas build -p android --profile preview
   ```

3. It asks a few questions. Answer **Yes** to creating a project and to **"Generate a new Android Keystore?"**.
4. The build takes about 10–20 minutes. When it's done you get a **link and a QR code**.
5. Open that link on each Android phone, download the `.apk`, and tap it to install. If the phone says it's blocked, allow "Install unknown apps" for your browser when it asks.

Send the same link to friends so they can install it too.

> Changed something in the code? Run `eas build -p android --profile preview` again and reinstall.

---

## 4. Before the first game (each phone)

When the app asks, allow:
- **Location → "Allow all the time"** (needed so tracking keeps working with the phone locked in your pocket)
- **Notifications** (ping and out-of-bounds warnings)
- **Camera** (hunters scanning tag codes) and **Microphone** (walkie-talkie)

On Samsung, Xiaomi, OnePlus and similar phones, also go to **Settings → Apps → Manhunt → Battery → Unrestricted**, or the phone may pause tracking to save battery.

While a game is running you'll see a "Manhunt is running" notification. That's what keeps it tracking in your pocket.

---

## 5. How a game works

1. The **host** taps **Host a game** and shares the 6-letter code.
2. Everyone else types the code and taps **Join game**. Teams split automatically (an extra player becomes a runner). The host can tap a player to swap their team, or tap **Shuffle**.
3. The host taps **Set border**: tap the map to place a circle and adjust the radius, or use **Custom** to tap the corners of any shape. Use **+ No-go** to outline places like ponds, then **Finish zone**.
4. The host sets the rules (head start, ping interval, game length, how many times the border shrinks, the out-of-bounds grace time, and who gets the walkie-talkie), then taps **Start game**.
5. **Runners** get the head start. After that, every ping shows hunters exactly where each runner was standing at that moment (with their name). Runners get a 10-second warning first.
6. **Hunters** catch a runner by touching them, then the runner opens **My tag code** and the hunter taps **Scan to tag**. The hunter has to be right next to the runner's phone to scan it.
7. Leaving the border or entering a no-go zone starts the grace countdown. Get back in time and you're fine; stay out and you're eliminated.
8. The game ends when all runners are caught (hunters win) or time runs out (runners win if anyone is left). The host can then go **Back to lobby** for another round.

If a tag won't work, the host taps **Host** on the map screen and eliminates that runner manually.

**Quick test:** with two phones, set head start and ping to 1:00 and game length to 10 min, and walk around outside.

---

## Good to know

- **Free limits:** Firebase's free plan allows about 20,000 database writes and 50,000 reads a day. That's roughly 2–3 forty-five-minute games a day with 8 players. If you play more, switch the project to the pay-as-you-go **Blaze** plan in Firebase (usually a few cents a game).
- **Walkie-talkie:** you hold the button, talk (up to 15 seconds), and release to send. Teammates hear it about a second later, like a voice message that plays by itself.
- **Not built yet:** the Bluetooth distance check for tagging (scanning the code already needs you to be right next to them), and iPhone builds (those need Apple's $99/year developer account).
- Map data © OpenStreetMap contributors, map style © CARTO.
