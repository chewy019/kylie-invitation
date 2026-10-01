const FIREBASE_PROJECT_ID = 'kylie-18th-rsvp';
const FIREBASE_WEB_API_KEY = 'AIzaSyCK96DUaagUyDjs3lFW4-q29RvgpVCrMBU';
const FIREBASE_HOST_UID = 'myL41BfZY2RXwIxMFU6ybtCHKNE2';
const SENDER_DISPLAY_NAME = "Kylie's 18th Birthday Debut";
const MAX_RECIPIENTS_PER_24_HOURS = 80;
const RESEND_COOLDOWN_MS = 15 * 60 * 1000;
const CALLER_COOLDOWN_MS = 60 * 1000;
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const REQUEST_RESULT_PREFIX = 'request:result:';
const REQUEST_RESULT_TTL_MS = 60 * 60 * 1000;

/**
 * Public Apps Script endpoint. It only accepts Firebase ID tokens, validates
 * them with Firebase Auth, and sends mail after checking the private RSVP,
 * invitation, and email-claim documents in Firestore.
 */
function doPost(event) {
  let requestId = '';
  let result = { accepted: false, status: 'failed' };
  try {
    const rawPayload = event && event.parameter && event.parameter.payload;
    if (typeof rawPayload !== 'string' || rawPayload.length > 10000) {
      throw new Error('invalid_request');
    }

    const payload = JSON.parse(rawPayload);
    if (isValidRequestId_(payload.requestId)) requestId = payload.requestId;
    const identity = verifyFirebaseIdToken_(payload.idToken);
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
  } catch (error) {
    console.error('Invitation email request rejected or failed:', String(error && error.message || error));
    const errorCode = String(error && error.message || error);
    if (errorCode === 'not_found' || errorCode === 'permission_denied') {
      result = { accepted: false, status: 'not_found' };
    } else if (errorCode === 'lookup_cooldown') {
      result = { accepted: false, status: 'cooldown' };
    }
  }

  if (requestId) storeRequestResult_(requestId, result.status);
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
  const status = saved && Date.now() - Number(saved.at || 0) <= REQUEST_RESULT_TTL_MS
    ? saved.status
    : 'pending';
  return jsonpMailerResult_('__kylieMailer_' + requestId.replace(/-/g, ''), status);
}

function isValidRequestId_(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function jsonpMailerResult_(callbackName, status) {
  const safeStatuses = ['sent', 'cooldown', 'daily_limit', 'not_found', 'already_sent', 'pending', 'failed'];
  const safeStatus = safeStatuses.indexOf(status) === -1 ? 'failed' : status;
  return ContentService.createTextOutput(callbackName + '(' + JSON.stringify({ status: safeStatus }) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function storeRequestResult_(requestId, status) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const now = Date.now();
    properties.setProperty(REQUEST_RESULT_PREFIX + requestId, JSON.stringify({ status: status, at: now }));
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
  const invitationUrl = buildInvitationUrl_(guest.id);
  const qrViewerUrl = buildQrViewerUrl_(guest.id);
  const safeName = escapeHtml_(guest.name);
  const safeInvitationUrl = escapeHtml_(invitationUrl);
  const safeQrViewerUrl = escapeHtml_(qrViewerUrl);

  const subject = "Kylie's Debut Invitation and QR Code";
  const body = [
    'Hello ' + guest.name + ',',
    '',
    "Your RSVP to Kylie's 18th Birthday Debut is confirmed.",
    '',
    'Open your personal invitation:',
    invitationUrl,
    '',
    'Open or save your personal QR code:',
    qrViewerUrl,
    '',
    'Keep these personal links private. Anyone with them can open your invitation.',
    '',
    'We look forward to celebrating with you!'
  ].join('\n');

  const htmlBody = '<!doctype html><html lang="en"><body style="margin:0;padding:28px 14px;background:#fff8fa;font-family:Arial,sans-serif;color:#492633">'
    + '<main style="max-width:560px;margin:0 auto;padding:30px 22px;background:#ffffff;border:1px solid #f2dce3;border-radius:18px;text-align:center">'
    + '<p style="margin:0 0 8px;color:#a6405d;font-size:12px;letter-spacing:2px;text-transform:uppercase">Kylie\'s 18th Birthday Debut</p>'
    + '<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:28px;font-weight:normal">Your invitation is ready</h1>'
    + '<p style="font-size:16px;line-height:1.6">Hello ' + safeName + ', your RSVP is confirmed. Keep your invitation link and QR code ready for the celebration.</p>'
    + '<p style="margin:22px 0 12px"><a href="' + safeInvitationUrl + '" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#8d2947;color:#fff;text-decoration:none;font-weight:bold">Open My Invitation</a></p>'
    + '<p style="margin:12px 0 22px"><a href="' + safeQrViewerUrl + '" style="display:inline-block;padding:12px 20px;border:1px solid #d7a9b7;border-radius:999px;color:#8d2947;text-decoration:none;font-weight:bold">View or Save My QR Code</a></p>'
    + '<p style="font-size:12px;line-height:1.6;color:#704b58">Your QR code opens on a private page where you can save it as an image. Anyone with these personal links can open your invitation, so keep them safe.</p>'
    + '<p style="margin:22px 0 0;font-size:14px">We look forward to celebrating with you!</p>'
    + '</main></body></html>';

  MailApp.sendEmail({
    to: guest.email,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
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

    if (confirmationKey) {
      const previous = readJsonProperty_(properties, confirmationKey);
      if (previous && previous.status === 'sent') return { allowed: false, status: 'already_sent' };
      if (previous && previous.status === 'processing'
        && now - Number(previous.at || now) < PROCESSING_TIMEOUT_MS) {
        return { allowed: false, status: 'already_processing' };
      }
      if (previous && previous.status === 'processing') properties.deleteProperty(confirmationKey);
    }

    let targetState = readJsonProperty_(properties, targetKey);
    if (targetState && targetState.status === 'processing'
      && now - Number(targetState.at || now) >= PROCESSING_TIMEOUT_MS) {
      properties.deleteProperty(targetKey);
      targetState = null;
    }
    if (targetState && targetState.status === 'processing') return { allowed: false, status: 'cooldown' };
    if (targetState && targetState.status === 'sent'
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
      windowStartedAt: windowStart
    };
    const processing = JSON.stringify({ status: 'processing', nonce: nonce, at: now });
    if (confirmationKey) properties.setProperty(confirmationKey, processing);
    properties.setProperty(targetKey, processing);
    if (actorKey) properties.setProperty(actorKey, processing);
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
  } finally {
    lock.releaseLock();
  }
}

function releaseSend_(reservation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const keys = [reservation.confirmationKey, reservation.targetKey, reservation.actorKey].filter(Boolean);
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
