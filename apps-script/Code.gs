const FIREBASE_PROJECT_ID = 'kylie-18th-rsvp';
const FIREBASE_WEB_API_KEY = 'AIzaSyCK96DUaagUyDjs3lFW4-q29RvgpVCrMBU';
const FIREBASE_HOST_UID = 'myL41BfZY2RXwIxMFU6ybtCHKNE2';
const SENDER_DISPLAY_NAME = "Kylie's 18th Birthday Debut";
const MAX_RECIPIENTS_PER_24_HOURS = 80;
const MAX_EVENT_REMINDER_RECIPIENTS = 80;
const EVENT_REMINDER_CAMPAIGN_ID = 'kylie-18th-2026-11-07-v1';
const RESEND_COOLDOWN_MS = 15 * 60 * 1000;
const CALLER_COOLDOWN_MS = 60 * 1000;
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const REQUEST_RESULT_PREFIX = 'request:result:';
const REQUEST_RESULT_TTL_MS = 60 * 60 * 1000;

/**
 * Public Apps Script endpoint. It only accepts Firebase ID tokens, validates
 * them with Firebase Auth, and sends mail after checking the private RSVP,
 * invitation, and email-claim documents in Firestore. Bulk event reminders
 * are restricted to the host and individually validated confirmed guests.
 */
function doPost(event) {
  let requestId = '';
  let result = { accepted: false, status: 'failed' };
  try {
    const rawPayload = event && event.parameter && event.parameter.payload;
    if (typeof rawPayload !== 'string' || rawPayload.length > 1800000) {
      throw new Error('invalid_request');
    }

    const payload = JSON.parse(rawPayload);
    if (isValidRequestId_(payload.requestId)) requestId = payload.requestId;
    const identity = verifyFirebaseIdToken_(payload.idToken);
    if (payload.action === 'sendEventReminderAll') {
      if (identity.uid !== FIREBASE_HOST_UID) throw new Error('permission_denied');
      result = sendEventReminders_(payload.qrCodes, identity.uid);
    } else {
      let guest;
      let sendKind;

      if (payload.action === 'confirmation') {
        requireAnonymousGuest_(identity);
        guest = getConfirmedGuestById_(payload.guestId, identity.uid);
        sendKind = 'confirmation';
      } else if (payload.action === 'sendInvitation') {
        const email = normalizeEmail_(payload.email);
        if (!isValidEmail_(email)) throw new Error('not_found');

        if (identity.uid === FIREBASE_HOST_UID) {
          guest = getConfirmedGuestByEmail_(email, '');
        } else {
          requireAnonymousGuest_(identity);
          const submittedName = normalizeName_(payload.name);
          if (!submittedName) throw new Error('not_found');
          enforceLookupCooldown_(identity.uid);
          guest = getConfirmedGuestByEmail_(email, submittedName);
        }
        sendKind = identity.uid === FIREBASE_HOST_UID ? 'host_resend' : 'guest_recovery';
      } else {
        throw new Error('invalid_action');
      }

      if (!guest) throw new Error('not_found');
      const reservation = reserveSend_(sendKind, guest.id, guest.email, identity.uid);
      if (!reservation.allowed) {
        result = { accepted: true, status: reservation.status };
      } else {
        try {
          sendInvitationEmail_(guest);
          finalizeSend_(reservation, guest.email, identity.uid);
          result = { accepted: true, status: 'sent' };
        } catch (error) {
          releaseSend_(reservation);
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('Invitation email request rejected or failed:', String(error && error.message || error));
    const errorCode = String(error && error.message || error);
    if (errorCode === 'not_found' || errorCode === 'permission_denied') {
      result = { accepted: false, status: 'not_found' };
    } else if (errorCode === 'lookup_cooldown') {
      result = { accepted: false, status: 'cooldown' };
    } else if (errorCode === 'invalid_request') {
      result = { accepted: false, status: 'invalid_request' };
    }
  }

  if (requestId) storeRequestResult_(requestId, result);
  return jsonResponse_(result);
}

/** Cross-origin JSONP status check for the opaque browser POST response. */
function doGet(event) {
  const requestId = event && event.parameter && event.parameter.requestId;
  if (!isValidRequestId_(requestId)) {
    return jsonpMailerResult_('__kylieMailerInvalidRequest', 'failed');
  }

  const properties = PropertiesService.getScriptProperties();
  const saved = readJsonProperty_(properties, REQUEST_RESULT_PREFIX + requestId);
  const result = saved && Date.now() - Number(saved.at || 0) <= REQUEST_RESULT_TTL_MS
    ? (saved.result || { status: saved.status || 'pending' })
    : { status: 'pending' };
  return jsonpMailerResult_('__kylieMailer_' + requestId.replace(/-/g, ''), result);
}

function isValidRequestId_(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function jsonpMailerResult_(callbackName, result) {
  const value = typeof result === 'string' ? { status: result } : result || {};
  const safeStatuses = [
    'sent', 'partial', 'cooldown', 'daily_limit', 'not_found', 'already_sent',
    'pending', 'processing', 'failed', 'too_many_recipients', 'no_recipients',
    'qr_unavailable', 'invalid_request'
  ];
  const response = {
    status: safeStatuses.indexOf(value.status) === -1 ? 'failed' : value.status
  };
  ['total', 'sent', 'skipped', 'failed'].forEach(function(key) {
    const number = Number(value[key]);
    if (Number.isFinite(number) && number >= 0) response[key] = Math.floor(number);
  });
  return ContentService.createTextOutput(callbackName + '(' + JSON.stringify(response) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function storeRequestResult_(requestId, result) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const now = Date.now();
    const value = typeof result === 'string' ? { status: result } : result || { status: 'failed' };
    properties.setProperty(REQUEST_RESULT_PREFIX + requestId, JSON.stringify({ result: value, at: now }));
    const allProperties = properties.getProperties();
    Object.keys(allProperties).forEach(function(key) {
      if (key.indexOf(REQUEST_RESULT_PREFIX) !== 0) return;
      const saved = readJsonProperty_(properties, key);
      if (!saved || now - Number(saved.at || 0) > REQUEST_RESULT_TTL_MS) properties.deleteProperty(key);
    });
  } catch (error) {
    console.error('Could not save the email request status.', String(error && error.message || error));
  }
}

/** Run once in the Apps Script editor to authorize Gmail and Firestore access. */
function authorizeGmailMailer() {
  const remaining = MailApp.getRemainingDailyQuota();
  const token = ScriptApp.getOAuthToken();
  if (!token) throw new Error('Google authorization was not granted.');
  // A private, nonexistent document is used to verify that this account's
  // OAuth token can reach the project's Firestore without changing any data.
  firestoreGetDocument_('rsvps', 'gmail-mailer-authorization-probe');
  return 'Authorization ready. Gmail recipient quota currently available: ' + remaining;
}

function verifyFirebaseIdToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 6000) {
    throw new Error('invalid_token');
  }

  const tokenParts = idToken.split('.');
  if (tokenParts.length !== 3) throw new Error('invalid_token');

  let claims;
  try {
    const payloadBytes = Utilities.base64DecodeWebSafe(tokenParts[1]);
    claims = JSON.parse(Utilities.newBlob(payloadBytes).getDataAsString('UTF-8'));
  } catch (error) {
    throw new Error('invalid_token');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.aud !== FIREBASE_PROJECT_ID
    || claims.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID
    || typeof claims.sub !== 'string'
    || !claims.sub
    || Number(claims.exp) <= nowSeconds
    || Number(claims.iat) > nowSeconds + 60) {
    throw new Error('invalid_token');
  }

  // This Firebase Auth endpoint verifies the signature and validity of the
  // exact ID token whose claims are checked above.
  const response = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(FIREBASE_WEB_API_KEY),
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }),
      muteHttpExceptions: true
    }
  );
  if (response.getResponseCode() !== 200) throw new Error('invalid_token');

  const result = JSON.parse(response.getContentText());
  const user = result.users && result.users[0];
  if (!user || user.localId !== claims.sub || user.disabled === true) throw new Error('invalid_token');

  const provider = claims.firebase && claims.firebase.sign_in_provider;
  return { uid: user.localId, provider: provider };
}

