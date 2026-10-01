const { randomUUID, createHash } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const QRCode = require('qrcode');

initializeApp();

const db = getFirestore();
const invitationBaseUrl = defineString('INVITATION_BASE_URL');
const HOST_UID = 'myL41BfZY2RXwIxMFU6ybtCHKNE2';
const DAILY_EMAIL_LIMIT = 150;
const TARGET_RESEND_COOLDOWN_MS = 15 * 60 * 1000;
const CALLER_RESEND_COOLDOWN_MS = 60 * 1000;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function emailClaimDocumentId(email) {
  return email.replace(/%/g, '%25').replace(/\//g, '%2F');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getInvitationUrl(guestId) {
  let url;
  try {
    url = new URL(invitationBaseUrl.value());
  } catch {
    throw new Error('Set INVITATION_BASE_URL to the public HTTPS website URL before deploying.');
  }
  if (url.protocol !== 'https:') {
    throw new Error('INVITATION_BASE_URL must use HTTPS.');
  }
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', guestId);
  return url.toString();
}

async function makeEmailDocument(record, guestId) {
  const guestName = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim()
    : 'Guest';
  const safeName = escapeHtml(guestName);
  const invitationUrl = getInvitationUrl(guestId);
  const qrDataUrl = await QRCode.toDataURL(invitationUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480
  });

  return {
    to: normalizeEmail(record.emailLower || record.email),
    message: {
      subject: "Kylie's Debut Invitation and QR Code",
      text: [
        `Hello ${guestName},`,
        '',
        "Your RSVP to Kylie's 18th Birthday Debut is confirmed.",
        'Open your personal invitation:',
        invitationUrl,
        '',
        'Your QR code is attached. Anyone with this private invitation link can open the invitation, so keep it safe.',
        '',
        'We look forward to celebrating with you!'
      ].join('\n'),
      html: `<!doctype html>
<html lang="en"><body style="margin:0;padding:32px 16px;background:#fff8fa;font-family:Arial,sans-serif;color:#492633">
  <main style="max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff;border:1px solid #f2dce3;border-radius:20px;text-align:center">
    <p style="margin:0 0 8px;color:#a6405d;font-size:12px;letter-spacing:3px;text-transform:uppercase">Kylie's 18th Birthday Debut</p>
    <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:30px;font-weight:normal">Your invitation is ready</h1>
    <p style="font-size:16px;line-height:1.6">Hello ${safeName}, your RSVP is confirmed. Here is your personal invitation and QR code.</p>
    <p style="margin:24px 0"><a href="${escapeHtml(invitationUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#8d2947;color:#fff;text-decoration:none;font-weight:bold">Open My Invitation</a></p>
    <p style="margin:24px 0 8px;font-size:13px;color:#704b58">Your personal QR code</p>
    <img src="cid:kylie-invitation-qr" width="240" height="240" alt="QR code for your personal invitation" style="display:block;width:240px;height:240px;max-width:100%;margin:0 auto;border:1px solid #f2dce3;border-radius:12px">
    <p style="font-size:12px;line-height:1.6;color:#704b58">The QR code is also attached so you can save it. Anyone with this private invitation link can open the invitation, so keep it safe.</p>
    <p style="margin:24px 0 0;font-size:14px">We look forward to celebrating with you!</p>
  </main>
</body></html>`,
      attachments: [{
        filename: 'kylie-invitation-qr.png',
        path: qrDataUrl,
        contentType: 'image/png',
        cid: 'kylie-invitation-qr'
      }]
    }
  };
}

function getDailyCapRef(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return db.collection('mailDailyCaps').doc(day);
}

