const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const js = read('script.js');
const css = read('style.css');
const cinematic = read('celebration.js');

test('guest flow contains the expected steps and forms', () => {
  const expectedSteps = [
    'step-registration',
    'step-invitation',
    'step-details',
    'step-rsvp',
    'step-confirmation'
  ];
  const positions = expectedSteps.map((id) => html.indexOf(`id="${id}"`));

  assert.ok(positions.every((position) => position >= 0), 'all five guest steps should exist');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'guest steps should stay in order');
  for (const id of ['registration-form', 'rsvp-form', 'recovery-form']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
  const fullNameField = html.match(/<input\b(?=[^>]*\bid="reg-fullname")[^>]*>/i)?.[0];
  const emailField = html.match(/<input\b(?=[^>]*\bid="reg-email")[^>]*>/i)?.[0];
  assert.ok(fullNameField, 'full name field should exist');
  assert.ok(emailField, 'email field should exist');
  assert.match(fullNameField, /\brequired(?:[=\s/>]|$)/i);
  assert.match(emailField, /\btype="email"/i);
  assert.match(emailField, /\brequired(?:[=\s/>]|$)/i);
});

test('cinematic slideshow keeps controls and autoplay without thumbnails', () => {
  assert.match(html, /id="cine-root"/);
  assert.match(html, /id="cine-prev"/);
  assert.match(html, /id="cine-next"/);
  assert.match(html, /id="cine-play"/);
  assert.match(html, /id="cine-full"/);
  assert.match(html, /id="cine-current"/);
  assert.match(html, /id="cine-progress"/);
  assert.doesNotMatch(html, /id="debut-photo-slideshow"/, 'old gallery should be removed');
  assert.doesNotMatch(html, /thumbnail/i);
  assert.doesNotMatch(js, /thumbnail/i);
  assert.match(cinematic, /const AUTOPLAY_MS = 6500;/, 'slides should advance every 6.5 seconds');
  assert.match(cinematic, /prefers-reduced-motion:\s*reduce/, 'autoplay should respect reduced motion');
  assert.match(cinematic, /setCinematicPresentationActive/, 'invitation step should activate the presentation');
});

test('cinematic slideshow photos exist and include alternative text', () => {
  const slides = [...js.matchAll(/\{\s*src:\s*['"]\.\/photos\/([^'"]+)['"],\s*alt:\s*['"]([^'"]+)['"]/g)];

  assert.equal(slides.length, 10, 'expected nine childhood memories plus the debut portrait');
  assert.ok(!slides.some(([, filename]) => filename === 'memory-10.webp'), 'duplicate blue debut photo should be removed');
  assert.ok(slides.some(([, filename]) => filename === 'registration-portrait.jpg'), 'debut portrait should be kept');
  for (const [, filename, alt] of slides) {
    assert.ok(alt.trim(), `${filename} should have descriptive alternative text`);
    assert.ok(fs.existsSync(path.join(root, 'photos', filename)), `missing slideshow photo: ${filename}`);
  }
});

test('local script and stylesheet references resolve to files', () => {
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)].map(([tag]) => tag);
  const localReferences = [];

  for (const tag of tags) {
    const match = tag.match(/\b(?:src|href)="([^"#]+)"/i);
    if (!match || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(match[1])) continue;
    localReferences.push(match[1]);
  }

  assert.ok(localReferences.length > 0, 'expected local page resources');
  for (const reference of localReferences) {
    const relativePath = decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/^\.\//, '');
    assert.ok(fs.existsSync(path.join(root, relativePath)), `missing local resource: ${reference}`);
  }
});