function requireAnonymousGuest_(identity) {
  if (!identity || identity.uid === FIREBASE_HOST_UID || identity.provider !== 'anonymous') {
    throw new Error('permission_denied');
  }
}

function getConfirmedGuestById_(guestId, ownerUid) {
  if (typeof guestId !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(guestId)) return null;

  const rsvp = firestoreGetDocument_('rsvps', guestId);
  return makeConfirmedGuestFromRsvp_(guestId, rsvp, ownerUid);
}

function getConfirmedGuestByIdForHost_(guestId) {
  if (typeof guestId !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(guestId)) return null;
  const rsvp = firestoreGetDocument_('rsvps', guestId);
  const ownerUid = readString_(rsvp, 'ownerUid');
  if (!ownerUid) return null;
  return makeConfirmedGuestFromRsvp_(guestId, rsvp, ownerUid);
}

function makeConfirmedGuestFromRsvp_(guestId, rsvp, ownerUid) {
  if (!rsvp || readString_(rsvp, 'ownerUid') !== ownerUid
    || readString_(rsvp, 'rsvpStatus') !== 'Confirmed') return null;

  const email = normalizeEmail_(readString_(rsvp, 'emailLower') || readString_(rsvp, 'email'));
  const claimId = emailClaimDocumentId_(email);
  if (!isValidEmail_(email) || readString_(rsvp, 'emailClaimId') !== claimId) return null;

  const claim = firestoreGetDocument_('emailClaims', claimId);
  const invite = firestoreGetDocument_('invites', guestId);
  if (!matchesInvite_(invite, guestId, ownerUid, readString_(rsvp, 'name'), readInteger_(rsvp, 'numGuests'))) return null;
  if (claim) {
    if (!matchesClaim_(claim, guestId, email, ownerUid)) return null;
  } else if (!restoreMissingEmailClaim_(guestId, rsvp, invite, email)) return null;

  return makeGuest_(guestId, rsvp, email);
}

function getConfirmedGuestByEmail_(email, requiredName) {
  if (!isValidEmail_(email)) return null;

  const claimId = emailClaimDocumentId_(email);
  const claim = firestoreGetDocument_('emailClaims', claimId);
  if (!claim) {
    const recoveredGuest = findConfirmedGuestByEmail_(email, requiredName);
    if (!recoveredGuest
      || !restoreMissingEmailClaim_(recoveredGuest.id, recoveredGuest.rsvp, recoveredGuest.invite, email)) return null;
    return makeGuest_(recoveredGuest.id, recoveredGuest.rsvp, email);
  }
  if (readString_(claim, 'emailLower') !== email
    || readString_(claim, 'emailClaimId') !== claimId
    || readString_(claim, 'rsvpStatus') !== 'Confirmed') return null;

  const guestId = readString_(claim, 'rsvpId');
  const ownerUid = readString_(claim, 'ownerUid');
  if (!guestId || !ownerUid) return null;

  const rsvp = firestoreGetDocument_('rsvps', guestId);
  const invite = firestoreGetDocument_('invites', guestId);
  if (!rsvp || !invite
    || readString_(rsvp, 'ownerUid') !== ownerUid
    || readString_(rsvp, 'rsvpStatus') !== 'Confirmed'
    || normalizeEmail_(readString_(rsvp, 'emailLower') || readString_(rsvp, 'email')) !== email
    || readString_(rsvp, 'emailClaimId') !== claimId
    || !matchesInvite_(invite, guestId, ownerUid, readString_(rsvp, 'name'), readInteger_(rsvp, 'numGuests'))) {
    return null;
  }

  const guestName = readString_(rsvp, 'name') || '';
  if (requiredName && normalizeName_(guestName) !== requiredName) return null;
  return makeGuest_(guestId, rsvp, email);
}

function findConfirmedGuestByEmail_(email, requiredName) {
  const matches = new Map();
  ['emailLower', 'email'].forEach(function(fieldName) {
    firestoreQueryDocuments_('rsvps', fieldName, email).forEach(function(rsvp) {
      const name = readString_(rsvp, 'name');
      const guestId = String(rsvp.name || '').split('/').pop();
      const ownerUid = readString_(rsvp, 'ownerUid');
      if (!guestId || !ownerUid
        || readString_(rsvp, 'rsvpStatus') !== 'Confirmed'
        || normalizeEmail_(readString_(rsvp, 'emailLower') || readString_(rsvp, 'email')) !== email
        || readString_(rsvp, 'emailClaimId') !== emailClaimDocumentId_(email)
        || (requiredName && normalizeName_(name) !== requiredName)) return;

      const invite = firestoreGetDocument_('invites', guestId);
      if (!matchesInvite_(invite, guestId, ownerUid, name, readInteger_(rsvp, 'numGuests'))) return;
      matches.set(guestId, { id: guestId, rsvp: rsvp, invite: invite });
    });
  });

  // A missing claim can only be restored automatically when one confirmed record
  // unambiguously matches the submitted email and (for guest recovery) name.
  return matches.size === 1 ? Array.from(matches.values())[0] : null;
}

