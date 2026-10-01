const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, query,
  setDoc, updateDoc, where
} = require('firebase/firestore');

const root = path.resolve(__dirname, '..');
const hostUid = 'myL41BfZY2RXwIxMFU6ybtCHKNE2';
const guestUid = 'guest-owner-1';
let testEnv;

function anonymousDb(uid) {
  return testEnv.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous' }
  }).firestore();
}

function hostDb() {
  return testEnv.authenticatedContext(hostUid).firestore();
}

function sampleRsvp(ownerUid = guestUid, id = 'guest-1', overrides = {}) {
  return {
    id,
    ownerUid,
    name: 'Test Guest',
    email: 'guest@example.com',
    numGuests: 1,
    guestNames: ['Test Guest'],
    rsvpStatus: 'Pending',
    createdAt: 'test-created-at',
    ...overrides
  };
}

function sampleInvite(ownerUid = guestUid, overrides = {}) {
  return {
    ownerUid,
    name: 'Test Guest',
    numGuests: 1,
    rsvpStatus: 'Pending',
    ...overrides
  };
}

async function seed(pathname, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), pathname), data);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-kylie-18th-rules',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv?.cleanup();
});

test('anonymous guest can create their own RSVP and invitation documents', async () => {
  const db = anonymousDb(guestUid);
  await assertSucceeds(setDoc(doc(db, 'rsvps', 'guest-1'), sampleRsvp()));
  await assertSucceeds(setDoc(doc(db, 'invites', 'guest-1'), sampleInvite()));
});

test('guests cannot create documents owned by a different UID', async () => {
  const db = anonymousDb(guestUid);
  await assertFails(setDoc(doc(db, 'rsvps', 'forged'), sampleRsvp('another-uid', 'forged')));
  await assertFails(setDoc(doc(db, 'invites', 'forged'), sampleInvite('another-uid')));
});

test('guests cannot create RSVP records as confirmed or pre-check themselves in', async () => {
  const db = anonymousDb(guestUid);
  await assertFails(setDoc(doc(db, 'rsvps', 'preconfirmed'), sampleRsvp(guestUid, 'preconfirmed', {
    rsvpStatus: 'Confirmed'
  })));
  await assertFails(setDoc(doc(db, 'rsvps', 'self-check-in'), sampleRsvp(guestUid, 'self-check-in', {
    checkInStatus: 'Checked In',
    checkedInAt: 'forged-time'
  })));
});

test('guest can update their own records but cannot transfer ownership', async () => {
  await seed('rsvps/guest-1', sampleRsvp());
  await seed('rsvps/guest-2', sampleRsvp('another-uid', 'guest-2'));
  await seed('invites/guest-1', sampleInvite());
  const db = anonymousDb(guestUid);

  await assertSucceeds(updateDoc(doc(db, 'rsvps', 'guest-1'), { rsvpStatus: 'Confirmed' }));
  await assertSucceeds(updateDoc(doc(db, 'invites', 'guest-1'), { rsvpStatus: 'Confirmed' }));
  await assertFails(updateDoc(doc(db, 'rsvps', 'guest-1'), { ownerUid: 'another-uid' }));
  await assertFails(updateDoc(doc(db, 'rsvps', 'guest-1'), { checkInStatus: 'Checked In' }));
  await assertFails(updateDoc(doc(db, 'rsvps', 'guest-1'), { role: 'host' }));
  await assertFails(updateDoc(doc(db, 'rsvps', 'guest-2'), { rsvpStatus: 'Confirmed' }));
  await assertFails(updateDoc(doc(db, 'invites', 'guest-1'), { ownerUid: 'another-uid' }));
});

test('guests can read only RSVP records owned by their anonymous account', async () => {
  await seed('rsvps/guest-1', sampleRsvp());
  await seed('rsvps/guest-2', sampleRsvp('another-uid', 'guest-2'));
  const guest = anonymousDb(guestUid);
  const host = hostDb();

  await assertSucceeds(getDoc(doc(guest, 'rsvps', 'guest-1')));
  await assertFails(getDoc(doc(guest, 'rsvps', 'guest-2')));
  await assertFails(deleteDoc(doc(guest, 'rsvps', 'guest-1')));
  await assertSucceeds(getDoc(doc(host, 'rsvps', 'guest-1')));
});

