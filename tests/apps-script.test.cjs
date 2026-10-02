const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function createAppsScriptContext() {
  const properties = new Map();
  const sentEmails = [];
  const scriptProperties = {
    getProperty(key) { return properties.get(key) || null; },
    setProperty(key, value) { properties.set(key, value); return this; },
    deleteProperty(key) { properties.delete(key); return this; },
    getProperties() { return Object.fromEntries(properties); }
  };
  const context = {
    console: { error() {}, info() {}, warn() {} },
    ContentService: {
      MimeType: { JSON: 'application/json', JAVASCRIPT: 'application/javascript' },
      createTextOutput(text) {
        return {
          text: String(text),
          mimeType: '',
          setMimeType(mimeType) { this.mimeType = mimeType; return this; }
        };
      }
    },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    ScriptApp: { getOAuthToken: () => 'test-oauth-token' },
    MailApp: {
      getRemainingDailyQuota: () => 80,
      sendEmail(message) { sentEmails.push(message); }
    },
    Utilities: {
      base64Decode(value) { return Array.from(Buffer.from(value, 'base64')); },
      newBlob(data, contentType, name) { return { data: Array.from(data), contentType, name }; },
      formatDate() { return '20261002'; },
      getUuid() { return 'test-send-id'; }
    },
    JSON,
    Date,
    Math,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    encodeURIComponent,
    __sentEmails: sentEmails
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Code.gs' });
  return context;
}

function documentRecord(id, fields) {
  return {
    name: `projects/kylie-18th-rsvp/databases/(default)/documents/${id}`,
    fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }
    ]))
  };
}

test('resend restores a deleted email claim only from one matching confirmed RSVP and invitation', () => {
  const context = createAppsScriptContext();
  const email = 'guest@example.com';
  const guestId = 'guest-1234567890';
  const claimId = email;
  const rsvp = documentRecord(`rsvps/${guestId}`, {
    ownerUid: 'anonymous-owner',
    name: 'Kylie Guest',
    numGuests: 1,
    emailLower: email,
    emailClaimId: claimId,
    rsvpStatus: 'Confirmed'
  });
  const invite = documentRecord(`invites/${guestId}`, {
    ownerUid: 'anonymous-owner',
    name: 'Kylie Guest',
    numGuests: 1,
    rsvpStatus: 'Confirmed'
  });
  const claims = new Map();
  context.firestoreGetDocument_ = (collection, id) => {
    if (collection === 'emailClaims') return claims.get(id) || null;
    if (collection === 'invites' && id === guestId) return invite;
    return null;
  };
  context.firestoreQueryDocuments_ = (_collection, fieldName) => fieldName === 'emailLower' ? [rsvp] : [];
  context.firestoreCreateEmailClaim_ = (id, data) => {
    const restored = documentRecord(`emailClaims/${id}`, data);
    claims.set(id, restored);
    return restored;
  };

  const result = context.getConfirmedGuestByEmail_(email, 'kylie guest');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    id: guestId,
    name: 'Kylie Guest',
    email
  });
  assert.equal(context.readString_(claims.get(claimId), 'rsvpId'), guestId);
  assert.equal(context.readString_(claims.get(claimId), 'rsvpStatus'), 'Confirmed');
});

test('resend does not recreate a claim when the matching invitation is missing', () => {
  const context = createAppsScriptContext();
  const email = 'guest@example.com';
  const guestId = 'guest-1234567890';
  const rsvp = documentRecord(`rsvps/${guestId}`, {
    ownerUid: 'anonymous-owner',
    name: 'Kylie Guest',
    numGuests: 1,
    emailLower: email,
    emailClaimId: email,
    rsvpStatus: 'Confirmed'
  });
  const claims = new Map();
  context.firestoreGetDocument_ = (collection, id) => collection === 'emailClaims' ? claims.get(id) || null : null;
  context.firestoreQueryDocuments_ = (_collection, fieldName) => fieldName === 'emailLower' ? [rsvp] : [];
  context.firestoreCreateEmailClaim_ = (id, data) => claims.set(id, documentRecord(`emailClaims/${id}`, data));

  assert.equal(context.getConfirmedGuestByEmail_(email, 'kylie guest'), null);
  assert.equal(claims.size, 0);
});

test('Apps Script exposes the final email result by an opaque request ID', () => {
  const context = createAppsScriptContext();
  const requestId = '12345678-1234-4abc-8abc-1234567890ab';
  context.verifyFirebaseIdToken_ = () => ({ uid: 'anonymous-owner', provider: 'anonymous' });
  context.getConfirmedGuestByEmail_ = () => ({ id: 'guest-1234567890', name: 'Kylie Guest', email: 'guest@example.com' });
  context.enforceLookupCooldown_ = () => {};
  context.reserveSend_ = () => ({ allowed: true, nonce: 'test', confirmationKey: '', targetKey: '', actorKey: '', windowStartedAt: 0 });
  context.sendInvitationEmail_ = () => {};
  context.finalizeSend_ = () => {};

  const post = context.doPost({
    parameter: {
      payload: JSON.stringify({
        action: 'sendInvitation',
        email: 'guest@example.com',
        name: 'kylie guest',
        requestId,
        idToken: 'test-token'
      })
    }
  });
  assert.deepEqual(JSON.parse(post.text), { accepted: true, status: 'sent' });

  const status = context.doGet({ parameter: { requestId } });
  assert.equal(status.mimeType, 'application/javascript');
  assert.equal(status.text, `__kylieMailer_${requestId.replace(/-/g, '')}({"status":"sent"});`);
});