function restoreMissingEmailClaim_(guestId, rsvp, invite, email) {
  const ownerUid = readString_(rsvp, 'ownerUid');
  const claimId = emailClaimDocumentId_(email);
  const guestName = readString_(rsvp, 'name');
  const guestCount = readInteger_(rsvp, 'numGuests');
  if (!ownerUid || readString_(rsvp, 'rsvpStatus') !== 'Confirmed'
    || normalizeEmail_(readString_(rsvp, 'emailLower') || readString_(rsvp, 'email')) !== email
    || readString_(rsvp, 'emailClaimId') !== claimId
    || !matchesInvite_(invite, guestId, ownerUid, guestName, guestCount)) return false;

  const existing = firestoreGetDocument_('emailClaims', claimId);
  if (existing) return matchesClaim_(existing, guestId, email, ownerUid);

  const claim = {
    ownerUid: ownerUid,
    rsvpId: guestId,
    emailLower: email,
    emailClaimId: claimId,
    rsvpStatus: 'Confirmed'
  };
  try {
    firestoreCreateEmailClaim_(claimId, claim);
    return true;
  } catch (error) {
    // A simultaneous recovery request may have created the same claim first.
    const current = firestoreGetDocument_('emailClaims', claimId);
    if (matchesClaim_(current, guestId, email, ownerUid)) return true;
    console.error('Could not restore a missing email claim.', String(error && error.message || error));
    return false;
  }
}

function matchesClaim_(claim, guestId, email, ownerUid) {
  return Boolean(claim
    && readString_(claim, 'emailLower') === email
    && readString_(claim, 'emailClaimId') === emailClaimDocumentId_(email)
    && readString_(claim, 'rsvpId') === guestId
    && readString_(claim, 'ownerUid') === ownerUid
    && readString_(claim, 'rsvpStatus') === 'Confirmed');
}

function matchesInvite_(invite, guestId, ownerUid, guestName, guestCount) {
  return Boolean(invite
    && readString_(invite, 'ownerUid') === ownerUid
    && readString_(invite, 'rsvpStatus') === 'Confirmed'
    && readString_(invite, 'name') === guestName
    && readInteger_(invite, 'numGuests') === guestCount);
}

function makeGuest_(guestId, rsvp, email) {
  const name = readString_(rsvp, 'name') || 'Guest';
  if (!isValidEmail_(email) || !name.trim()) return null;
  return { id: guestId, name: name.trim(), email: email };
}

function firestoreGetDocument_(collectionName, documentId) {
  const allowedCollections = ['rsvps', 'invites', 'emailClaims'];
  if (allowedCollections.indexOf(collectionName) === -1 || !documentId) return null;

  const path = [collectionName, documentId].map(encodeURIComponent).join('/');
  const url = 'https://firestore.googleapis.com/v1/projects/'
    + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + path;
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  if (status === 404) return null;
  if (status !== 200) {
    console.error('Firestore document lookup failed with HTTP ' + status + '.');
    throw new Error('firestore_unavailable');
  }
  return JSON.parse(response.getContentText());
}

function firestoreQueryDocuments_(collectionName, fieldName, value) {
  if (collectionName !== 'rsvps' || ['emailLower', 'email'].indexOf(fieldName) === -1) {
    throw new Error('invalid_firestore_query');
  }
  const url = 'https://firestore.googleapis.com/v1/projects/'
    + FIREBASE_PROJECT_ID + '/databases/(default)/documents:runQuery';
  const query = {
    structuredQuery: {
      from: [{ collectionId: collectionName }],
      where: {
        fieldFilter: {
          field: { fieldPath: fieldName },
          op: 'EQUAL',
          value: { stringValue: value }
        }
      },
      limit: 51
    }
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(query),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    console.error('Firestore RSVP lookup failed with HTTP ' + response.getResponseCode() + '.');
    throw new Error('firestore_unavailable');
  }
  const rows = JSON.parse(response.getContentText());
  if (!Array.isArray(rows) || rows.length > 50) return [];
  return rows.map(function(row) { return row && row.document; }).filter(Boolean);
}

function firestoreQueryConfirmedRsvps_() {
  const url = 'https://firestore.googleapis.com/v1/projects/'
    + FIREBASE_PROJECT_ID + '/databases/(default)/documents:runQuery';
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'rsvps' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'rsvpStatus' },
          op: 'EQUAL',
          value: { stringValue: 'Confirmed' }
        }
      },
      limit: MAX_EVENT_REMINDER_RECIPIENTS + 1
    }
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(query),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    console.error('Confirmed RSVP lookup failed with HTTP ' + response.getResponseCode() + '.');
    throw new Error('firestore_unavailable');
  }
  const rows = JSON.parse(response.getContentText());
  if (!Array.isArray(rows) || rows.length > MAX_EVENT_REMINDER_RECIPIENTS) {
    return new Array(MAX_EVENT_REMINDER_RECIPIENTS + 1).fill(null);
  }
  return rows.map(function(row) { return row && row.document; }).filter(Boolean);
}

function firestoreCreateEmailClaim_(claimId, claim) {
  const url = 'https://firestore.googleapis.com/v1/projects/'
    + FIREBASE_PROJECT_ID + '/databases/(default)/documents/emailClaims/'
    + encodeURIComponent(claimId) + '?currentDocument.exists=false';
  const fields = {};
  Object.keys(claim).forEach(function(key) {
    fields[key] = { stringValue: claim[key] };
  });
  const response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ fields: fields }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    console.error('Firestore email claim restore failed with HTTP ' + response.getResponseCode() + '.');
    throw new Error('email_claim_restore_failed');
  }
  return JSON.parse(response.getContentText());
}

function readString_(document, fieldName) {
  const value = document && document.fields && document.fields[fieldName];
  return value && typeof value.stringValue === 'string' ? value.stringValue : '';
}