test('guest RSVP lookup is limited to the current anonymous account', async () => {
  await seed('rsvps/guest-1', sampleRsvp());
  await seed('rsvps/guest-2', sampleRsvp('another-uid', 'guest-2'));
  const guest = anonymousDb(guestUid);

  const ownRecords = await assertSucceeds(getDocs(query(
    collection(guest, 'rsvps'),
    where('ownerUid', '==', guestUid)
  )));
  assert.equal(ownRecords.size, 1);
  assert.equal(ownRecords.docs[0].id, 'guest-1');
  await assertFails(getDocs(collection(guest, 'rsvps')));
  await assertFails(getDocs(query(
    collection(guest, 'rsvps'),
    where('ownerUid', '==', 'another-uid')
  )));
});

test('host can update check-in data but cannot change the record owner', async () => {
  await seed('rsvps/guest-1', sampleRsvp());
  const host = hostDb();

  await assertSucceeds(updateDoc(doc(host, 'rsvps', 'guest-1'), {
    checkInStatus: 'Checked In',
    checkedInAt: 'test-check-in-time'
  }));
  await assertFails(updateDoc(doc(host, 'rsvps', 'guest-1'), { ownerUid: 'another-uid' }));
});

test('confirmed invitation links can be opened by ID without exposing email', async () => {
  await seed('invites/shared-link', sampleInvite(guestUid, {
    rsvpStatus: 'Confirmed'
  }));
  await seed('invites/pending-link', sampleInvite(guestUid));
  const reader = anonymousDb('different-device-uid');
  const invite = await assertSucceeds(getDoc(doc(reader, 'invites', 'shared-link')));

  assert.equal(invite.data().rsvpStatus, 'Confirmed');
  assert.equal(invite.data().email, undefined);
  await assertFails(getDoc(doc(reader, 'invites', 'pending-link')));
});

test('anonymous guests cannot list invites; legacy invites stay private until cleaned', async () => {
  await seed('invites/guest-1', sampleInvite(guestUid, {
    rsvpStatus: 'Confirmed',
    email: 'guest@example.com',
    emailLower: 'guest@example.com',
    nameLower: 'test guest'
  }));
  await seed('invites/guest-2', sampleInvite('another-uid', {
    rsvpStatus: 'Confirmed',
    email: 'another@example.com',
    emailLower: 'another@example.com',
    nameLower: 'another guest'
  }));
  const stranger = anonymousDb('unrelated-visitor');
  await assertFails(getDocs(collection(stranger, 'invites')));
  await assertFails(getDoc(doc(stranger, 'invites', 'guest-1')));
});

test('host can scrub old invite contact fields without changing invitation data', async () => {
  await seed('invites/legacy', sampleInvite(guestUid, {
    rsvpStatus: 'Confirmed',
    email: 'guest@example.com',
    emailLower: 'guest@example.com',
    nameLower: 'test guest'
  }));
  const host = hostDb();

  const hostInvites = await assertSucceeds(getDocs(collection(host, 'invites')));
  assert.equal(hostInvites.size, 1);
  await assertSucceeds(updateDoc(doc(host, 'invites', 'legacy'), {
    email: deleteField(),
    emailLower: deleteField(),
    nameLower: deleteField()
  }));
  await assertFails(updateDoc(doc(host, 'invites', 'legacy'), { name: 'Changed Name' }));

  const invite = await assertSucceeds(getDoc(doc(anonymousDb('invite-reader'), 'invites', 'legacy')));
  assert.equal(invite.data().email, undefined);
  assert.equal(invite.data().emailLower, undefined);
  assert.equal(invite.data().name, 'Test Guest');
});

test('guests cannot create public invitation records containing contact data', async () => {
  const db = anonymousDb(guestUid);
  await assertFails(setDoc(doc(db, 'invites', 'leaky-invite'), {
    ...sampleInvite(),
    email: 'guest@example.com',
    emailLower: 'guest@example.com'
  }));
});

test('host can delete invite records while guests cannot', async () => {
  await seed('invites/guest-1', sampleInvite());
  await assertFails(deleteDoc(doc(anonymousDb(guestUid), 'invites', 'guest-1')));
  await assertSucceeds(deleteDoc(doc(hostDb(), 'invites', 'guest-1')));
});