test('bulk event reminders can only be requested by the host account', () => {
  const requestId = '12345678-1234-4abc-8abc-1234567890ab';
  const guestContext = createAppsScriptContext();
  guestContext.verifyFirebaseIdToken_ = () => ({ uid: 'anonymous-guest', provider: 'anonymous' });
  guestContext.sendEventReminders_ = () => assert.fail('A guest must not be able to start a bulk reminder.');

  const rejected = guestContext.doPost({
    parameter: {
      payload: JSON.stringify({ action: 'sendEventReminderAll', requestId, idToken: 'guest-token', qrCodes: [] })
    }
  });
  assert.equal(JSON.parse(rejected.text).status, 'not_found');

  const hostContext = createAppsScriptContext();
  hostContext.verifyFirebaseIdToken_ = () => ({ uid: 'myL41BfZY2RXwIxMFU6ybtCHKNE2', provider: 'password' });
  hostContext.sendEventReminders_ = (qrCodes, uid) => {
    assert.deepEqual(qrCodes, []);
    assert.equal(uid, 'myL41BfZY2RXwIxMFU6ybtCHKNE2');
    return { accepted: true, status: 'sent', total: 2, sent: 2, skipped: 0, failed: 0 };
  };

  const accepted = hostContext.doPost({
    parameter: {
      payload: JSON.stringify({ action: 'sendEventReminderAll', requestId, idToken: 'host-token', qrCodes: [] })
    }
  });
  assert.deepEqual(JSON.parse(accepted.text), {
    accepted: true,
    status: 'sent',
    total: 2,
    sent: 2,
    skipped: 0,
    failed: 0
  });
  const status = hostContext.doGet({ parameter: { requestId } });
  assert.match(status.text, /"total":2,"sent":2,"skipped":0,"failed":0/);
});

test('event reminder sends one personalized QR-only message with an inline image and attachment', () => {
  const context = createAppsScriptContext();
  const qrImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  context.sendEventReminderEmail_(
    { id: 'guest-1234567890', name: 'A & Guest', email: 'guest@example.com' },
    qrImage
  );

  assert.equal(context.__sentEmails.length, 1);
  const message = context.__sentEmails[0];
  assert.equal(message.to, 'guest@example.com');
  assert.match(message.subject, /Reminder/);
  assert.match(message.body, /Saturday, November 7, 2026/);
  assert.match(message.body, /Doors open: 4:00 PM/);
  assert.match(message.body, /Celebration starts: 4:30 PM/);
  assert.match(message.body, /Tito's Restaurant, 546 Concha St\., Tondo, Manila/);
  assert.doesNotMatch(message.body, /https?:\/\//);
  assert.match(message.htmlBody, /Hello A &amp; Guest/);
  assert.match(message.htmlBody, /src="cid:guest-qr"/);
  assert.doesNotMatch(message.htmlBody, /<a\b/i);
  assert.deepEqual(message.inlineImages['guest-qr'].data.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(message.attachments[0].contentType, 'image/png');
  assert.match(message.attachments[0].name, /guest-1234567890\.png$/);
});

test('event reminder checks confirmed RSVP and invitation state before it sends', () => {
  const context = createAppsScriptContext();
  const guestId = 'guest-1234567890';
  const qrImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  context.PropertiesService.getScriptProperties().setProperty(
    'INVITATION_BASE_URL',
    'https://kylie-18th-rsvp.web.app/'
  );
  context.firestoreQueryConfirmedRsvps_ = () => [
    documentRecord(`rsvps/${guestId}`, { rsvpStatus: 'Confirmed' })
  ];
  context.getConfirmedGuestByIdForHost_ = (id) => id === guestId
    ? { id, name: 'Kylie Guest', email: 'guest@example.com' }
    : null;
  context.hasEventReminderBeenSent_ = () => false;
  context.getRemainingMailerQuota_ = () => 80;
  context.reserveSend_ = () => ({ allowed: true, nonce: 'safe-test' });
  context.finalizeSend_ = () => {};
  context.releaseSend_ = () => assert.fail('The valid reminder should not need reservation cleanup.');
  const sent = [];
  context.sendEventReminderEmail_ = (guest, image) => sent.push({ guest, image });

  const result = context.sendEventReminders_([{
    guestId,
    qrUrl: `https://kylie-18th-rsvp.web.app/index.html?invite=${guestId}`,
    qrPngBase64: qrImage
  }], 'myL41BfZY2RXwIxMFU6ybtCHKNE2');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    accepted: true,
    status: 'sent',
    total: 1,
    sent: 1,
    skipped: 0,
    failed: 0
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].guest.id, guestId);
  assert.equal(sent[0].image, qrImage);
});

test('event reminder rejects an unrelated or missing QR before emailing any guest', () => {
  const context = createAppsScriptContext();
  const guestId = 'guest-1234567890';
  const qrImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  context.PropertiesService.getScriptProperties().setProperty(
    'INVITATION_BASE_URL',
    'https://kylie-18th-rsvp.web.app/'
  );
  let databaseRead = false;
  context.firestoreQueryConfirmedRsvps_ = () => { databaseRead = true; return []; };

  const result = context.sendEventReminders_([{
    guestId,
    qrUrl: 'https://unrelated.example/invitation',
    qrPngBase64: qrImage
  }], 'myL41BfZY2RXwIxMFU6ybtCHKNE2');

  assert.equal(result.status, 'invalid_request');
  assert.equal(databaseRead, false);
  assert.equal(context.__sentEmails.length, 0);
});

test('event reminder query filters confirmed RSVPs and requests one extra to detect the cap', () => {
  const context = createAppsScriptContext();
  let queryBody = null;
  context.UrlFetchApp = {
    fetch(_url, options) {
      queryBody = JSON.parse(options.payload);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify([{ document: documentRecord('rsvps/guest-1234567890', {}) }])
      };
    }
  };

  const results = context.firestoreQueryConfirmedRsvps_();
  assert.equal(results.length, 1);
  assert.equal(queryBody.structuredQuery.where.fieldFilter.field.fieldPath, 'rsvpStatus');
  assert.equal(queryBody.structuredQuery.where.fieldFilter.value.stringValue, 'Confirmed');
  assert.equal(queryBody.structuredQuery.limit, 81);
});