function readInteger_(document, fieldName) {
  const value = document && document.fields && document.fields[fieldName];
  const parsed = value && Number(value.integerValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sendInvitationEmail_(guest) {
  const qrPngBase64 = createInvitationQrPngBase64_(buildInvitationUrl_(guest.id));
  const qrBytes = Utilities.base64Decode(qrPngBase64);
  const qrInlineImage = Utilities.newBlob(
    qrBytes,
    'image/png',
    'Kylie-18th-QR-' + guest.id + '.png'
  );
  const qrAttachment = Utilities.newBlob(
    qrBytes,
    'image/png',
    'Kylie-18th-QR-' + guest.id + '.png'
  );
  const safeName = escapeHtml_(guest.name);

  const subject = "Kylie's Debut Invitation and QR Code";
  const body = [
    'Hello ' + guest.name + ',',
    '',
    "Your RSVP to Kylie's 18th Birthday Debut is confirmed.",
    '',
    'Date: Saturday, November 7, 2026',
    'Doors open: 4:00 PM',
    'Celebration starts: 4:30 PM',
    "Venue: Tito's Restaurant, 546 Concha St., Tondo, Manila",
    '',
    'Please have your personal QR code ready when you arrive for check-in. It is attached and shown below.',
    '',
    'Keep this email private. Anyone with your personal QR code can open your invitation.',
    '',
    'We look forward to celebrating with you!'
  ].join('\n');

  const htmlBody = '<!doctype html><html lang="en"><body style="margin:0;padding:28px 14px;background:#fff8fa;font-family:Arial,sans-serif;color:#492633">'
    + '<main style="max-width:560px;margin:0 auto;padding:30px 22px;background:#ffffff;border:1px solid #f2dce3;border-radius:18px;text-align:center">'
    + '<p style="margin:0 0 8px;color:#a6405d;font-size:12px;letter-spacing:2px;text-transform:uppercase">Kylie\'s 18th Birthday Debut</p>'
    + '<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:28px;font-weight:normal">Your invitation is ready</h1>'
    + '<p style="font-size:16px;line-height:1.6">Hello ' + safeName + ', your RSVP is confirmed. Keep your personal QR code ready for the celebration.</p>'
    + '<div style="margin:22px auto;padding:16px;background:#fff8fa;border:1px solid #f2dce3;border-radius:14px;text-align:left;line-height:1.8">'
    + '<strong>Saturday, November 7, 2026</strong><br>Doors open at 4:00 PM<br>Celebration starts at 4:30 PM<br>Tito\'s Restaurant<br>546 Concha St., Tondo, Manila</div>'
    + '<p style="font-size:14px;line-height:1.6">Please have your personal QR code ready when you arrive for check-in.</p>'
    + '<img src="cid:guest-qr" width="240" height="240" alt="Your personal check-in QR code with Kylie’s K seal" style="display:block;width:240px;height:240px;max-width:100%;margin:18px auto;border:1px solid #f2dce3;border-radius:12px">'
    + '<p style="font-size:12px;line-height:1.6;color:#704b58">The same QR code is attached so you can save it to your device. Keep this email private; the QR code opens your personalized invitation.</p>'
    + '<p style="margin:22px 0 0;font-size:14px">We look forward to celebrating with you!</p>'
    + '</main></body></html>';

  MailApp.sendEmail({
    to: guest.email,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    inlineImages: { 'guest-qr': qrInlineImage },
    attachments: [qrAttachment],
    name: SENDER_DISPLAY_NAME
  });
}

/** Build a compact high-correction QR locally so invitation IDs never go to a QR service. */
function createInvitationQrPngBase64_(value) {
  const text = String(value || '');
  if (!text || text.length > 119 || /[^\x00-\x7F]/.test(text)) {
    throw new Error('invitation_qr_payload_invalid');
  }
  const modules = buildInvitationQrMatrix_(text);
  const pngBytes = encodeInvitationQrPng_(modules);
  const signedBytes = pngBytes.map(function(byte) { return byte > 127 ? byte - 256 : byte; });
  return Utilities.base64Encode(Utilities.newBlob(signedBytes, 'image/png', 'invitation-qr.png').getBytes());
}

function buildInvitationQrMatrix_(text) {
  const profiles = [
    null,
    { blocks: [[1, 26, 9]], alignment: [] },
    { blocks: [[1, 44, 16]], alignment: [6, 18] },
    { blocks: [[2, 35, 13]], alignment: [6, 22] },
    { blocks: [[4, 25, 9]], alignment: [6, 26] },
    { blocks: [[2, 33, 11], [2, 34, 12]], alignment: [6, 30] },
    { blocks: [[4, 43, 15]], alignment: [6, 34] },
    { blocks: [[4, 39, 13], [1, 40, 14]], alignment: [6, 22, 38] },
    { blocks: [[4, 40, 14], [2, 41, 15]], alignment: [6, 24, 42] },
    { blocks: [[4, 36, 12], [4, 37, 13]], alignment: [6, 26, 46] },
    { blocks: [[6, 43, 15], [2, 44, 16]], alignment: [6, 28, 50] }
  ];
  const versionForCountBits = function(version) { return version < 10 ? 8 : 16; };
  let version = 0;
  let profile = null;
  for (let candidate = 1; candidate < profiles.length; candidate += 1) {
    const dataCapacity = profiles[candidate].blocks.reduce(function(total, block) {
      return total + block[0] * block[2];
    }, 0);
    const requiredBits = 4 + versionForCountBits(candidate) + text.length * 8;
    if (requiredBits <= dataCapacity * 8) {
      version = candidate;
      profile = profiles[candidate];
      break;
    }
  }
  if (!profile) throw new Error('invitation_qr_payload_too_long');
  const size = version * 4 + 17;
  const dataCapacity = profile.blocks.reduce(function(total, block) { return total + block[0] * block[2]; }, 0);
  const matrix = new Array(size);
  for (let row = 0; row < size; row += 1) matrix[row] = new Array(size).fill(null);

  setupInvitationQrFinder_(matrix, 0, 0);
  setupInvitationQrFinder_(matrix, size - 7, 0);
  setupInvitationQrFinder_(matrix, 0, size - 7);
  profile.alignment.forEach(function(row) {
    profile.alignment.forEach(function(col) {
      if (matrix[row][col] !== null) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          matrix[row + dy][col + dx] = Math.max(Math.abs(dx), Math.abs(dy)) === 2 || (dx === 0 && dy === 0);
        }
      }
    });
  });
  for (let index = 8; index < size - 8; index += 1) {
    if (matrix[index][6] === null) matrix[index][6] = index % 2 === 0;
    if (matrix[6][index] === null) matrix[6][index] = index % 2 === 0;
  }
  setupInvitationQrFormat_(matrix, 0, true);
  if (version >= 7) setupInvitationQrVersion_(matrix, version, false);

  const codewords = makeInvitationQrCodewords_(
    text,
    dataCapacity,
    profile.blocks,
    versionForCountBits(version)
  );
  const base = matrix.map(function(row) { return row.slice(); });
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = base.map(function(row) { return row.slice(); });
    mapInvitationQrData_(candidate, codewords, mask);
    setupInvitationQrFormat_(candidate, mask, false);
    const penalty = scoreInvitationQrMatrix_(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
  }
  const result = base.map(function(row) { return row.slice(); });
  mapInvitationQrData_(result, codewords, bestMask);
  setupInvitationQrFormat_(result, bestMask, false);
  return result;
}

function setupInvitationQrFinder_(matrix, row, col) {
  const size = matrix.length;
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const y = row + dy;
      const x = col + dx;
      if (y < 0 || y >= size || x < 0 || x >= size) continue;
      matrix[y][x] = dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6
        && (dy === 0 || dy === 6 || dx === 0 || dx === 6 || (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4));
    }
  }
}

