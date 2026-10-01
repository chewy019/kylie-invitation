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

## Invitation email setup

The email flow uses Firebase Cloud Functions and Firebase's **Trigger Email** extension. A confirmed RSVP creates a private email job with the personal invitation link and an attached/inline QR image. Public recovery sends only a generic response, and the server checks the private email claim, RSVP, and invitation before it queues anything. Pending and Declined RSVPs do not receive a confirmation email. The host can resend from a Confirmed row in the database console.

### Before deployment

1. The Firebase project needs the **Blaze** plan to deploy Cloud Functions. This links billing to the project. Functions include monthly no-cost quotas, but deployment storage and use above no-cost quotas can incur charges. Set a budget alert and review the Cloud Functions spend controls in Google Cloud before release. This repository caps email jobs at 150 per UTC day, with a 15-minute per-address resend cooldown and a 1-minute per-browser-account cooldown.
2. Create a Brevo account, verify the sender address/domain, and create an SMTP key. The Brevo Free plan currently includes 300 sends per day and adds Brevo branding. The app cap leaves headroom beneath that limit.
3. In Firebase Console, install the official **Trigger Email** extension. Set its Firestore mail collection to `mail`, and enter the Brevo SMTP relay credentials and verified default From address in the extension setup. Do not put SMTP credentials in this repository or in browser code. Brevo recommends SMTP port 587.
4. Set `INVITATION_BASE_URL` to the full public site base URL (including any path, such as a GitHub Pages repository path) over HTTPS. Copy `functions/.env.example` to `functions/.env.kylie-18th-rsvp` and replace the sample value. The `.env` file is ignored by Git. Firebase prompts for this parameter during deployment if it is not set.
5. Install backend dependencies from the repository root with `npm --prefix functions install`, then deploy Firestore rules and Functions to the existing project:

   ```sh
   npx firebase deploy --only firestore:rules,functions --project kylie-18th-rsvp
   ```

   Install the Trigger Email extension before deploying or sending a real test. Once the backend is deployed, commit and push the updated site files through GitHub Desktop so the live page gets the recovery and admin resend controls. Confirmed records that existed before Functions deployment will not send automatically; use the host's **Resend** action for those guests.

### Local emulator

Run `npm --prefix functions install`, set `INVITATION_BASE_URL` in `functions/.env.demo-kylie-18th-rules`, then run `npm run emulators` and serve the site at `http://127.0.0.1:4174/?emulator=1`. The Functions emulator queues mail documents in the Firestore emulator; it does not connect to Brevo or send real email. The local email document collection is protected by Firestore rules just like production.
