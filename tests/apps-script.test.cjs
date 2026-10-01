const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function createAppsScriptContext() {
  const properties = new Map();
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
    JSON,
    Date,
    Math,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    encodeURIComponent
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
