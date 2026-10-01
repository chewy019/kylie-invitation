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

Guest invitation links can fetch only a confirmed invite by its exact, high-entropy document ID. Guests cannot list `invites`, and public invite documents contain no email address. RSVP recovery lookup stays scoped to the current anonymous Auth UID, while a private `emailClaims` document enforces email reuse across browsers: Pending and Declined claims can be claimed again; Confirmed claims cannot be reused, even after the host deletes the RSVP and invitation.

Publish the updated site and deploy the updated `firestore.rules` as one coordinated release; old clients cannot write the new claim documents. After both are live, sign in to the site as the host and leave the page open until the one-time setup finishes. It removes email fields from legacy invite documents, creates private email claims from existing RSVP records, and marks the registry ready. Guests cannot submit new registrations before that migration is complete. Existing confirmed emails are preserved as locked claims, including if their RSVP is later deleted from the admin console.

The admin console now has a Delete action for every RSVP status. It removes that RSVP and its matching invitation link. Confirmed email claims remain, so deleting a confirmed guest does not make that email available again. Pending and Declined claims can be reused by a later registration.