function setupInvitationQrFormat_(matrix, mask, test) {
  const size = matrix.length;
  const data = (2 << 3) | mask;
  const bits = ((data << 10) | bchInvitationQrRemainder_(data << 10, 0x537)) ^ 0x5412;
  for (let index = 0; index < 15; index += 1) {
    const value = !test && ((bits >>> index) & 1) === 1;
    if (index < 6) matrix[index][8] = value;
    else if (index < 8) matrix[index + 1][8] = value;
    else matrix[size - 15 + index][8] = value;
    if (index < 8) matrix[8][size - index - 1] = value;
    else if (index < 9) matrix[8][15 - index] = value;
    else matrix[8][15 - index - 1] = value;
  }
  matrix[size - 8][8] = !test;
}

function setupInvitationQrVersion_(matrix, version, test) {
  const bits = (version << 12) | bchInvitationQrRemainder_(version << 12, 0x1f25);
  const size = matrix.length;
  for (let index = 0; index < 18; index += 1) {
    const value = !test && ((bits >>> index) & 1) === 1;
    matrix[Math.floor(index / 3)][index % 3 + size - 11] = value;
    matrix[index % 3 + size - 11][Math.floor(index / 3)] = value;
  }
}

function bchInvitationQrRemainder_(value, polynomial) {
  let remainder = value;
  const digit = function(number) {
    let count = 0;
    while (number) { count += 1; number >>>= 1; }
    return count;
  };
  while (digit(remainder) >= digit(polynomial)) {
    remainder ^= polynomial << (digit(remainder) - digit(polynomial));
  }
  return remainder;
}

function makeInvitationQrCodewords_(text, capacity, blockSpecs, characterCountBits) {
  const bits = [];
  const put = function(value, length) {
    for (let shift = length - 1; shift >= 0; shift -= 1) bits.push((value >>> shift) & 1);
  };
  put(4, 4);
  put(text.length, characterCountBits);
  for (let index = 0; index < text.length; index += 1) put(text.charCodeAt(index), 8);
  const capacityBits = capacity * 8;
  for (let count = Math.min(4, capacityBits - bits.length); count > 0; count -= 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | bits[index + bit];
    data.push(value);
  }
  for (let pad = 0xec; data.length < capacity; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);
  const blocks = [];
  let offset = 0;
  blockSpecs.forEach(function(spec) {
    const countInGroup = spec[0];
    const totalCount = spec[1];
    const dataCount = spec[2];
    for (let count = 0; count < countInGroup; count += 1) {
      const block = data.slice(offset, offset + dataCount);
      offset += dataCount;
      blocks.push({
        data: block,
        error: makeInvitationQrErrorCorrection_(block, totalCount - dataCount)
      });
    }
  });
  const interleaved = [];
  const maxDataCount = Math.max.apply(null, blocks.map(function(block) { return block.data.length; }));
  const maxErrorCount = Math.max.apply(null, blocks.map(function(block) { return block.error.length; }));
  for (let index = 0; index < maxDataCount; index += 1) {
    blocks.forEach(function(block) { if (index < block.data.length) interleaved.push(block.data[index]); });
  }
  for (let index = 0; index < maxErrorCount; index += 1) {
    blocks.forEach(function(block) { if (index < block.error.length) interleaved.push(block.error[index]); });
  }
  return interleaved;
}

function makeInvitationQrErrorCorrection_(data, degree) {
  const exp = new Array(512);
  const log = new Array(256);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < exp.length; index += 1) exp[index] = exp[index - 255];
  const multiply = function(left, right) { return left === 0 || right === 0 ? 0 : exp[log[left] + log[right]]; };
  let generator = [1];
  for (let root = 0; root < degree; root += 1) {
    const next = new Array(generator.length + 1).fill(0);
    for (let index = 0; index < generator.length; index += 1) {
      next[index] ^= generator[index];
      next[index + 1] ^= multiply(generator[index], exp[root]);
    }
    generator = next;
  }
  const remainder = data.concat(new Array(degree).fill(0));
  for (let index = 0; index < data.length; index += 1) {
    const factor = remainder[index];
    if (!factor) continue;
    for (let offset = 0; offset < generator.length; offset += 1) {
      remainder[index + offset] ^= multiply(generator[offset], factor);
    }
  }
  return remainder.slice(data.length);
}

function mapInvitationQrData_(matrix, codewords, mask) {
  const size = matrix.length;
  const isMasked = function(row, col) {
    const product = row * col;
    switch (mask) {
      case 0: return (row + col) % 2 === 0;
      case 1: return row % 2 === 0;
      case 2: return col % 3 === 0;
      case 3: return (row + col) % 3 === 0;
      case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
      case 5: return product % 2 + product % 3 === 0;
      case 6: return (product % 2 + product % 3) % 2 === 0;
      default: return ((row + col) % 2 + product % 3) % 2 === 0;
    }
  };
  let direction = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const currentCol = col - offset;
        if (matrix[row][currentCol] !== null) continue;
        const value = byteIndex < codewords.length && ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        matrix[row][currentCol] = value !== isMasked(row, currentCol);
        bitIndex -= 1;
        if (bitIndex < 0) { byteIndex += 1; bitIndex = 7; }
      }
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
}

