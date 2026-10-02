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
  collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  query, setDoc, updateDoc, where, writeBatch
} = require('firebase/firestore');

const root = path.resolve(__dirname, '..');
const hostUid = 'myL41BfZY2RXwIxMFU6ybtCHKNE2';
const guestUid = 'guest-owner-1';
const defaultEmail = 'guest@example.com';
const firestoreEmulatorAddress = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18080';
const firestoreEmulatorSeparator = firestoreEmulatorAddress.lastIndexOf(':');
const firestoreEmulatorHost = firestoreEmulatorAddress.slice(0, firestoreEmulatorSeparator);
const firestoreEmulatorPort = Number(firestoreEmulatorAddress.slice(firestoreEmulatorSeparator + 1));
let testEnv;

function emailClaimId(email) {
  return email.trim().toLowerCase().replace(/%/g, '%25').replace(/\//g, '%2F');
}

function anonymousDb(uid) {
  return testEnv.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous' }
  }).firestore();
}

function hostDb() {
  return testEnv.authenticatedContext(hostUid).firestore();
}

function sampleRsvp(ownerUid = guestUid, id = 'guest-1', overrides = {}) {
  const email = overrides.email || defaultEmail;
  const emailLower = overrides.emailLower || email.trim().toLowerCase();
  return {
    id,
    ownerUid,
    name: 'Test Guest',
    email: emailLower,
    emailLower,
    emailClaimId: emailClaimId(emailLower),
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

function sampleClaim(ownerUid = guestUid, id = 'guest-1', status = 'Pending', email = defaultEmail) {
  const emailLower = email.trim().toLowerCase();
  const claimId = emailClaimId(emailLower);
  return {
    ownerUid,
    rsvpId: id,
    emailLower,
    emailClaimId: claimId,
    rsvpStatus: status
  };
}

async function seed(pathname, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), pathname), data);
  });
}

async function seedRegistration({
  ownerUid = guestUid,
  id = 'guest-1',
  status = 'Pending',
  email = defaultEmail
} = {}) {
  const rsvp = sampleRsvp(ownerUid, id, { email, rsvpStatus: status });
  await seed(`rsvps/${id}`, rsvp);
  await seed(`invites/${id}`, sampleInvite(ownerUid, {
    name: rsvp.name,
    numGuests: rsvp.numGuests,
    rsvpStatus: status
  }));
  await seed(`emailClaims/${emailClaimId(email)}`, sampleClaim(ownerUid, id, status, email));
}

async function writeRegistration(db, {
  ownerUid = guestUid,
  id = 'guest-1',
  status = 'Pending',
  email = defaultEmail,
  rsvpOverrides = {},
  inviteOverrides = {},
  claimOverrides = {}
} = {}) {
  const rsvp = sampleRsvp(ownerUid, id, { email, rsvpStatus: status, ...rsvpOverrides });
  const invite = sampleInvite(ownerUid, {
    name: rsvp.name,
    numGuests: rsvp.numGuests,
    rsvpStatus: status,
    ...inviteOverrides
  });
  const claim = {
    ...sampleClaim(ownerUid, id, status, email),
    ...claimOverrides
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'rsvps', id), rsvp);
  batch.set(doc(db, 'invites', id), invite);
  batch.set(doc(db, 'emailClaims', emailClaimId(email)), claim);
  return batch.commit();
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-kylie-18th-rules',
    firestore: {
      host: firestoreEmulatorHost,
      port: firestoreEmulatorPort,
      rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed('system/emailClaimRegistry', { ready: true });
});

after(async () => {
  await testEnv?.cleanup();
});

test('anonymous guest can create their own pending RSVP, invitation, and private email claim atomically', async () => {
  const db = anonymousDb(guestUid);
  await assertSucceeds(writeRegistration(db));
});

test('guests cannot create documents owned by a different UID', async () => {
  const db = anonymousDb(guestUid);
  await assertFails(writeRegistration(db, { ownerUid: 'another-uid', id: 'forged' }));
});

test('guests cannot create confirmed RSVP records or pre-check themselves in', async () => {
  const db = anonymousDb(guestUid);
  await assertFails(writeRegistration(db, { id: 'preconfirmed', status: 'Confirmed' }));
  await assertFails(writeRegistration(db, {
    id: 'self-check-in',
    rsvpOverrides: { checkInStatus: 'Checked In', checkedInAt: 'forged-time' }
  }));
});

test('guests can move a pending RSVP to confirmed only with matching invite and claim updates', async () => {
  await seedRegistration();
  const db = anonymousDb(guestUid);

  await assertSucceeds(writeRegistration(db, { status: 'Confirmed' }));
  await assertFails(updateDoc(doc(db, 'rsvps', 'guest-1'), { rsvpStatus: 'Declined' }));
});

test('guest cannot transfer ownership or edit another guest record', async () => {
  await seedRegistration();
  await seedRegistration({ ownerUid: 'another-uid', id: 'guest-2', email: 'other@example.com' });
  const db = anonymousDb(guestUid);

  await assertFails(updateDoc(doc(db, 'rsvps', 'guest-1'), { ownerUid: 'another-uid' }));
  await assertFails(updateDoc(doc(db, 'rsvps', 'guest-1'), { checkInStatus: 'Checked In' }));
  await assertFails(updateDoc(doc(db, 'rsvps', 'guest-2'), { rsvpStatus: 'Confirmed' }));
});