function getTimestampMillis(data, field) {
  const value = data?.[field];
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

async function queueConfirmationEmail(guestId, record, claimId) {
  const encodedGuestId = Buffer.from(guestId).toString('base64url');
  const jobId = `confirmed_${encodedGuestId}`;
  const jobRef = db.collection('mailSendKeys').doc(jobId);
  const mailRef = db.collection('mail').doc(jobId);
  const dailyRef = getDailyCapRef();
  const resendRef = db.collection('mailResendCooldowns').doc(claimId);
  const mail = await makeEmailDocument(record, guestId);
  const queuedAt = Timestamp.now();

  return db.runTransaction(async (transaction) => {
    const [jobSnap, dailySnap] = await transaction.getAll(jobRef, dailyRef);
    if (jobSnap.exists) return 'duplicate';
    const sentToday = Number(dailySnap.data()?.count || 0);
    if (sentToday >= DAILY_EMAIL_LIMIT) return 'daily_limit';

    transaction.create(jobRef, {
      guestId,
      kind: 'confirmation',
      createdAt: FieldValue.serverTimestamp()
    });
    transaction.create(mailRef, mail);
    transaction.set(dailyRef, {
      count: sentToday + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(resendRef, {
      lastRequestedAt: queuedAt,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return 'queued';
  });
}

exports.sendInvitationOnConfirmation = onDocumentWritten({
  document: 'rsvps/{guestId}',
  region: 'us-central1',
  maxInstances: 2,
  memory: '256MiB',
  timeoutSeconds: 30
}, async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!after || after.rsvpStatus !== 'Confirmed' || before?.rsvpStatus === 'Confirmed') return;

  const guestId = event.params.guestId;
  const email = normalizeEmail(after.emailLower || after.email);
  const claimId = typeof after.emailClaimId === 'string'
    ? after.emailClaimId
    : emailClaimDocumentId(email);
  if (!isValidEmail(email) || claimId !== emailClaimDocumentId(email)) {
    console.error('Confirmation email skipped: RSVP email or claim is invalid.', { guestId });
    return;
  }

  const [claimSnap, inviteSnap] = await db.getAll(
    db.collection('emailClaims').doc(claimId),
    db.collection('invites').doc(guestId)
  );
  const claim = claimSnap.data();
  const invite = inviteSnap.data();
  if (!claimSnap.exists || !inviteSnap.exists
    || claim.emailLower !== email
    || claim.rsvpId !== guestId
    || claim.ownerUid !== after.ownerUid
    || claim.rsvpStatus !== 'Confirmed'
    || invite.ownerUid !== after.ownerUid
    || invite.rsvpStatus !== 'Confirmed') {
    console.error('Confirmation email skipped: RSVP, invitation, and private email claim do not match.', { guestId });
    return;
  }

  const result = await queueConfirmationEmail(guestId, {
    ...after,
    emailLower: email
  }, claimId);
  if (result === 'daily_limit') {
    console.warn('Confirmation email not queued because the daily email safety limit was reached.', { guestId });
  }
});

exports.requestInvitationResend = onCall({
  region: 'us-central1',
  maxInstances: 2,
  memory: '256MiB',
  timeoutSeconds: 30
}, async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in before requesting an invitation email.');
  const isHost = auth.uid === HOST_UID;
  const provider = auth.token?.firebase?.sign_in_provider;
  if (!isHost && provider !== 'anonymous') {
    throw new HttpsError('permission-denied', 'Only a guest or host can request an invitation email.');
  }

  const email = normalizeEmail(request.data?.email);
  if (!isValidEmail(email)) {
    return { accepted: true, status: isHost ? 'not_found' : 'accepted' };
  }
  const claimId = emailClaimDocumentId(email);
  const claimRef = db.collection('emailClaims').doc(claimId);
  const claimSnap = await claimRef.get();
  if (!claimSnap.exists) {
    return { accepted: true, status: isHost ? 'not_found' : 'accepted' };
  }
  const claim = claimSnap.data();
  if (claim.emailLower !== email || typeof claim.rsvpId !== 'string') {
    return { accepted: true, status: isHost ? 'not_found' : 'accepted' };
  }

  const rsvpRef = db.collection('rsvps').doc(claim.rsvpId);
  const inviteRef = db.collection('invites').doc(claim.rsvpId);
  const [rsvpSnap, inviteSnap] = await db.getAll(rsvpRef, inviteRef);
  const rsvp = rsvpSnap.data();
  const invite = inviteSnap.data();
  if (!rsvpSnap.exists || !inviteSnap.exists
    || claim.rsvpStatus !== 'Confirmed'
    || rsvp.rsvpStatus !== 'Confirmed'
    || invite.rsvpStatus !== 'Confirmed'
    || rsvp.ownerUid !== claim.ownerUid
    || invite.ownerUid !== claim.ownerUid
    || normalizeEmail(rsvp.emailLower || rsvp.email) !== email) {
    return { accepted: true, status: isHost ? 'not_found' : 'accepted' };
  }

  const mail = await makeEmailDocument({ ...rsvp, emailLower: email }, claim.rsvpId);
  const actorKey = createHash('sha256').update(auth.uid).digest('hex');
  const actorRef = db.collection('mailResendActors').doc(actorKey);
  const cooldownRef = db.collection('mailResendCooldowns').doc(claimId);
  const dailyRef = getDailyCapRef();
  const mailRef = db.collection('mail').doc(`resend_${randomUUID()}`);
  const sendKeyRef = db.collection('mailSendKeys').doc(mailRef.id);
  const now = Date.now();

  const result = await db.runTransaction(async (transaction) => {
    const [latestClaim, latestRsvp, latestInvite, cooldownSnap, actorSnap, dailySnap] = await transaction.getAll(
      claimRef,
      rsvpRef,
      inviteRef,
      cooldownRef,
      actorRef,
      dailyRef
    );
    const currentClaim = latestClaim.data();
    const currentRsvp = latestRsvp.data();
    const currentInvite = latestInvite.data();
    if (!latestClaim.exists || !latestRsvp.exists || !latestInvite.exists
      || currentClaim.emailLower !== email
      || currentClaim.rsvpId !== claim.rsvpId
      || currentClaim.rsvpStatus !== 'Confirmed'
      || currentRsvp.rsvpStatus !== 'Confirmed'
      || currentInvite.rsvpStatus !== 'Confirmed'
      || currentRsvp.ownerUid !== currentClaim.ownerUid
      || currentInvite.ownerUid !== currentClaim.ownerUid
      || normalizeEmail(currentRsvp.emailLower || currentRsvp.email) !== email) {
      return 'not_found';
    }

    if (now - getTimestampMillis(cooldownSnap.data(), 'lastRequestedAt') < TARGET_RESEND_COOLDOWN_MS
      || (!isHost && now - getTimestampMillis(actorSnap.data(), 'lastRequestedAt') < CALLER_RESEND_COOLDOWN_MS)) {
      return 'cooldown';
    }
    const sentToday = Number(dailySnap.data()?.count || 0);
    if (sentToday >= DAILY_EMAIL_LIMIT) return 'daily_limit';

    transaction.create(sendKeyRef, {
      guestId: claim.rsvpId,
      kind: 'resend',
      createdAt: FieldValue.serverTimestamp()
    });
    transaction.create(mailRef, mail);
    transaction.set(cooldownRef, {
      lastRequestedAt: Timestamp.fromMillis(now),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    if (!isHost) {
      transaction.set(actorRef, {
        lastRequestedAt: Timestamp.fromMillis(now),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    transaction.set(dailyRef, {
      count: sentToday + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return 'queued';
  });

  return {
    accepted: true,
    status: isHost ? result : 'accepted'
  };
});