test('blush page and guest boxes use the coordinated ivory and dusty-rose palette', () => {
  assert.match(css, /--guest-surface-ivory:\s*#fffaf6/i);
  assert.match(css, /--guest-surface-blush:\s*#fff5f6/i);
  assert.match(css, /--guest-border-dusty-rose:\s*rgba\(192,\s*129,\s*147,/i);
  for (const selector of [
    '#step-registration .registration-panel',
    '#step-invitation > .page2-invitation-card',
    '#step-details > .debut-card',
    '#step-rsvp > .debut-card',
    '#step-confirmation > .debut-card'
  ]) {
    assert.ok(css.includes(selector), `${selector} should receive the shared palette`);
  }
  assert.match(css, /@media\s*\(max-width:\s*640px\)/, 'mobile slideshow styles should remain defined');
});

test('local emulator mode requires an explicit flag and never activates on hosted domains', () => {
  assert.match(js, /\['localhost',\s*'127\.0\.0\.1'\]\.includes\(window\.location\.hostname\)/);
  assert.match(js, /get\('emulator'\)\s*===\s*'1'/);
  assert.match(js, /connectAuthEmulator\(auth,\s*'http:\/\/127\.0\.0\.1:9099'/);
  assert.match(js, /connectFirestoreEmulator\(db,\s*'127\.0\.0\.1',\s*8080\)/);
});

test('guest lookups stay private and registration writes a private normalized email claim', () => {
  assert.match(js, /where\('ownerUid',\s*'==',\s*auth\.currentUser\.uid\)/);
  assert.match(js, /batch\.set\(inviteRef,\s*inviteRecord\);/);
  assert.match(js, /batch\.set\(emailClaimRef,\s*emailClaim\);/);
  assert.match(js, /emailLower,\s*emailClaimId,\s*ownerUid/);
  assert.match(js, /function getEmailClaimDocumentId\(emailLower\)/);
  assert.match(html, /Already registered on this device\?/);
  assert.match(html, /request the invitation again from any browser/i);
});

test('invitation links show a loading state before the registration page can flash', () => {
  assert.match(html, /new URLSearchParams\(window\.location\.search\)\.get\('invite'\)/);
  assert.match(html, /classList\.add\('invite-link-pending'\)/);
  assert.match(html, /id="invite-link-loader"/);
  assert.match(css, /html\.invite-link-pending #invite-link-loader\s*\{\s*display:\s*grid/s);
  assert.match(css, /html\.invite-link-pending #step-registration\s*,\s*html\.invite-link-pending #step-indicator/s);
  assert.match(js, /classList\.remove\('invite-link-pending'\)/);
});

test('Gmail mailer reports delivery results and can restore a missing claim from a matching confirmed RSVP', () => {
  const appsScript = read('apps-script/Code.gs');
  assert.match(js, /readGmailMailerResult\(requestId,\s*resultTimeoutMs\)/);
  assert.match(js, /statusUrl\.searchParams\.set\('requestId',\s*requestId\)/);
  assert.match(appsScript, /function doGet\(event\)/);
  assert.match(appsScript, /function storeRequestResult_\(requestId, result\)/);
  assert.match(appsScript, /function findConfirmedGuestByEmail_\(email, requiredName\)/);
  assert.match(appsScript, /function restoreMissingEmailClaim_\(guestId, rsvp, invite, email\)/);
  assert.match(appsScript, /matchesInvite_\(invite, guestId, ownerUid, guestName, guestCount\)/);
});

test('host admin reminder is confirmed-only, recipient-confirmed, QR-only, and capped at 80', () => {
  const appsScript = read('apps-script/Code.gs');
  const reminderLogic = js.slice(js.indexOf('function getReminderEligibleGuests'), js.indexOf('async function waitForFirebaseAuth'));
  assert.match(html, /id="send-all-event-reminder-btn"/);
  assert.match(js, /guest\.rsvpStatus === 'Confirmed'/);
  assert.match(js, /window\.confirm\([\s\S]*personal QR code[\s\S]*no invitation link/);
  assert.match(reminderLogic, /guests\.length > 80/);
  assert.match(js, /action:\s*'sendEventReminderAll'/);
  assert.match(appsScript, /if \(identity\.uid !== FIREBASE_HOST_UID\) throw new Error\('permission_denied'\)/);
  assert.match(appsScript, /inlineImages:\s*\{ 'guest-qr': qrBlob \}/);
  assert.match(appsScript, /attachments:\s*\[qrAttachment\]/);
  assert.match(appsScript, /htmlBody[\s\S]*?src=\\?"cid:guest-qr/);
});

test('email reuse favors pending and declined records but blocks confirmed records first', () => {
  const emailLookup = js.slice(js.indexOf('async function findInvitationByEmail'), js.indexOf('async function findConfirmedInvitationByEmailAndName'));
  assert.match(emailLookup, /matches\.find\(\(record\) => record\.rsvpStatus === 'Confirmed'\)\s*\|\|\s*matches\.find\(\(record\) => record\.rsvpStatus === 'Pending'\)/);

  const declinedLookup = js.slice(js.indexOf('async function findDeclinedInvitationByEmail'), js.indexOf('function openInvitationForGuest'));
  assert.match(declinedLookup, /record\.rsvpStatus === 'Declined'\s*&& normalizeEmail\(record\.email\) === emailLower/);
  assert.doesNotMatch(declinedLookup, /normalizeName\(record\.name\)/);
});

test('admin can delete RSVP records of every status', () => {
  const deleteFunction = js.slice(js.indexOf('window.deleteGuestRecord'), js.indexOf('// Render Database Table'));
  assert.match(deleteFunction, /transaction\.delete\(rsvpRef\)/);
  assert.match(deleteFunction, /transaction\.delete\(inviteRef\)/);
  assert.match(deleteFunction, /transaction\.delete\(emailClaimRef\)/);
  assert.match(deleteFunction, /emailClaim\.rsvpId === guestId/);
  assert.match(deleteFunction, /emailClaim\.ownerUid === rsvpSnap\.data\(\)\.ownerUid/);
  assert.doesNotMatch(deleteFunction, /rsvpStatus\s*!==\s*'Pending'/);
  assert.match(js, /deleteButton\.innerHTML\s*=.*Delete/);
  assert.match(html, /<th class="p-3 font-semibold">Actions<\/th>/);
});

test('application JavaScript passes Node syntax checks', () => {
  for (const file of ['script.js', 'tailwind.config.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  }
});
