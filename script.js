import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, setDoc, getDoc, getDocs, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        // Firebase configuration for the Kylie 18th RSVP project.
        const firebaseConfig = {
            apiKey: "AIzaSyCK96DUaagUyDjs3lFW4-q29RvgpVCrMBU",
            authDomain: "kylie-18th-rsvp.firebaseapp.com",
            projectId: "kylie-18th-rsvp",
            storageBucket: "kylie-18th-rsvp.firebasestorage.app",
            messagingSenderId: "438094249212",
            appId: "1:438094249212:web:6d5e87fc29a8baa0b0ab79",
            measurementId: "G-H8VWBJ4N03"
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        let guestDatabase = [];
        let currentGuest = null;
        let countdownInterval = null;
        let adminSnapshotUnsubscribe = null;
        let authReady = false;
        let inviteMode = false;

        const DEBUT_EVENT_CONFIG = {
            celebrant: "Kylie Aianna Fulla",
            dateStr: "November 7, 2026 16:30:00 GMT+0800",
            venue: "Tito's Restaurant, 546 Concha St., Tondo, Manila",
            dressCode: "Party dress — Light Blue or Purple"
        };

        window.addEventListener('DOMContentLoaded', async () => {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('admin') === '1') {
                const adminBtn = document.getElementById('admin-console-btn');
                if (adminBtn) adminBtn.classList.remove('hidden');
            }

            startCountdownTimer();

            try {
                await signInAnonymously(auth);
                authReady = true;
                await loadInvitationFromLink();
            } catch (err) {
                console.error("Firebase anonymous sign-in failed:", err);
                alert("The RSVP database is not ready yet. Please enable Anonymous Authentication in Firebase.");
            }

            onAuthStateChanged(auth, (user) => {
                if (!user) return;

                // Only a non-anonymous host account may read the entire RSVP collection.
                if (!user.isAnonymous) {
                    startAdminListener();
                    const drawer = document.getElementById('db-drawer');
                    if (drawer) drawer.classList.remove('translate-y-full');
                    const btn = document.getElementById('admin-console-btn');
                    if (btn) {
                        btn.classList.remove('hidden');
                        btn.innerHTML = '<i class="fa-solid fa-crown text-rosegold"></i><span class="hidden sm:inline">Guest Records</span><span id="guest-count-badge" class="bg-blush-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">0</span>';
                    }
                }
            });
        });

        async function saveGuestToCloud(guest, createInvitationLink = false) {
            if (!guest || !guest.id) throw new Error('Missing guest record.');
            if (!auth.currentUser) throw new Error('Firebase authentication is not ready.');

            const guestToSave = { ...guest, ownerUid: auth.currentUser.uid };
            const guestRef = doc(db, "rsvps", guest.id);
            await setDoc(guestRef, guestToSave, { merge: true });

            // Keep a lightweight registration record in invites. Pending/Confirmed emails
            // are locked; Declined emails are reusable. Only Confirmed records open as invitations.
            const inviteRef = doc(db, "invites", guest.id);
            await setDoc(inviteRef, {
                name: guest.name,
                nameLower: normalizeName(guest.name),
                email: guest.email,
                emailLower: normalizeEmail(guest.email),
                numGuests: guest.numGuests || 1,
                ownerUid: auth.currentUser.uid,
                rsvpStatus: guest.rsvpStatus
            }, { merge: true });

            currentGuest = guestToSave;
        }

        function startAdminListener() {
            if (adminSnapshotUnsubscribe) adminSnapshotUnsubscribe();
            const rsvpsRef = collection(db, "rsvps");
            adminSnapshotUnsubscribe = onSnapshot(rsvpsRef, (snapshot) => {
                guestDatabase = [];
                snapshot.forEach((docSnap) => {
                    guestDatabase.push({ id: docSnap.id, ...docSnap.data() });
                });
                renderDatabaseTable();
            }, (error) => {
                console.error("Private Firestore listener error:", error);
                alert("Host database could not be loaded. Check Firestore Rules and your host account.");
            });
        }

        window.handleAdminLogin = async function(e) {
            e.preventDefault();
            const email = document.getElementById('admin-email').value.trim();
            const password = document.getElementById('admin-password').value;
            const errorEl = document.getElementById('admin-login-error');
            errorEl.classList.add('hidden');

            try {
                await signInWithEmailAndPassword(auth, email, password);
                closeAdminLogin();
                startAdminListener();
                toggleDbDrawer();
            } catch (err) {
                console.error('Host login failed:', err);
                errorEl.textContent = 'Login failed. Check the email/password and make sure Email/Password Authentication is enabled in Firebase.';
                errorEl.classList.remove('hidden');
            }
        };

        window.closeAdminLogin = function() {
            const modal = document.getElementById('admin-login-modal');
            if (modal) modal.classList.add('hidden');
        };

        window.toggleDbDrawer = function() {
            const user = auth.currentUser;
            if (!user || user.isAnonymous) {
                const modal = document.getElementById('admin-login-modal');
                if (modal) modal.classList.remove('hidden');
                return;
            }

            const drawer = document.getElementById('db-drawer');
            const icon = document.getElementById('drawer-toggle-icon');
            if (drawer.classList.contains('translate-y-full')) {
                drawer.classList.remove('translate-y-full');
                if (icon) icon.className = "fa-solid fa-chevron-down";
            } else {
                drawer.classList.add('translate-y-full');
                if (icon) icon.className = "fa-solid fa-chevron-up";
            }
        };

        // Countdown Timer Logic
        function startCountdownTimer() {
            const targetTime = new Date(DEBUT_EVENT_CONFIG.dateStr).getTime();

            function updateTimer() {
                const now = new Date().getTime();
                const distance = targetTime - now;

                const daysEl = document.getElementById('count-days');
                const hoursEl = document.getElementById('count-hours');
                const minsEl = document.getElementById('count-minutes');
                const secsEl = document.getElementById('count-seconds');
                const endedMsg = document.getElementById('countdown-ended-msg');
                const countdownBox = document.getElementById('countdown-container');

                if (distance < 0) {
                    if (countdownInterval) clearInterval(countdownInterval);
                    if (countdownBox) countdownBox.classList.add('hidden');
                    if (endedMsg) endedMsg.classList.remove('hidden');
                    return;
                }

                const days = Math.floor(distance / (1000 * 60 * 60 * 24));
                const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);

                if (daysEl) daysEl.innerText = days.toString().padStart(2, '0');
                if (hoursEl) hoursEl.innerText = hours.toString().padStart(2, '0');
                if (minsEl) minsEl.innerText = minutes.toString().padStart(2, '0');
                if (secsEl) secsEl.innerText = seconds.toString().padStart(2, '0');
            }

            updateTimer();
            countdownInterval = setInterval(updateTimer, 1000);
        }

        // Navigation Steps Handler
        window.goToStep = function(stepNum) {
            // A saved invitation link is view-only.
            // It may browse Invitation <-> Event Details, but can never reopen RSVP.
            if (inviteMode && ![2, 3].includes(stepNum)) {
                stepNum = 2;
            }

            const stepMap = {
                1: 'step-registration',
                2: 'step-invitation',
                3: 'step-details',
                4: 'step-rsvp',
                5: 'step-confirmation'
            };

            Object.values(stepMap).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });

            const targetId = stepMap[stepNum];
            if (targetId) {
                document.getElementById(targetId).classList.remove('hidden');
            }

            const detailsRsvpButton = document.getElementById('details-rsvp-button');
            if (detailsRsvpButton) {
                detailsRsvpButton.classList.toggle('hidden', inviteMode);
            }

            for (let i = 1; i <= 4; i++) {
                const ind = document.getElementById(`ind-${i}`);
                if (ind) {
                    if (i === stepNum || (stepNum === 5 && i === 4)) {
                        ind.className = "px-3 py-1 rounded-full bg-blush-600 text-white font-semibold transition";
                    } else if (i < stepNum) {
                        ind.className = "px-3 py-1 rounded-full bg-blush-200 text-blush-800 font-medium transition";
                    } else {
                        ind.className = "px-3 py-1 rounded-full text-blush-400 font-normal transition";
                    }
                }
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        // Form Handlers
        // Add the final names here when the 18 Roses, 18 Candles, and 18 Gifts lists are confirmed.
        const MILESTONE_NAMES = {
            roses: [
                'Jairus', 'Lance', 'JB', 'Orly', 'Tito Rodel', 'Ninong Joven',
                'Ninong Ruel', 'Tito Amer', 'Tito Gboy', 'Tito Nhuno', 'Tito Jeff',
                'Tito Charles', 'Tito Christ', 'Tito Junjun', 'Tito Mamang', 'Tatay Roger',
                'Papa Oca', 'Daddy Randy'
            ],
            candles: [
                'Erich', 'Mikay', 'Aiyzhen', 'Cahley', 'Jinky', 'Mary', 'Elaine', 'Ashley',
                'Stefione', 'Marga', 'Louise', 'Ate Nica', 'Tita Len', 'Tita Shane',
                'Tita Clarisa', 'Nanay Lourdes', 'Mama Salve', 'Sister Ayah & Amber'
            ],
            gifts: [
                'Ninang Mara', 'Ninang Cha', 'Ninang Cindy', 'Ninang Kid', 'Ninang Racquel',
                'Ninang Em', 'Ninong Joven', 'Mama Luz', 'Mama Engga', 'Ninang Ella',
                'Tita Carmi', 'Tita Leigh Anne', 'Tito Jeff', 'Tito Charles', 'Tito Junjun',
                'Tito Mamang', 'Tito Christ', 'Cousin Harley Quinn'
            ]
        };

        const MILESTONE_INFO = {
            roses: { title: '18 Roses', subtitle: 'Grand Dance', icon: '🌹' },
            candles: { title: '18 Candles', subtitle: 'Wishes & Speeches', icon: '🕯️' },
            gifts: { title: '18 Gifts', subtitle: 'Gifts & Blessings', icon: '🎁' }
        };

        window.openMilestoneModal = function(type) {
            const info = MILESTONE_INFO[type];
            if (!info) return;
            const modal = document.getElementById('milestone-modal');
            const list = document.getElementById('milestone-name-list');
            document.getElementById('milestone-modal-icon').textContent = info.icon;
            document.getElementById('milestone-modal-title').textContent = info.title;
            document.getElementById('milestone-modal-subtitle').textContent = info.subtitle;
            const names = MILESTONE_NAMES[type] || [];
            if (names.length) {
                list.innerHTML = names.map((name, index) => `
                    <div class="flex items-center gap-3 py-2.5 border-b border-blush-100 last:border-0">
                        <span class="w-7 h-7 rounded-full bg-blush-100 text-blush-700 text-xs font-bold flex items-center justify-center">${index + 1}</span>
                        <span class="text-sm font-medium text-blush-900">${escapeHtml(name)}</span>
                    </div>`).join('');
            } else {
                list.innerHTML = '<p class="text-sm text-center text-blush-600 py-4">Names will be added here once the list is confirmed.</p>';
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        };

        window.closeMilestoneModal = function() {
            const modal = document.getElementById('milestone-modal');
            if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
        };

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.closeMilestoneModal();
        });

        function normalizeEmail(email) {
            return (email || '').trim().toLowerCase();
        }

        function normalizeName(name) {
            return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
        }

        async function findInvitationByEmail(email, confirmedOnly = false) {
            if (!auth.currentUser) throw new Error('Firebase authentication is not ready.');
            const emailLower = normalizeEmail(email);
            if (!emailLower) return null;

            const invitesRef = collection(db, 'invites');
            const snapshot = await getDocs(query(invitesRef, where('emailLower', '==', emailLower)));
            let match = null;
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const usable = confirmedOnly ? data.rsvpStatus === 'Confirmed' : ['Pending', 'Confirmed'].includes(data.rsvpStatus);
                if (!match && usable) {
                    match = { id: docSnap.id, ...data };
                }
            });
            return match;
        }

        // A declined guest may register again using the same email + same name.
        // We reuse the original invitation ID instead of creating a second record.
        async function findDeclinedInvitationByEmailAndName(email, name) {
            if (!auth.currentUser) throw new Error('Firebase authentication is not ready.');
            const emailLower = normalizeEmail(email);
            const nameLower = normalizeName(name);
            if (!emailLower || !nameLower) return null;

            const invitesRef = collection(db, 'invites');
            const snapshot = await getDocs(query(invitesRef, where('emailLower', '==', emailLower)));
            let match = null;
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (!match && data.rsvpStatus === 'Declined' && normalizeName(data.name) === nameLower) {
                    match = { id: docSnap.id, ...data };
                }
            });
            return match;
        }

        async function openInvitationForGuest(inviteId, invite, showReminder = true) {
            inviteMode = true;
            currentGuest = {
                id: inviteId,
                name: invite.name,
                email: invite.email || '',
                numGuests: invite.numGuests || 1,
                guestNames: [invite.name],
                rsvpStatus: 'Confirmed'
            };

            const eventDetailsBtn = document.getElementById('view-event-details-btn');
            if (eventDetailsBtn) eventDetailsBtn.classList.remove('hidden');
            const rsvpButton = document.getElementById('details-rsvp-button');
            if (rsvpButton) rsvpButton.classList.add('hidden');

            populateInvitationView();
            window.goToStep(2);
            if (showReminder) setTimeout(() => openSecretReminder(), 250);
        }

        window.openRecoveryModal = function(prefillEmail = '', prefillName = '') {
            const modal = document.getElementById('recovery-modal');
            if (!modal) return;
            const emailInput = document.getElementById('recovery-email');
            const nameInput = document.getElementById('recovery-name');
            const errorEl = document.getElementById('recovery-error');
            const welcome = document.getElementById('recovery-welcome');
            const form = document.getElementById('recovery-form');
            const actions = document.getElementById('recovery-actions');
            const qrWrap = document.getElementById('recovery-qr-wrap');
            if (emailInput) emailInput.value = prefillEmail;
            if (nameInput) nameInput.value = prefillName;
            errorEl.classList.add('hidden');
            welcome.classList.add('hidden');
            form.classList.remove('hidden');
            actions.classList.add('hidden');
            if (qrWrap) qrWrap.innerHTML = '';
            window.recoveredInvite = null;
            modal.classList.remove('hidden');
            document.body.classList.add('overflow-hidden');
        };

        window.closeRecoveryModal = function() {
            const modal = document.getElementById('recovery-modal');
            if (modal) modal.classList.add('hidden');
            document.body.classList.remove('overflow-hidden');
        };

        window.handleRecovery = async function(e) {
            e.preventDefault();
            const email = document.getElementById('recovery-email').value.trim();
            const name = document.getElementById('recovery-name').value.trim();
            const errorEl = document.getElementById('recovery-error');
            const form = document.getElementById('recovery-form');
            const welcome = document.getElementById('recovery-welcome');
            const actions = document.getElementById('recovery-actions');
            const welcomeName = document.getElementById('recovery-welcome-name');

            errorEl.classList.add('hidden');
            try {
                const invite = await findInvitationByEmail(email, true);
                if (!invite || normalizeName(invite.name) !== normalizeName(name)) {
                    errorEl.textContent = 'We could not find a confirmed invitation with those details.';
                    errorEl.classList.remove('hidden');
                    return;
                }
                window.recoveredInvite = { id: invite.id, data: invite };
                welcomeName.textContent = invite.name;
                form.classList.add('hidden');
                welcome.classList.remove('hidden');
                actions.classList.remove('hidden');
                renderInvitationQRCode('recovery-qr-wrap', invite.id);
            } catch (err) {
                console.error('Invitation recovery failed:', err);
                errorEl.textContent = 'We could not recover your invitation right now. Please try again.';
                errorEl.classList.remove('hidden');
            }
        };

        window.saveRecoveredQRCode = async function() {
            if (!window.recoveredInvite) return;
            const inviteId = window.recoveredInvite.id;
            await saveQRCodeFromContainer('recovery-qr-wrap', 'Kylie-18th-Invitation-' + inviteId + '.png');
            const status = document.getElementById('recovery-link-status');
            if (status) {
                status.textContent = 'Your invitation QR code has been saved 💙';
                status.classList.remove('hidden');
                setTimeout(() => status.classList.add('hidden'), 3000);
            }
        };

        window.openRecoveredInvitation = async function() {
            if (!window.recoveredInvite) return;
            const recovered = window.recoveredInvite;
            window.recoveredInvite = null;
            window.closeRecoveryModal();
            await openInvitationForGuest(recovered.id, recovered.data, true);
        };

        window.handleRegistration = async function(e) {
            e.preventDefault();
            inviteMode = false;
            const fullName = document.getElementById('reg-fullname').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const guestCount = 1;

            if (!fullName || !email) return;

            try {
                const existingInvite = await findInvitationByEmail(email, false);
                if (existingInvite) {
                    alert('This email has already been registered. You can recover your invitation using your full name and email.');
                    openRecoveryModal(email, fullName);
                    return;
                }

                // If this exact guest previously declined, reuse that record.
                const declinedInvite = await findDeclinedInvitationByEmailAndName(email, fullName);
                if (declinedInvite) {
                    currentGuest = {
                        id: declinedInvite.id,
                        name: declinedInvite.name || fullName,
                        email: declinedInvite.email || email,
                        numGuests: 1,
                        guestNames: [declinedInvite.name || fullName],
                        rsvpStatus: 'Pending',
                        createdAt: declinedInvite.createdAt || new Date().toLocaleString()
                    };

                    await saveGuestToCloud(currentGuest);
                    populateInvitationView();
                    window.goToStep(2);
                    return;
                }
            } catch (err) {
                console.error('Could not check existing email:', err);
                alert('We could not verify this email right now. Please try again.');
                return;
            }

            currentGuest = {
                id: 'KYLIE-' + Math.floor(1000 + Math.random() * 9000),
                name: fullName,
                email: email,
                numGuests: guestCount,
                guestNames: [fullName],
                rsvpStatus: 'Pending',
                createdAt: new Date().toLocaleString()
            };

            try {
                await saveGuestToCloud(currentGuest);
                populateInvitationView();
                window.goToStep(2);
            } catch (err) {
                console.error(err);
                alert("We could not save your registration. Please try again.");
            }
        };

        function getInvitationLink() {
            if (!currentGuest || !currentGuest.id) return window.location.href;
            return window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(currentGuest.id);
        }

        function renderInvitationQRCode(containerId, inviteId) {
            const container = document.getElementById(containerId);
            if (!container || !inviteId || typeof QRCode === 'undefined') return false;

            const link = window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(inviteId);
            container.innerHTML = '';

            const qrHolder = document.createElement('div');
            qrHolder.style.width = '240px';
            qrHolder.style.height = '240px';
            qrHolder.style.display = 'flex';
            qrHolder.style.alignItems = 'center';
            qrHolder.style.justifyContent = 'center';
            container.appendChild(qrHolder);

            new QRCode(qrHolder, {
                text: link,
                width: 240,
                height: 240,
                colorDark: '#4A2633',
                colorLight: '#FFFFFF',
                correctLevel: QRCode.CorrectLevel.H
            });

            // Convert the generated canvas into a normal image so guests can
            // long-press on mobile or right-click/save on desktop.
            setTimeout(() => {
                const canvas = qrHolder.querySelector('canvas');
                if (canvas) {
                    const img = document.createElement('img');
                    img.src = canvas.toDataURL('image/png');
                    img.alt = 'Personal invitation QR code';
                    img.draggable = false;
                    qrHolder.innerHTML = '';
                    qrHolder.appendChild(img);
                }
            }, 60);

            return true;
        }

        async function saveQRCodeFromContainer(containerId, fileName) {
            const container = document.getElementById(containerId);
            if (!container) return;
            const img = container.querySelector('img');
            const canvas = container.querySelector('canvas');
            let dataUrl = img && img.src ? img.src : null;

            if (!dataUrl && canvas) dataUrl = canvas.toDataURL('image/png');
            if (!dataUrl) return;

            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = fileName || 'Kylie-18th-Invitation-QR.png';
            document.body.appendChild(link);
            link.click();
            link.remove();
        }

        window.saveConfirmationQRCode = async function() {
            if (!currentGuest || !currentGuest.id) return;
            await saveQRCodeFromContainer('confirmation-qr-wrap', 'Kylie-18th-Invitation-' + currentGuest.id + '.png');
            const status = document.getElementById('invitation-link-note');
            if (status) {
                status.textContent = 'Your invitation QR code has been saved 💙';
                setTimeout(() => { status.textContent = ''; }, 3000);
            }
        };

        window.openInvitationLink = function() {
            window.open(getInvitationLink(), '_blank');
        };


        // Controls whether the confirmation invitation QR section should appear only after the reminder is acknowledged.
        window.revealInvitationLinksAfterReminder = false;

        // Elegant surprise reminder for saved invitation links and RSVP confirmation.
        window.openSecretReminder = function() {
            const modal = document.getElementById('secret-reminder-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            document.body.classList.add('overflow-hidden');
        };

        window.closeSecretReminder = function() {
            const modal = document.getElementById('secret-reminder-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            document.body.classList.remove('overflow-hidden');

            // After a successful RSVP, reveal the invitation QR section only now.
            if (window.revealInvitationLinksAfterReminder) {
                const links = document.getElementById('confirmation-invitation-links');
                if (links) {
                    links.classList.remove('hidden');
                    if (currentGuest && currentGuest.id) {
                        renderInvitationQRCode('confirmation-qr-wrap', currentGuest.id);
                    }
                }
                window.revealInvitationLinksAfterReminder = false;
            }
        };

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.closeSecretReminder();
        });

        async function loadInvitationFromLink() {
            const inviteId = new URLSearchParams(window.location.search).get('invite');
            if (!inviteId) return false;
            if (!auth.currentUser) return false;

            try {
                const inviteSnap = await getDoc(doc(db, "invites", inviteId));
                if (!inviteSnap.exists()) {
                    console.warn('Invitation link not found:', inviteId);
                    return false;
                }

                const invite = inviteSnap.data();
                if (!invite.name || invite.rsvpStatus !== 'Confirmed') return false;

                // A saved invitation is for a guest who already confirmed attendance.
                // Open it in VIEW-ONLY mode so the guest cannot register/RSVP again.
                await openInvitationForGuest(inviteId, invite, true);
                return true;
            } catch (err) {
                console.error('Could not load invitation link:', err);
                return false;
            }
        }

        function populateInvitationView() {
            if (!currentGuest) return;
            const greeting = document.getElementById('invitation-greeting');
            if (greeting) {
                greeting.textContent = `Dear ${currentGuest.name},`;
            }

            currentGuest.numGuests = 1;
            currentGuest.guestNames = [currentGuest.name];
        }

        window.toggleAttendingDetails = function(isAttending) {
            const detailsBox = document.getElementById('attending-details');
            const labelYes = document.getElementById('opt-label-yes');
            const labelNo = document.getElementById('opt-label-no');

            if (isAttending) {
                detailsBox.classList.remove('hidden');
                labelYes.classList.add('border-blush-600', 'bg-blush-50');
                labelNo.classList.remove('border-blush-600', 'bg-blush-50');
                if (currentGuest) window.generateGuestNameInputs(currentGuest.numGuests);
            } else {
                detailsBox.classList.add('hidden');
                labelNo.classList.add('border-blush-600', 'bg-blush-50');
                labelYes.classList.remove('border-blush-600', 'bg-blush-50');
            }
        };

        window.generateGuestNameInputs = function(count) {
            count = parseInt(count);
            const container = document.getElementById('guest-names-container');
            if (!container) return;
            container.innerHTML = '';

            const existingNames = (currentGuest && currentGuest.guestNames) ? currentGuest.guestNames : [];

            for (let i = 0; i < count; i++) {
                const div = document.createElement('div');
                div.className = "flex items-center gap-2";
                const val = existingNames[i] || (i === 0 && currentGuest ? currentGuest.name : '');

                div.innerHTML = `
                    <span class="text-xs text-blush-600 w-16 font-medium">Guest ${i + 1}:</span>
                    <input type="text" name="guest_name_${i}" required value="${escapeHtml(val)}" placeholder="Full Name" 
                        class="flex-1 px-3 py-2 rounded-xl border border-blush-300 focus:border-rosegold outline-none text-xs bg-white text-blush-900">
                `;
                container.appendChild(div);
            }
        };

        window.handleRsvpSubmit = async function(e) {
            e.preventDefault();
            if (!currentGuest) return;

            const form = e.target;
            const attendance = form.attendance.value;

            if (attendance === 'Yes') {
                currentGuest.rsvpStatus = 'Confirmed';
                const count = 1;
                currentGuest.numGuests = 1;
                currentGuest.guestNames = [currentGuest.name];

                if (typeof confetti === 'function') {
                    confetti({
                        particleCount: 90,
                        spread: 70,
                        origin: { y: 0.6 },
                        colors: ['#F8A8B9', '#B76E79', '#F7E7CE', '#E84E72']
                    });
                }
            } else {
                currentGuest.rsvpStatus = 'Declined';
                currentGuest.guestNames = [];
            }

            try {
                await saveGuestToCloud(currentGuest, currentGuest.rsvpStatus === 'Confirmed');
                showConfirmationView();
                window.goToStep(5);
                // Show the note first. The invitation-link buttons appear only after "I Understand".
                setTimeout(() => openSecretReminder(), 250);
            } catch (err) {
                console.error(err);
                alert("We could not save your RSVP. Please try again.");
            }
        };

        function showConfirmationView() {
            if (!currentGuest) return;

            const titleEl = document.getElementById('confirm-title');
            const msgEl = document.getElementById('confirm-message');
            const iconEl = document.getElementById('confirm-icon');
            const sumName = document.getElementById('sum-name');
            const sumEmail = document.getElementById('sum-email');
            const sumStatus = document.getElementById('sum-status');
            const sumGuestsList = document.getElementById('sum-guests-list');
            const sumGuestsRow = document.getElementById('sum-guests-row');
            const invitationLinks = document.getElementById('confirmation-invitation-links');

            sumName.textContent = currentGuest.name;
            sumEmail.textContent = currentGuest.email;

            if (currentGuest.rsvpStatus === 'Confirmed') {
                // Keep the invitation QR section hidden until the private reminder is acknowledged.
                invitationLinks.classList.add('hidden');
                window.revealInvitationLinksAfterReminder = true;
                titleEl.textContent = `Thank You, ${currentGuest.name}!`;
                msgEl.textContent = "Your attendance has been confirmed! We are thrilled to celebrate Kylie Aianna Fulla's 18th Birthday Debut with you.";
                iconEl.className = "fa-solid fa-wand-magic-sparkles text-rosegold";

                sumStatus.textContent = "ATTENDING";
                sumStatus.className = "px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800";

                sumGuestsRow.classList.remove('hidden');
                sumGuestsList.textContent = currentGuest.guestNames.join(', ') + ` (${currentGuest.numGuests} total)`;
            } else {
                invitationLinks.classList.add('hidden');
                window.revealInvitationLinksAfterReminder = false;
                titleEl.textContent = `Thank you for letting us know, ${currentGuest.name}.`;
                msgEl.textContent = "We will miss your presence, but send our warmest love and blessings to Kylie!";
                iconEl.className = "fa-solid fa-heart-crack text-blush-600";

                sumStatus.textContent = "DECLINED";
                sumStatus.className = "px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800";

                sumGuestsRow.classList.add('hidden');
            }
        }

        window.restartRegistrationLoop = function() {
            inviteMode = false;
            currentGuest = null;
            document.getElementById('registration-form').reset();
            document.getElementById('rsvp-form').reset();
            window.goToStep(1);
        };

        // ------------------------------
        // Event QR check-in scanner
        // ------------------------------
        let qrScanner = null;
        let qrScannerBusy = false;

        window.openQrScanner = async function() {
            const modal = document.getElementById('qr-scanner-modal');
            const status = document.getElementById('qr-scan-status');
            const result = document.getElementById('qr-scan-result');
            const reader = document.getElementById('qr-reader');
            const user = auth.currentUser;

            if (!user || user.isAnonymous) {
                const loginModal = document.getElementById('admin-login-modal');
                if (loginModal) loginModal.classList.remove('hidden');
                return;
            }
            if (!modal || typeof Html5Qrcode === 'undefined') {
                alert('QR scanner is not available. Please refresh the page and try again.');
                return;
            }

            modal.classList.remove('hidden');
            document.body.classList.add('overflow-hidden');
            status.textContent = 'Starting camera…';
            status.className = 'mt-4 text-center text-sm text-blush-800 font-medium';
            result.classList.add('hidden');
            result.innerHTML = '';
            reader.innerHTML = '';
            qrScannerBusy = false;

            qrScanner = new Html5Qrcode('qr-reader');
            try {
                await qrScanner.start(
                    { facingMode: 'environment' },
                    { fps: 10, qrbox: { width: 240, height: 240 } },
                    async (decodedText) => {
                        if (qrScannerBusy) return;
                        qrScannerBusy = true;
                        status.textContent = 'Checking guest…';
                        try {
                            await processScannedGuestQr(decodedText);
                        } finally {
                            setTimeout(() => { qrScannerBusy = false; }, 1200);
                        }
                    },
                    () => {}
                );
                status.textContent = 'Camera ready. Point it at the guest QR code.';
            } catch (err) {
                console.error('QR scanner start failed:', err);
                status.textContent = 'Camera could not start.';
                result.classList.remove('hidden');
                result.className = 'mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-rose-800';
                result.innerHTML = '<div class="font-bold mb-1">Camera Permission Needed</div><div class="text-xs">Allow camera access in your browser, then close and reopen the scanner.</div>';
            }
        };

        window.closeQrScanner = async function() {
            const modal = document.getElementById('qr-scanner-modal');
            if (qrScanner) {
                try {
                    await qrScanner.stop();
                } catch (err) {
                    console.warn('QR scanner stop:', err);
                }
                try { qrScanner.clear(); } catch (err) {}
                qrScanner = null;
            }
            qrScannerBusy = false;
            if (modal) modal.classList.add('hidden');
            document.body.classList.remove('overflow-hidden');
        };

        async function processScannedGuestQr(decodedText) {
            const result = document.getElementById('qr-scan-result');
            const status = document.getElementById('qr-scan-status');
            if (!result || !status) return;

            let inviteId = null;
            try {
                const parsed = new URL(decodedText);
                inviteId = parsed.searchParams.get('invite');
            } catch (err) {
                // Also allow scanning a raw guest ID if the QR ever contains one.
                inviteId = decodedText && decodedText.trim();
            }

            if (!inviteId) {
                showQrScanResult('error', 'Invalid QR Code', 'This QR code is not a Kylie invitation QR code.');
                return;
            }

            try {
                const guestSnap = await getDoc(doc(db, 'rsvps', inviteId));
                if (!guestSnap.exists()) {
                    showQrScanResult('error', 'Guest Not Found', 'This invitation is not registered in the RSVP database.');
                    return;
                }

                const guest = { id: guestSnap.id, ...guestSnap.data() };
                if (guest.rsvpStatus !== 'Confirmed') {
                    showQrScanResult('error', 'Guest Not Confirmed', `${guest.name || 'This guest'} has RSVP status: ${guest.rsvpStatus || 'Unknown'}.`);
                    return;
                }

                if (guest.checkInStatus === 'Checked In') {
                    showQrScanResult('warning', 'Already Checked In', `${guest.name} was already checked in${guest.checkedInAt ? ' at ' + guest.checkedInAt : ''}.`);
                    return;
                }

                const checkedInAt = new Date().toLocaleString();
                await setDoc(doc(db, 'rsvps', inviteId), {
                    checkInStatus: 'Checked In',
                    checkedInAt: checkedInAt
                }, { merge: true });

                showQrScanResult('success', 'Guest Verified ✓', `${guest.name} is confirmed and has been checked in.`);
                status.textContent = 'Ready for the next guest.';
                renderDatabaseTable();
            } catch (err) {
                console.error('Guest QR check-in failed:', err);
                showQrScanResult('error', 'Check-In Failed', 'Could not update the guest record. Please check your host login and Firestore rules.');
            }
        }

        function showQrScanResult(type, title, message) {
            const result = document.getElementById('qr-scan-result');
            if (!result) return;
            const styles = {
                success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
                warning: 'border-amber-200 bg-amber-50 text-amber-800',
                error: 'border-rose-200 bg-rose-50 text-rose-800'
            };
            const icons = {
                success: 'fa-circle-check',
                warning: 'fa-triangle-exclamation',
                error: 'fa-circle-xmark'
            };
            result.className = `mt-4 rounded-2xl border p-4 text-center ${styles[type] || styles.error}`;
            result.innerHTML = `<i class="fa-solid ${icons[type] || icons.error} text-xl mb-2"></i><div class="font-bold">${escapeHtml(title)}</div><div class="text-xs mt-1">${escapeHtml(message)}</div>`;
            result.classList.remove('hidden');
        }

        // Render Database Table
        window.renderDatabaseTable = function() {
            const tbody = document.getElementById('db-table-body');
            const emptyMsg = document.getElementById('db-empty-msg');
            const badge = document.getElementById('guest-count-badge');
            const searchVal = (document.getElementById('db-search-input')?.value || '').toLowerCase();
            const filterStatus = document.getElementById('db-filter-status')?.value || 'ALL';

            if (badge) badge.textContent = guestDatabase.length;
            if (!tbody) return;
            tbody.innerHTML = '';

            let filtered = guestDatabase.filter(g => {
                const matchesSearch = (g.name || '').toLowerCase().includes(searchVal) || (g.email || '').toLowerCase().includes(searchVal);
                const matchesFilter = filterStatus === 'ALL' || g.rsvpStatus === filterStatus;
                return matchesSearch && matchesFilter;
            });

            if (filtered.length === 0) {
                if (emptyMsg) emptyMsg.classList.remove('hidden');
                return;
            } else {
                if (emptyMsg) emptyMsg.classList.add('hidden');
            }

            filtered.forEach((guest) => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-blush-100/60 transition";

                let statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Pending</span>`;
                if (guest.rsvpStatus === 'Confirmed') {
                    statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Confirmed</span>`;
                } else if (guest.rsvpStatus === 'Declined') {
                    statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">Declined</span>`;
                }

                const namesStr = guest.guestNames && guest.guestNames.length > 0 ? guest.guestNames.join(', ') : '-';

                tr.innerHTML = `
                    <td class="p-3 font-mono text-blush-600">${guest.id}</td>
                    <td class="p-3 font-semibold text-blush-900">${escapeHtml(guest.name)}</td>
                    <td class="p-3 text-blush-700">${escapeHtml(guest.email)}</td>
                    <td class="p-3 font-medium">${guest.numGuests || 1}</td>
                    <td class="p-3 text-blush-700 max-w-[150px] truncate" title="${escapeHtml(namesStr)}">${escapeHtml(namesStr)}</td>
                    <td class="p-3">${statusBadge}</td>
                    <td class="p-3">${guest.checkInStatus === 'Checked In'
                        ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800">Checked In</span><div class="text-[9px] mt-1 text-blush-500">${escapeHtml(guest.checkedInAt || '')}</div>`
                        : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">Not Yet</span>`}</td>
                    <td class="p-3 text-[10px] text-blush-600">${guest.createdAt || '-'}</td>
                `;
                tbody.appendChild(tr);
            });
        };

        window.exportCsv = function() {
            if (guestDatabase.length === 0) return;
            let csvContent = "data:text/csv;charset=utf-8,ID,Name,Email,PartyCount,GuestNames,RSVPStatus,CheckInStatus,CheckedInAt,RegisteredAt\n";
            guestDatabase.forEach(g => {
                const party = (g.guestNames || []).join('; ');
                csvContent += `"${g.id}","${g.name}","${g.email}",${g.numGuests},"${party}","${g.rsvpStatus}","${g.checkInStatus || 'Not Yet'}","${g.checkedInAt || ''}","${g.createdAt || ''}"\n`;
            });
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "Kylie_18th_Debut_Guest_List.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        function escapeHtml(str) {
            if (!str) return '';
            str = String(str);
            return str.replace(/&/g, "&amp;")
                      .replace(/</g, "&lt;")
                      .replace(/>/g, "&gt;")
                      .replace(/"/g, "&quot;")
                      .replace(/'/g, "&#039;");
        }

/* Background music controls */
(function () {
    const music = document.getElementById('bg-music');
    const toggle = document.getElementById('music-toggle');
    if (!music || !toggle) return;

    let started = false;
    let muted = false;

    async function startMusic() {
        if (started || muted) return;
        try {
            await music.play();
            started = true;
        } catch (e) {
            // Browser autoplay policy may delay playback until another interaction.
        }
    }

    function updateButton() {
        const icon = toggle.querySelector('i');
        if (!icon) return;
        icon.className = muted
            ? 'fa-solid fa-volume-xmark'
            : 'fa-solid fa-volume-high';
        toggle.setAttribute('aria-label', muted ? 'Unmute background music' : 'Mute background music');
        toggle.title = muted ? 'Play music' : 'Mute music';
    }

    document.addEventListener('pointerdown', function () {
        startMusic();
    }, { once: true, passive: true });

    document.addEventListener('keydown', function () {
        startMusic();
    }, { once: true });

    toggle.addEventListener('click', function (event) {
        event.stopPropagation();
        if (music.paused) {
            muted = false;
            music.play().then(() => { started = true; updateButton(); }).catch(() => {});
        } else {
            music.pause();
            muted = true;
        }
        updateButton();
    });

    updateButton();
})();
