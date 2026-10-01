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

## Gmail invitation email setup

The invitation email uses a Google Apps Script web app that sends through the deploying Gmail account. A newly confirmed RSVP submits an authenticated email request; guests can request a resend by entering their name and email, and the host can resend from the admin guest list. The email contains the private invitation link plus a link to a page that renders and downloads that guest's QR code. The QR is generated on the invitation site, so its private link is not sent to a QR-generation service.

The script validates Firebase ID tokens, checks the confirmed RSVP against its private email claim and invite document, requires a matching name for guest recovery, and applies a 15-minute recipient cooldown and an 80-recipient rolling 24-hour cap. Apps Script itself may enforce lower Gmail quotas. Google's current published MailApp quota for consumer Gmail accounts is 100 recipients per day; quotas can change and count against the account's other Apps Script email sends. See [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

### Setup steps

1. In the Gmail account that should send the messages, open [Google Apps Script](https://script.google.com/) and create a project.
2. Replace its `Code.gs` with the contents of `apps-script/Code.gs`.
3. In **Project Settings**, show the `appsscript.json` manifest, then replace it with `apps-script/appsscript.json` and save.
4. In **Project Settings → Script Properties**, add `INVITATION_BASE_URL` with the public HTTPS site URL ending in `/`, including the repository path if the site uses GitHub Pages. Example: `https://chewy019.github.io/kylie-invitation/`.
5. In the editor, select `authorizeGmailMailer` and click **Run**. Review and grant the listed Gmail, Firestore, and external-request permissions to the Gmail account. This checks Firestore access without sending an email or changing a guest record. The Gmail account must have permission to read this Firebase project's Firestore database.
6. Select **Deploy → New deployment → Web app**. Choose **Execute as me** and **Who has access: Anyone** so the invitation page can submit requests. The code validates Firebase ID tokens before it reads guest data or sends email; the OAuth token stays on Google's server and is never returned to the page.
7. Copy the deployed web app URL ending in `/exec`. Paste it into `GMAIL_MAILER_WEB_APP_URL` near the top of `script.js`, then commit and push the site through GitHub Desktop. Keep the Apps Script project and deployment owned by the same Gmail account.

This setup does not require a custom email domain, a Brevo SMTP key, the Firebase Trigger Email extension, a change to Firestore rules, or Firebase Blaze billing. Messages will come from the Gmail account that owns the Apps Script deployment. Confirmations are submitted by the page immediately after Firestore saves the confirmed RSVP; if the guest closes the page before that request completes, they can use **Recover My Invitation** or the host can use **Resend**.

The Apps Script deployment URL is public configuration, not a credential. Never put the OAuth token or a Gmail password in `script.js` or GitHub. For later Apps Script code changes, create a new deployment version or edit the existing deployment to use the latest version.

### Local emulator

Run `npm --prefix functions install`, set `INVITATION_BASE_URL` in `functions/.env.demo-kylie-18th-rules`, then run `npm run emulators` and serve the site at `http://127.0.0.1:4174/?emulator=1`. The Functions emulator queues mail documents in the Firestore emulator; it does not connect to Brevo or send real email. The local email document collection is protected by Firestore rules just like production.