test('bulk reminder refuses more than 80 confirmed records before validating or sending any guest', () => {
  const context = createAppsScriptContext();
  context.firestoreQueryConfirmedRsvps_ = () => Array.from({ length: 81 }, (_, index) => ({
    name: `projects/kylie-18th-rsvp/databases/(default)/documents/rsvps/guest-${String(index).padStart(10, '0')}`
  }));
  context.getConfirmedGuestByIdForHost_ = () => assert.fail('Do not start a partial send above the cap.');

  const result = context.sendEventReminders_([], 'myL41BfZY2RXwIxMFU6ybtCHKNE2');
  assert.equal(result.status, 'too_many_recipients');
  assert.equal(result.total, 81);
  assert.equal(context.__sentEmails.length, 0);
});

test('host reminder recipient validation requires a matching confirmed RSVP, claim, and invite', () => {
  const context = createAppsScriptContext();
  const guestId = 'guest-1234567890';
  const email = 'guest@example.com';
  const claimId = email;
  const ownerUid = 'anonymous-owner';
  const records = new Map([
    [`rsvps/${guestId}`, documentRecord(`rsvps/${guestId}`, {
      ownerUid, name: 'Kylie Guest', numGuests: 1, emailLower: email,
      emailClaimId: claimId, rsvpStatus: 'Confirmed'
    })],
    [`emailClaims/${claimId}`, documentRecord(`emailClaims/${claimId}`, {
      ownerUid, rsvpId: guestId, emailLower: email,
      emailClaimId: claimId, rsvpStatus: 'Confirmed'
    })],
    [`invites/${guestId}`, documentRecord(`invites/${guestId}`, {
      ownerUid, name: 'Kylie Guest', numGuests: 1, rsvpStatus: 'Confirmed'
    })]
  ]);
  context.firestoreGetDocument_ = (collection, id) => records.get(`${collection}/${id}`) || null;

  assert.deepEqual(JSON.parse(JSON.stringify(context.getConfirmedGuestByIdForHost_(guestId))), {
    id: guestId,
    name: 'Kylie Guest',
    email
  });
  records.get(`emailClaims/${claimId}`).fields.rsvpStatus.stringValue = 'Declined';
  assert.equal(context.getConfirmedGuestByIdForHost_(guestId), null);
});

test('event reminder reservation blocks duplicate sends to the same email on the same day', () => {
  const context = createAppsScriptContext();
  context.LockService = {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  };
  context.sha256Hex_ = (value) => value;
  const email = 'guest@example.com';
  const key = 'send:event_reminder:kylie-18th-2026-11-07-v1:20261002:' + email;
  context.PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({ status: 'sent' }));

  const reservation = context.reserveSend_(
    'event_reminder',
    'guest-1234567890',
    'Guest@Example.com',
    'myL41BfZY2RXwIxMFU6ybtCHKNE2'
  );
  assert.equal(reservation.allowed, false);
  assert.equal(reservation.status, 'already_sent');
});
