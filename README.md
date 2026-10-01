# Scorer's Table — Live

A live, two-device basketball scorekeeper. One person creates a match and gets a link + QR code; a friend opens it on their own phone and both scores sync instantly, Lichess-style.

- **Frontend**: plain HTML/CSS/JS, no build step, no framework.
- **Live sync**: [Firebase Realtime Database](https://firebase.google.com/docs/database) (free tier).
- **Hosting**: GitHub Pages (static files only — Firebase is what makes it "live").

---

## 1. Create a Firebase project (free)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**. Name it anything (e.g. `scorers-table`). You can disable Google Analytics for this project — you don't need it.
2. Once created, click the **web icon (`</>`)** on the project overview page to register a web app. Give it any nickname. You do **not** need Firebase Hosting — just register the app.
3. Firebase will show you a config object that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     databaseURL: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
   Copy these values into `firebase-config.js` in this project, replacing the placeholders. These values are safe to make public — they identify your project, not secret credentials.

4. In the left sidebar, go to **Build → Realtime Database → Create Database**. Choose any region close to you. Start in **locked mode** (we'll paste our own rules next).

5. Still in Realtime Database, click the **Rules** tab, delete everything there, and paste in the contents of `database.rules.json` from this project. Click **Publish**.

   > **What these rules do**: anyone who knows a match's random 6-character code can read and write that match's data — the same trust model Lichess uses for a private game link. Nobody can read or write anything outside `/matches/{id}`. This is fine for a casual game between friends, but don't store anything sensitive in it.

---

## 2. Put the project on GitHub

1. Create a new repository on GitHub (public or private — Pages works with both on paid plans; public repos get free Pages on any plan).
2. Upload these files to the repo root (or push via git):
   ```
   index.html
   style.css
   script.js
   firebase-config.js   ← with YOUR real values filled in
   database.rules.json
   README.md
   ```
3. Commit and push.

---

## 3. Turn on GitHub Pages

1. In your repo, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**, pick your main branch and the `/ (root)` folder.
3. Save. GitHub gives you a URL like `https://yourusername.github.io/your-repo-name/` within a minute or two.

That's your live site. Open it, tap **Create a new match**, fill in both teams, and you'll get a link + QR code to send your friend.

---

## How it works

- Each match gets a random 6-character code (e.g. `CHSAWK`) and lives at `yoursite.com/?m=CHSAWK`.
- Opening that link (or scanning its QR code) subscribes your browser to `matches/CHSAWK` in Firebase and drops you straight into the live match — no account or sign-in needed.
- Every score, substitution, or clock action writes the whole match state back to that same path, and Firebase pushes the update to every connected browser in real time.
- **Match history** (saved finished games) is stored only in each device's own browser storage — it is *not* shared between players. If you'd like a shared/synced history or leaderboard across devices, that would mean writing finished games to their own Firebase path (e.g. `/games/{id}`) instead of `localStorage` — a reasonable next step if you want it.

## Security note

The database rules in this project are intentionally open to anyone who has a match code, with no login required — simplest possible setup for two friends playing casually. If you ever want to lock this down further (e.g. only two specific people can ever write to a given match), that requires adding Firebase Authentication and rewriting the rules to check `auth.uid` — a bigger change than this starter project covers.

## Costs

Firebase's free "Spark" plan includes 1 GB stored and 10 GB/month of downloaded data on Realtime Database — many orders of magnitude more than a casual scoreboard app will ever use.
