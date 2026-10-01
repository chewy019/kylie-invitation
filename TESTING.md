# Verification

The frontend smoke checks use Node's built-in test runner. The Firestore Rules checks use the local Firebase Emulator Suite and a demo project ID, so they do not write to the configured live Firebase project.

## Requirements

- Node.js and npm
- Java JDK 21 or later for the Firebase CLI used by this project

## Commands

```sh
npm install
npm run check
npm test
npm run test:rules
npm run test:all
```

The first emulator run may download the Firestore emulator. The rules test file uses synthetic guest records and mock auth tokens.

To manually test the website against the local Auth and Firestore emulators, run `npm run emulators` in one terminal, start the local web server in another, and open `http://127.0.0.1:4174/?emulator=1`. Emulator mode only activates on `localhost` or `127.0.0.1`; other hosts continue using the configured Firebase project.

Guest invitation links can fetch only a confirmed invite by its exact, high-entropy document ID. Guests cannot list `invites`, and public invite documents contain no email address. RSVP lookups are scoped to the current anonymous Auth UID, so the registration recovery flow works in the same browser profile where the RSVP was created. Cross-device recovery must use a previously saved invitation link/QR or the host; public email search is intentionally disabled.

When deploying these changes, publish the updated client and Firestore rules together. Then sign in to the site as the host once: the app removes email fields from legacy invite documents. Until that cleanup completes, legacy invite links are denied to guests so their old email fields cannot be fetched.