test('guests can read only their RSVP records and cannot delete records', async () => {
  await seedRegistration();
  await seedRegistration({ ownerUid: 'another-uid', id: 'guest-2', email: 'other@example.com' });
  const guest = anonymousDb(guestUid);
  const host = hostDb();

  await assertSucceeds(getDoc(doc(guest, 'rsvps', 'guest-1')));
  await assertFails(getDoc(doc(guest, 'rsvps', 'guest-2')));
  await assertFails(deleteDoc(doc(guest, 'rsvps', 'guest-1')));
  await assertSucceeds(getDoc(doc(host, 'rsvps', 'guest-1')));
});

test('guest RSVP lookup is limited to the current anonymous account', async () => {
  await seedRegistration();
  await seedRegistration({ ownerUid: 'another-uid', id: 'guest-2', email: 'other@example.com' });
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

test('pending and declined email claims can be reused from another browser account', async (t) => {
  for (const status of ['Pending', 'Declined']) {
    await t.test(`reuses ${status.toLowerCase()} email`, async () => {
      await seedRegistration({ status });
      const newOwner = anonymousDb('new-device-uid');
      await assertSucceeds(writeRegistration(newOwner, {
        ownerUid: 'new-device-uid',
        id: `new-${status.toLowerCase()}`,
        email: defaultEmail
      }));
    });
  }
});

test('a confirmed email stays locked until the host deletes its RSVP, invite, and email claim', async () => {
  await seedRegistration({ status: 'Confirmed' });
  const otherDevice = anonymousDb('different-device-uid');

  await assertFails(writeRegistration(otherDevice, {
    ownerUid: 'different-device-uid',
    id: 'duplicate-confirmed'
  }));

  const host = hostDb();
  await assertSucceeds(deleteDoc(doc(host, 'rsvps', 'guest-1')));
  await assertSucceeds(deleteDoc(doc(host, 'invites', 'guest-1')));
  const claimRef = doc(host, 'emailClaims', emailClaimId(defaultEmail));
  await assertSucceeds(deleteDoc(claimRef));
  const releasedClaim = await assertSucceeds(getDoc(claimRef));
  assert.equal(releasedClaim.exists(), false);

  await assertSucceeds(writeRegistration(otherDevice, {
    ownerUid: 'different-device-uid',
    id: 'reused-after-host-delete'
  }));
  const newClaim = await assertSucceeds(getDoc(claimRef));
  assert.equal(newClaim.data().rsvpId, 'reused-after-host-delete');
});

test('guests cannot read or list private email claims', async () => {
  await seedRegistration();
  const guest = anonymousDb(guestUid);
  const host = hostDb();

  await assertFails(getDoc(doc(guest, 'emailClaims', emailClaimId(defaultEmail))));
  await assertFails(getDocs(collection(guest, 'emailClaims')));
  await assertSucceeds(getDoc(doc(host, 'emailClaims', emailClaimId(defaultEmail))));
});

test('registration is blocked until the host finishes the one-time claim migration', async () => {
  await seed('system/emailClaimRegistry', { ready: false });
  await assertFails(writeRegistration(anonymousDb(guestUid)));
});

test('host can update check-in data and cannot change record ownership', async () => {
  await seedRegistration();
  const host = hostDb();

  await assertSucceeds(updateDoc(doc(host, 'rsvps', 'guest-1'), {
    checkInStatus: 'Checked In',
    checkedInAt: 'test-check-in-time'
  }));
  await assertFails(updateDoc(doc(host, 'rsvps', 'guest-1'), { ownerUid: 'another-uid' }));
});

test('host can migrate email claim fields without changing RSVP ownership', async () => {
  await seed('rsvps/legacy', {
    id: 'legacy', ownerUid: guestUid, name: 'Test Guest', email: 'Guest@Example.com',
    numGuests: 1, guestNames: ['Test Guest'], rsvpStatus: 'Pending', createdAt: 'old'
  });
  await assertSucceeds(updateDoc(doc(hostDb(), 'rsvps', 'legacy'), {
    email: defaultEmail,
    emailLower: defaultEmail,
    emailClaimId: emailClaimId(defaultEmail)
  }));
  await assertFails(updateDoc(doc(hostDb(), 'rsvps', 'legacy'), {
    email: 'other@example.com', ownerUid: 'another-uid'
  }));
});

test('confirmed invitation links can be opened by ID without exposing email', async () => {
  await seed('invites/shared-link', sampleInvite(guestUid, { rsvpStatus: 'Confirmed' }));
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
    email: defaultEmail,
    emailLower: defaultEmail
  }));
});

test('host can delete invitation records while guests cannot', async () => {
  await seed('invites/guest-1', sampleInvite());
  await assertFails(deleteDoc(doc(anonymousDb(guestUid), 'invites', 'guest-1')));
  await assertSucceeds(deleteDoc(doc(hostDb(), 'invites', 'guest-1')));
});