function scoreInvitationQrMatrix_(matrix) {
  const size = matrix.length;
  let penalty = 0;
  const scoreLine = function(line) {
    let score = 0;
    let runColor = line[0];
    let runLength = 1;
    for (let index = 1; index < line.length; index += 1) {
      if (line[index] === runColor) runLength += 1;
      else {
        if (runLength >= 5) score += 3 + runLength - 5;
        runColor = line[index];
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + runLength - 5;
    for (let index = 0; index <= line.length - 7; index += 1) {
      if (line[index] && !line[index + 1] && line[index + 2] && line[index + 3] && line[index + 4]
        && !line[index + 5] && line[index + 6]) {
        const before = index >= 4 && line[index - 1] === false && line[index - 2] === false
          && line[index - 3] === false && line[index - 4] === false;
        const after = index + 10 < line.length && line[index + 7] === false && line[index + 8] === false
          && line[index + 9] === false && line[index + 10] === false;
        if (before || after) score += 40;
      }
    }
    return score;
  };
  let darkCount = 0;
  for (let row = 0; row < size; row += 1) {
    const rowValues = matrix[row];
    const colValues = new Array(size);
    for (let col = 0; col < size; col += 1) {
      colValues[col] = matrix[col][row];
      if (rowValues[col]) darkCount += 1;
      if (row < size - 1 && col < size - 1
        && rowValues[col] === rowValues[col + 1]
        && rowValues[col] === matrix[row + 1][col]
        && rowValues[col] === matrix[row + 1][col + 1]) penalty += 3;
    }
    penalty += scoreLine(rowValues) + scoreLine(colValues);
  }
  penalty += Math.floor(Math.abs((darkCount * 100 / (size * size)) - 50) / 5) * 10;
  return penalty;
}

function encodeInvitationQrPng_(matrix) {
  const moduleCount = matrix.length;
  const scale = 4;
  const quietModules = 4;
  const size = (moduleCount + quietModules * 2) * scale;
  const pixels = new Array(size * size).fill(255);
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!matrix[row][col]) continue;
      const left = (col + quietModules) * scale;
      const top = (row + quietModules) * scale;
      for (let y = top; y < top + scale; y += 1) {
        for (let x = left; x < left + scale; x += 1) pixels[y * size + x] = 0;
      }
    }
  }

  const center = Math.floor(size / 2);
  const radius = 8;
  for (let y = center - radius - 1; y <= center + radius + 1; y += 1) {
    for (let x = center - radius - 1; x <= center + radius + 1; x += 1) {
      const distance = (x - center) * (x - center) + (y - center) * (y - center);
      if (distance <= radius * radius) pixels[y * size + x] = 255;
      else if (distance <= (radius + 1) * (radius + 1)) pixels[y * size + x] = 172;
    }
  }
  drawInvitationQrLogoLine_(pixels, size, center - 3, center - 6, center - 3, center + 6, 85);
  drawInvitationQrLogoLine_(pixels, size, center - 5, center - 6, center - 1, center - 6, 85);
  drawInvitationQrLogoLine_(pixels, size, center - 5, center + 6, center - 1, center + 6, 85);
  drawInvitationQrLogoLine_(pixels, size, center - 2, center - 1, center + 5, center - 6, 85);
  drawInvitationQrLogoLine_(pixels, size, center - 2, center + 1, center + 5, center + 6, 85);

  const raw = [];
  for (let row = 0; row < size; row += 1) {
    raw.push(0);
    const offset = row * size;
    for (let col = 0; col < size; col += 1) raw.push(pixels[offset + col]);
  }
  const compressed = deflateInvitationQrPng_(raw);
  const header = [
    size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255,
    size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255,
    8, 0, 0, 0, 0
  ];
  const png = [137, 80, 78, 71, 13, 10, 26, 10]
    .concat(invitationQrPngChunk_('IHDR', header))
    .concat(invitationQrPngChunk_('IDAT', compressed))
    .concat(invitationQrPngChunk_('IEND', []));
  return png;
}

function drawInvitationQrLogoLine_(pixels, size, x1, y1, x2, y2, color) {
  let dx = Math.abs(x2 - x1);
  let sx = x1 < x2 ? 1 : -1;
  let dy = -Math.abs(y2 - y1);
  let sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const x = x1 + ox;
        const y = y1 + oy;
        if (x >= 0 && x < size && y >= 0 && y < size) pixels[y * size + x] = color;
      }
    }
    if (x1 === x2 && y1 === y2) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x1 += sx; }
    if (twice <= dx) { error += dx; y1 += sy; }
  }
}

function deflateInvitationQrPng_(raw) {
  const result = [0x78, 0x01];
  for (let offset = 0; offset < raw.length;) {
    const length = Math.min(65535, raw.length - offset);
    const final = offset + length === raw.length;
    result.push(final ? 1 : 0, length & 255, (length >>> 8) & 255, (~length) & 255, ((~length) >>> 8) & 255);
    for (let index = 0; index < length; index += 1) result.push(raw[offset + index]);
    offset += length;
  }
  let a = 1;
  let b = 0;
  raw.forEach(function(byte) { a = (a + byte) % 65521; b = (b + a) % 65521; });
  const adler = ((b << 16) | a) >>> 0;
  result.push((adler >>> 24) & 255, (adler >>> 16) & 255, (adler >>> 8) & 255, adler & 255);
  return result;
}

function invitationQrPngChunk_(type, data) {
  const typeBytes = type.split('').map(function(character) { return character.charCodeAt(0); });
  const checksum = invitationQrCrc32_(typeBytes.concat(data));
  const length = data.length;
  return [
    (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255
  ].concat(typeBytes, data, [
    (checksum >>> 24) & 255, (checksum >>> 16) & 255, (checksum >>> 8) & 255, checksum & 255
  ]);
}

function invitationQrCrc32_(bytes) {
  let crc = 0xffffffff;
  bytes.forEach(function(byte) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function sendEventReminders_(qrCodes, actorUid) {
  if (!Array.isArray(qrCodes) || qrCodes.length > MAX_EVENT_REMINDER_RECIPIENTS) {
    return { accepted: false, status: 'invalid_request', total: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const qrByGuestId = Object.create(null);
  for (let index = 0; index < qrCodes.length; index += 1) {
    const qr = qrCodes[index];
    if (!qr || typeof qr.guestId !== 'string'
      || !/^[A-Za-z0-9_-]{10,128}$/.test(qr.guestId)
      || typeof qr.qrUrl !== 'string'
      || typeof qr.qrPngBase64 !== 'string'
      || qr.qrPngBase64.length > 160000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(qr.qrPngBase64)
      || Object.prototype.hasOwnProperty.call(qrByGuestId, qr.guestId)
      || !isExpectedReminderQrUrl_(qr.qrUrl, qr.guestId)
      || !isPngImage_(qr.qrPngBase64)) {
      return { accepted: false, status: 'invalid_request', total: 0, sent: 0, skipped: 0, failed: 0 };
    }
    qrByGuestId[qr.guestId] = {
      qrUrl: qr.qrUrl,
      qrPngBase64: qr.qrPngBase64
    };
  }

  const rsvpDocuments = firestoreQueryConfirmedRsvps_();
  if (rsvpDocuments.length > MAX_EVENT_REMINDER_RECIPIENTS) {
    return { accepted: false, status: 'too_many_recipients', total: rsvpDocuments.length, sent: 0, skipped: 0, failed: 0 };
  }

  const guests = [];
  const seenEmails = Object.create(null);
  let invalidRecords = 0;
  rsvpDocuments.forEach(function(document) {
    const guestId = String(document && document.name || '').split('/').pop();
    const guest = getConfirmedGuestByIdForHost_(guestId);
    if (!guest) {
      invalidRecords += 1;
      return;
    }
    const emailKey = normalizeEmail_(guest.email);
    if (seenEmails[emailKey]) {
      invalidRecords += 1;
      return;
    }
    seenEmails[emailKey] = true;
    guests.push(guest);
  });

  if (guests.length === 0) {
    return { accepted: true, status: 'no_recipients', total: 0, sent: 0, skipped: invalidRecords, failed: 0 };
  }

  for (let index = 0; index < guests.length; index += 1) {
    const guest = guests[index];
    const qr = qrByGuestId[guest.id];
    if (!qr || !isExpectedReminderQrUrl_(qr.qrUrl, guest.id)) {
      return { accepted: false, status: 'qr_unavailable', total: guests.length, sent: 0, skipped: invalidRecords, failed: 0 };
    }
  }

  const recipientsNotAlreadyReminded = guests.filter(function(guest) {
    return !hasEventReminderBeenSent_(guest.email);
  });
  const availableQuota = getRemainingMailerQuota_();
  if (recipientsNotAlreadyReminded.length > availableQuota) {
    return {
      accepted: false,
      status: 'daily_limit',
      total: guests.length,
      sent: 0,
      skipped: invalidRecords + guests.length - recipientsNotAlreadyReminded.length,
      failed: 0
    };
  }

  const summary = {
    accepted: true,
    status: 'sent',
    total: guests.length,
    sent: 0,
    skipped: invalidRecords,
    failed: 0
  };
  guests.forEach(function(guest) {
    const reservation = reserveSend_('event_reminder', guest.id, guest.email, actorUid);
    if (!reservation.allowed) {
      summary.skipped += 1;
      return;
    }
    try {
      sendEventReminderEmail_(guest, qrByGuestId[guest.id].qrPngBase64);
      finalizeSend_(reservation, guest.email, actorUid);
      summary.sent += 1;
    } catch (error) {
      releaseSend_(reservation);
      summary.failed += 1;
      console.error('Event reminder email failed for a confirmed RSVP.', String(error && error.message || error));
    }
  });
  if (summary.failed > 0) summary.status = summary.sent > 0 ? 'partial' : 'failed';
  return summary;
}

function buildExpectedClientInvitationUrl_(guestId) {
  const baseUrl = ensureTrailingSlash_(getInvitationBaseUrl_());
  return baseUrl + 'index.html?invite=' + encodeURIComponent(guestId);
}

function isExpectedReminderQrUrl_(qrUrl, guestId) {
  if (typeof qrUrl !== 'string') return false;
  return qrUrl === buildInvitationUrl_(guestId)
    || qrUrl === buildExpectedClientInvitationUrl_(guestId);
}

function isPngImage_(base64) {
  try {
    const bytes = Utilities.base64Decode(base64);
    return bytes.length >= 8
      && (bytes[0] & 255) === 137
      && (bytes[1] & 255) === 80
      && (bytes[2] & 255) === 78
      && (bytes[3] & 255) === 71
      && (bytes[4] & 255) === 13
      && (bytes[5] & 255) === 10
      && (bytes[6] & 255) === 26
      && (bytes[7] & 255) === 10;
  } catch (error) {
    return false;
  }
}

function getRemainingMailerQuota_() {
  const now = Date.now();
  const windowState = readJsonProperty_(PropertiesService.getScriptProperties(), 'send:rolling_window') || {};
  const windowStart = Number(windowState.startedAt || 0);
  const windowCount = windowStart && now - windowStart < 24 * 60 * 60 * 1000
    ? Number(windowState.count || 0)
    : 0;
  return Math.max(0, Math.min(
    MAX_RECIPIENTS_PER_24_HOURS - windowCount,
    MailApp.getRemainingDailyQuota()
  ));
}

function hasEventReminderBeenSent_(email) {
  const key = getEventReminderKey_(email);
  const state = readJsonProperty_(PropertiesService.getScriptProperties(), key);
  return Boolean(state && state.status === 'sent');
}

function getEventReminderKey_(email) {
  const sendDate = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyyMMdd');
  return 'send:event_reminder:' + EVENT_REMINDER_CAMPAIGN_ID + ':' + sendDate + ':'
    + sha256Hex_(normalizeEmail_(email));
}

function sendEventReminderEmail_(guest, qrPngBase64) {
  const safeName = escapeHtml_(guest.name);
  const qrBytes = Utilities.base64Decode(qrPngBase64);
  const qrBlob = Utilities.newBlob(
    qrBytes,
    'image/png',
    'Kylie-18th-QR-' + guest.id + '.png'
  );
  const qrAttachment = Utilities.newBlob(
    qrBytes,
    'image/png',
    'Kylie-18th-QR-' + guest.id + '.png'
  );
  const subject = "Reminder: Kylie's 18th Birthday Debut";
  const body = [
    'Hello ' + guest.name + ',',
    '',
    "We are looking forward to celebrating with you at Kylie's 18th Birthday Debut.",
    'Date: Saturday, November 7, 2026',
    'Doors open: 4:00 PM',
    'Celebration starts: 4:30 PM',
    "Venue: Tito's Restaurant, 546 Concha St., Tondo, Manila",
    '',
    'Please have your personal QR code ready when you arrive for check-in. The QR code is attached and shown below.',
    '',
    'We look forward to celebrating with you!'
  ].join('\n');
  const htmlBody = '<!doctype html><html lang="en"><body style="margin:0;padding:28px 14px;background:#fff8fa;font-family:Arial,sans-serif;color:#492633">'
    + '<main style="max-width:560px;margin:0 auto;padding:30px 22px;background:#ffffff;border:1px solid #f2dce3;border-radius:18px;text-align:center">'
    + '<p style="margin:0 0 8px;color:#a6405d;font-size:12px;letter-spacing:2px;text-transform:uppercase">Kylie\'s 18th Birthday Debut</p>'
    + '<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:28px;font-weight:normal">A little reminder</h1>'
    + '<p style="font-size:16px;line-height:1.6">Hello ' + safeName + ', we are looking forward to celebrating with you.</p>'
    + '<div style="margin:22px auto;padding:16px;background:#fff8fa;border:1px solid #f2dce3;border-radius:14px;text-align:left;line-height:1.8">'
    + '<strong>Saturday, November 7, 2026</strong><br>Doors open at 4:00 PM<br>Celebration starts at 4:30 PM<br>Tito\'s Restaurant<br>546 Concha St., Tondo, Manila</div>'
    + '<p style="font-size:14px;line-height:1.6">Please have your personal QR code ready when you arrive for check-in.</p>'
    + '<img src="cid:guest-qr" width="240" height="240" alt="Your personal check-in QR code" style="display:block;width:240px;height:240px;max-width:100%;margin:18px auto;border:1px solid #f2dce3;border-radius:12px">'
    + '<p style="font-size:12px;line-height:1.6;color:#704b58">The same QR code is attached so you can save it to your device.</p>'
    + '<p style="margin:22px 0 0;font-size:14px">We look forward to celebrating with you!</p>'
    + '</main></body></html>';
  MailApp.sendEmail({
    to: guest.email,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    inlineImages: { 'guest-qr': qrBlob },
    attachments: [qrAttachment],
    name: SENDER_DISPLAY_NAME
  });
}

function buildInvitationUrl_(guestId) {
  return ensureTrailingSlash_(getInvitationBaseUrl_()) + '?invite=' + encodeURIComponent(guestId);
}

function buildQrViewerUrl_(guestId) {
  return ensureTrailingSlash_(getInvitationBaseUrl_()) + 'qr.html?invite=' + encodeURIComponent(guestId);
}

function getInvitationBaseUrl_() {
  const configured = PropertiesService.getScriptProperties().getProperty('INVITATION_BASE_URL');
  if (!configured) throw new Error('missing_invitation_base_url');
  const baseUrl = configured.trim();
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/.test(baseUrl)
    || baseUrl.indexOf('?') !== -1
    || baseUrl.indexOf('#') !== -1) {
    throw new Error('invalid_invitation_base_url');
  }
  return baseUrl;
}

function ensureTrailingSlash_(value) {
  const withoutTrailingSlashes = value.replace(/\/+$/, '');
  return withoutTrailingSlashes + '/';
}

function reserveSend_(kind, guestId, email, actorUid) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const now = Date.now();
    const nonce = Utilities.getUuid();
    const confirmationKey = kind === 'confirmation' ? 'send:confirmation:' + guestId : '';
    const targetKey = 'send:target:' + sha256Hex_(email);
    const actorKey = actorUid === FIREBASE_HOST_UID ? '' : 'send:actor:' + sha256Hex_(actorUid);
    const reminderKey = kind === 'event_reminder'
      ? getEventReminderKey_(email)
      : '';

    if (confirmationKey) {
      const previous = readJsonProperty_(properties, confirmationKey);
      if (previous && previous.status === 'sent') return { allowed: false, status: 'already_sent' };
      if (previous && previous.status === 'processing'
        && now - Number(previous.at || now) < PROCESSING_TIMEOUT_MS) {
        return { allowed: false, status: 'already_processing' };
      }
      if (previous && previous.status === 'processing') properties.deleteProperty(confirmationKey);
    }

    if (reminderKey) {
      const previousReminder = readJsonProperty_(properties, reminderKey);
      if (previousReminder && previousReminder.status === 'sent') {
        return { allowed: false, status: 'already_sent' };
      }
      if (previousReminder && previousReminder.status === 'processing'
        && now - Number(previousReminder.at || now) < PROCESSING_TIMEOUT_MS) {
        return { allowed: false, status: 'already_processing' };
      }
      if (previousReminder && previousReminder.status === 'processing') properties.deleteProperty(reminderKey);
    }

    let targetState = readJsonProperty_(properties, targetKey);
    if (targetState && targetState.status === 'processing'
      && now - Number(targetState.at || now) >= PROCESSING_TIMEOUT_MS) {
      properties.deleteProperty(targetKey);
      targetState = null;
    }
    if (targetState && targetState.status === 'processing') return { allowed: false, status: 'cooldown' };
    if (kind !== 'event_reminder' && targetState && targetState.status === 'sent'
      && now - Number(targetState.at || 0) < RESEND_COOLDOWN_MS) {
      return { allowed: false, status: 'cooldown' };
    }

    if (actorKey) {
      let actorState = readJsonProperty_(properties, actorKey);
      if (actorState && actorState.status === 'processing'
        && now - Number(actorState.at || now) >= PROCESSING_TIMEOUT_MS) {
        properties.deleteProperty(actorKey);
        actorState = null;
      }
      if (actorState && actorState.status === 'processing') return { allowed: false, status: 'cooldown' };
      if (actorState && actorState.status === 'sent'
        && now - Number(actorState.at || 0) < CALLER_COOLDOWN_MS) {
        return { allowed: false, status: 'cooldown' };
      }
    }

    const windowState = readJsonProperty_(properties, 'send:rolling_window') || {};
    let windowStart = Number(windowState.startedAt || 0);
    let windowCount = Number(windowState.count || 0);
    if (!windowStart || now - windowStart >= 24 * 60 * 60 * 1000) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount >= MAX_RECIPIENTS_PER_24_HOURS || MailApp.getRemainingDailyQuota() < 1) {
      return { allowed: false, status: 'daily_limit' };
    }

    const reservation = {
      allowed: true,
      nonce: nonce,
      kind: kind,
      confirmationKey: confirmationKey,
      targetKey: targetKey,
      actorKey: actorKey,
      reminderKey: reminderKey,
      windowStartedAt: windowStart
    };
    const processing = JSON.stringify({ status: 'processing', nonce: nonce, at: now });
    if (confirmationKey) properties.setProperty(confirmationKey, processing);
    properties.setProperty(targetKey, processing);
    if (actorKey) properties.setProperty(actorKey, processing);
    if (reminderKey) properties.setProperty(reminderKey, processing);
    properties.setProperty('send:rolling_window', JSON.stringify({
      startedAt: windowStart,
      count: windowCount + 1
    }));
    return reservation;
  } finally {
    lock.releaseLock();
  }
}

function finalizeSend_(reservation, email, actorUid) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const sentState = JSON.stringify({ status: 'sent', at: Date.now() });
    if (reservation.confirmationKey) properties.setProperty(reservation.confirmationKey, sentState);
    properties.setProperty(reservation.targetKey, sentState);
    if (reservation.actorKey) properties.setProperty(reservation.actorKey, sentState);
    if (reservation.reminderKey) properties.setProperty(reservation.reminderKey, sentState);
  } finally {
    lock.releaseLock();
  }
}

function releaseSend_(reservation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const keys = [reservation.confirmationKey, reservation.targetKey, reservation.actorKey, reservation.reminderKey].filter(Boolean);
    keys.forEach(function(key) {
      const value = readJsonProperty_(properties, key);
      if (value && value.status === 'processing' && value.nonce === reservation.nonce) {
        properties.deleteProperty(key);
      }
    });

    const windowState = readJsonProperty_(properties, 'send:rolling_window');
    if (windowState && Number(windowState.startedAt) === reservation.windowStartedAt) {
      const count = Math.max(0, Number(windowState.count || 0) - 1);
      if (count === 0) properties.deleteProperty('send:rolling_window');
      else properties.setProperty('send:rolling_window', JSON.stringify({
        startedAt: reservation.windowStartedAt,
        count: count
      }));
    }
  } finally {
    lock.releaseLock();
  }
}

function readJsonProperty_(properties, key) {
  const value = properties.getProperty(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function enforceLookupCooldown_(actorUid) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const key = 'lookup:actor:' + sha256Hex_(actorUid);
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) throw new Error('try_later');
    cache.put(key, '1', Math.ceil(CALLER_COOLDOWN_MS / 1000));
  } finally {
    lock.releaseLock();
  }
}

function sha256Hex_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function normalizeEmail_(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail_(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeName_(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function emailClaimDocumentId_(email) {
  return email.replace(/%/g, '%25').replace(/\//g, '%2F');
}

function escapeHtml_(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character];
  });
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
