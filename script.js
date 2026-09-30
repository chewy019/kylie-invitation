import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, setDoc, getDoc, getDocs, collection, query, where, onSnapshot, writeBatch, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
        const HOST_UID = 'myL41BfZY2RXwIxMFU6ybtCHKNE2';

        function isHostUser(user = auth.currentUser) {
            return Boolean(user && !user.isAnonymous && user.uid === HOST_UID);
        }

        let guestDatabase = [];
        let guestDatabaseLoading = false;
        let guestDatabaseError = false;
        let currentGuest = null;
        let countdownInterval = null;
        let adminSnapshotUnsubscribe = null;
        let authReady = false;
        let inviteMode = false;
        let registrationSavePromise = null;
        let scrollRevealObserver = null;
        let invitationEnvelopeShown = false;
        let invitationEnvelopeOpening = false;
        let invitationEnvelopeBackground = [];
        let invitationEnvelopeCloseTimer = null;
        let invitationEnvelopeExitTimer = null;
        let showInvitationReminderAfterEnvelope = false;
        const dialogFocusReturn = new Map();

        function getDialogFocusableElements(dialog) {
            if (!dialog) return [];
            return Array.from(dialog.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter((element) => !element.closest('.hidden, [hidden], [inert], [aria-hidden="true"]')
                && element.getClientRects().length > 0);
        }

        function focusIntoDialog(dialog) {
            const focusableElements = getDialogFocusableElements(dialog);
            const initialTarget = focusableElements.find((element) => element.matches('input, select, textarea'))
                || focusableElements[0];
            if (initialTarget) initialTarget.focus({ preventScroll: true });
        }

        function getTopOpenDialog() {
            const entries = [
                ['site-opening-overlay', () => {}],
                ['milestone-modal', () => window.closeMilestoneModal()],
                ['qr-scanner-modal', () => window.closeQrScanner()],
                ['secret-reminder-modal', () => window.closeSecretReminder()],
                ['recovery-modal', () => window.closeRecoveryModal()],
                ['admin-login-modal', () => window.closeAdminLogin()]
            ];
            return entries.map(([id, close]) => ({
                dialog: document.getElementById(id),
                close
            })).find(({ dialog }) => dialog && !dialog.classList.contains('hidden')) || null;
        }

        function openAccessibleDialog(dialog) {
            if (!dialog) return;
            if (dialog.classList.contains('hidden')) {
                dialogFocusReturn.set(dialog.id, document.activeElement);
            }
            dialog.classList.remove('hidden');
            if (dialog.id === 'milestone-modal') dialog.classList.add('flex');
            syncModalScrollLock();
            focusIntoDialog(dialog);
        }

        function closeAccessibleDialog(dialog) {
            if (!dialog) return;
            dialog.classList.add('hidden');
            if (dialog.id === 'milestone-modal') dialog.classList.remove('flex');
            syncModalScrollLock();

            const returnTarget = dialogFocusReturn.get(dialog.id);
            dialogFocusReturn.delete(dialog.id);
            const remainingDialog = getTopOpenDialog();
            if (remainingDialog) {
                if (returnTarget instanceof HTMLElement && returnTarget.isConnected
                    && remainingDialog.dialog.contains(returnTarget)) {
                    returnTarget.focus({ preventScroll: true });
                } else {
                    focusIntoDialog(remainingDialog.dialog);
                }
                return;
            }

            if (returnTarget instanceof HTMLElement && returnTarget.isConnected
                && returnTarget !== document.body
                && !returnTarget.closest('.hidden, [hidden], [inert], [aria-hidden="true"]')
                && !returnTarget.disabled) {
                returnTarget.focus({ preventScroll: true });
            }
        }

        function syncModalScrollLock() {
            const modalIds = [
                'admin-login-modal', 'milestone-modal', 'qr-scanner-modal',
                'recovery-modal', 'secret-reminder-modal'
            ];
            const hasOpenModal = modalIds.some((id) => {
                const modal = document.getElementById(id);
                return modal && !modal.classList.contains('hidden');
            });
            document.body.classList.toggle('overflow-hidden', hasOpenModal);
        }

        const DEBUT_EVENT_CONFIG = {
            celebrant: "Kylie Aianna Fulla",
            dateStr: "2026-11-07T16:30:00+08:00",
            durationMinutes: 30,
            reminderMinutes: 30,
            doorsOpenTime: "4:00 PM",
            venue: "Tito's Restaurant, 546 Concha St., Tondo, Manila",
            dressCode: "Casual Attire — Cream & Beige"
        };

        function initializeEventDateLabels() {
            const eventStart = new Date(DEBUT_EVENT_CONFIG.dateStr);
            if (Number.isNaN(eventStart.getTime())) return;

            const eventEnd = new Date(eventStart.getTime() + DEBUT_EVENT_CONFIG.durationMinutes * 60 * 1000);
            const timeZone = 'Asia/Manila';
            const dateText = new Intl.DateTimeFormat('en-US', {
                month: 'long', day: 'numeric', year: 'numeric', timeZone
            }).format(eventStart);
            const weekdayText = new Intl.DateTimeFormat('en-US', {
                weekday: 'long', timeZone
            }).format(eventStart);
            const formatTime = (date) => new Intl.DateTimeFormat('en-US', {
                hour: 'numeric', minute: '2-digit', timeZone
            }).format(date);
            const startTime = formatTime(eventStart);
            const endTime = formatTime(eventEnd);
            const formattedCountdownDate = `${weekdayText}, ${dateText} at ${startTime}`;

            const labels = [
                ['countdown-subtitle', formattedCountdownDate],
                ['event-date-display', dateText],
                ['event-weekday-display', weekdayText],
                ['event-start-time-display', startTime],
                ['event-doors-open-display', `Doors open at ${DEBUT_EVENT_CONFIG.doorsOpenTime}`],
                ['add-calendar-note', `Reminder window: ${formatTime(new Date(eventStart.getTime() - DEBUT_EVENT_CONFIG.reminderMinutes * 60 * 1000))}–${startTime}`]
            ];
            labels.forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            });
        }

        window.addToCalendar = function() {
            const status = document.getElementById('calendar-download-status');
            const showCalendarStatus = (message, isError = false) => {
                if (!status) return;
                status.textContent = message;
                status.classList.toggle('is-error', isError);
                status.classList.toggle('is-success', !isError);
            };
            const escapeICalendarText = (value) => String(value)
                .replace(/\\/g, '\\\\')
                .replace(/\r?\n/g, '\\n')
                .replace(/,/g, '\\,')
                .replace(/;/g, '\\;');

            try {
                const eventStart = new Date(DEBUT_EVENT_CONFIG.dateStr);
                if (Number.isNaN(eventStart.getTime())) throw new Error('Invalid event date in DEBUT_EVENT_CONFIG.');
                const eventEnd = new Date(eventStart.getTime() + DEBUT_EVENT_CONFIG.durationMinutes * 60 * 1000);
                const toIcsUtc = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
                const stamp = toIcsUtc(new Date());
                const calendarTitle = `${DEBUT_EVENT_CONFIG.celebrant}'s 18th Birthday Debut`;
                const reminderAt = new Date(eventStart.getTime() - DEBUT_EVENT_CONFIG.reminderMinutes * 60 * 1000);
                const reminderTime = new Intl.DateTimeFormat('en-US', {
                    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila'
                }).format(reminderAt);
                const reminderNote = `Reminder window: ${reminderTime}–${new Intl.DateTimeFormat('en-US', {
                    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila'
                }).format(eventStart)}. The event begins at ${new Intl.DateTimeFormat('en-US', {
                    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila'
                }).format(eventStart)}. Set the calendar alert ${DEBUT_EVENT_CONFIG.reminderMinutes} minutes before the event.`;
                const description = `Doors open at ${DEBUT_EVENT_CONFIG.doorsOpenTime}. ${DEBUT_EVENT_CONFIG.dressCode}. ${reminderNote}`;
                const calendarEvent = [
                    'BEGIN:VCALENDAR',
                    'VERSION:2.0',
                    'PRODID:-//Kylie Aianna Fulla//18th Birthday Debut//EN',
                    'CALSCALE:GREGORIAN',
                    'METHOD:PUBLISH',
                    'BEGIN:VEVENT',
                    'UID:kylie-18th-debut@kylie-invitation',
                    `DTSTAMP:${stamp}`,
                    `DTSTART:${toIcsUtc(eventStart)}`,
                    `DTEND:${toIcsUtc(eventEnd)}`,
                    `SUMMARY:${escapeICalendarText(calendarTitle)}`,
                    `LOCATION:${escapeICalendarText(DEBUT_EVENT_CONFIG.venue)}`,
                    `DESCRIPTION:${escapeICalendarText(description)}`,
                    'BEGIN:VALARM',
                    `TRIGGER:-PT${DEBUT_EVENT_CONFIG.reminderMinutes}M`,
                    'ACTION:DISPLAY',
                    `DESCRIPTION:${escapeICalendarText(`${DEBUT_EVENT_CONFIG.celebrant}'s debut begins in ${DEBUT_EVENT_CONFIG.reminderMinutes} minutes. Doors open at ${DEBUT_EVENT_CONFIG.doorsOpenTime}.`)}`,
                    'END:VALARM',
                    'END:VEVENT',
                    'END:VCALENDAR'
                ].join('\r\n') + '\r\n';
                // Share the actual calendar file so Messenger's in-app browser does not
                // navigate to a blob URL and display the raw ICS text as a web page.
                if (typeof File === 'function'
                    && typeof navigator.share === 'function'
                    && typeof navigator.canShare === 'function'
                ) {
                    const calendarFile = new File([calendarEvent], 'Kylie-18th-Birthday-Debut.ics', {
                        type: 'text/calendar;charset=utf-8'
                    });
                    let canShareCalendarFile = false;
                    try {
                        canShareCalendarFile = navigator.canShare({ files: [calendarFile] });
                    } catch (shareCheckError) {
                        console.info('File sharing is unavailable; opening Google Calendar instead.', shareCheckError);
                    }
                    if (canShareCalendarFile) {
                        navigator.share({
                            files: [calendarFile],
                            title: calendarTitle,
                            text: 'Choose your Calendar app to save the event.'
                        }).then(() => {
                            showCalendarStatus('Choose your Calendar app in the share menu to save the event.');
                        }).catch((error) => {
                            if (error?.name === 'AbortError') return;
                            console.warn('Could not share the calendar file; opening Google Calendar instead:', error);
                            openGoogleCalendarTemplate(calendarTitle, description, eventStart, eventEnd);
                        });
                        return;
                    }
                }

                openGoogleCalendarTemplate(calendarTitle, description, eventStart, eventEnd);
            } catch (error) {
                console.error('Could not create calendar event:', error);
                showCalendarStatus('Could not open a calendar event. Please try opening this invitation in your browser.', true);
            }
        };

        function openGoogleCalendarTemplate(title, description, eventStart, eventEnd) {
            const status = document.getElementById('calendar-download-status');
            const showCalendarStatus = (message, isError = false) => {
                if (!status) return;
                status.textContent = message;
                status.classList.toggle('is-error', isError);
                status.classList.toggle('is-success', !isError);
            };
            const toManilaLocalDateTime = (date) => {
                const parts = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Asia/Manila',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hourCycle: 'h23'
                }).formatToParts(date).reduce((result, part) => {
                    if (part.type !== 'literal') result[part.type] = part.value;
                    return result;
                }, {});
                return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
            };

            const calendarUrl = new URL('https://calendar.google.com/calendar/render');
            calendarUrl.searchParams.set('action', 'TEMPLATE');
            calendarUrl.searchParams.set('text', title);
            calendarUrl.searchParams.set('dates', `${toManilaLocalDateTime(eventStart)}/${toManilaLocalDateTime(eventEnd)}`);
            calendarUrl.searchParams.set('ctz', 'Asia/Manila');
            calendarUrl.searchParams.set('details', description);
            calendarUrl.searchParams.set('location', DEBUT_EVENT_CONFIG.venue);
            const reminderAt = new Date(eventStart.getTime() - DEBUT_EVENT_CONFIG.reminderMinutes * 60 * 1000);
            const reminderTime = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila'
            }).format(reminderAt);
            showCalendarStatus(`Opening the calendar event. Reminder window: ${reminderTime}–${new Intl.DateTimeFormat('en-US', {
                hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila'
            }).format(eventStart)}. Confirm the ${DEBUT_EVENT_CONFIG.reminderMinutes}-minute alert before saving.`);
            window.location.assign(calendarUrl.href);
        }

        // Keep this list in the order chosen for the slideshow.
        const DEBUT_PHOTO_SLIDES = [
            { src: './photos/memory-01.webp', alt: 'Baby Kylie resting on pink bedding', caption: 'A tiny first memory' },
            { src: './photos/memory-02.webp', alt: 'Baby Kylie in a mint green dress', caption: 'A sweet little smile' },
            { src: './photos/memory-03.webp', alt: 'Young Kylie holding an ice cream', caption: 'A playful childhood moment' },
            { src: './photos/memory-04.webp', alt: 'Young Kylie in a red dress on a turquoise couch', caption: 'A favorite childhood photo' },
            { src: './photos/memory-05.webp', alt: 'Young Kylie wearing a pink polka dot shirt', caption: 'Growing up with a smile' },
            { src: './photos/memory-06.webp', alt: 'Young Kylie beside a canal', caption: 'A day out together' },
            { src: './photos/memory-07.webp', alt: 'Kylie among yellow flowers', caption: 'A sunny day in the flowers' },
            { src: './photos/memory-08.webp', alt: 'Kylie making a peace sign in a white top', caption: 'A playful little moment' },
            { src: './photos/memory-09.webp', alt: 'Kylie smiling in her blue gown', caption: 'Getting ready to celebrate' },
            { src: './photos/memory-10.webp', alt: 'Kylie in her blue debut gown', caption: 'A night to remember' }
        ];
        let photoSlideIndex = 0;
        let photoSlideTimer = null;
        let photoSlideshowActive = false;

        function capitalizeNameWords(value) {
            return value.replace(/(^|[\s'’\-])(\p{L})/gu, (_, separator, letter) =>
                separator + letter.toLocaleUpperCase()
            );
        }

        function normalizeSubmittedName(value) {
            return capitalizeNameWords(String(value || '').replace(/\s+/gu, ' ').trim());
        }

        function initializeNameCapitalization() {
            ['reg-fullname', 'recovery-name'].forEach((id) => {
                const input = document.getElementById(id);
                if (!input) return;
                let isComposing = false;

                const capitalizeInput = () => {
                    const start = input.selectionStart ?? input.value.length;
                    const end = input.selectionEnd ?? start;
                    const beforeCaret = capitalizeNameWords(input.value.slice(0, start)).length;
                    const afterSelection = capitalizeNameWords(input.value.slice(0, end)).length;
                    const nextValue = capitalizeNameWords(input.value);
                    if (nextValue === input.value) return;

                    input.value = nextValue;
                    input.setSelectionRange(beforeCaret, afterSelection);
                };

                input.addEventListener('compositionstart', () => { isComposing = true; });
                input.addEventListener('compositionend', () => {
                    isComposing = false;
                    capitalizeInput();
                });
                input.addEventListener('input', () => {
                    if (!isComposing) capitalizeInput();
                });
                input.addEventListener('blur', capitalizeInput);
            });
        }

        function initializePhotoSlideshow() {
            const root = document.getElementById('debut-photo-slideshow');
            const placeholder = document.getElementById('photo-slideshow-placeholder');
            const viewport = document.getElementById('photo-slideshow-viewport');
            const track = document.getElementById('photo-slideshow-track');
            const controls = document.getElementById('photo-slideshow-controls');
            const counter = document.getElementById('photo-slideshow-counter');
            const caption = document.getElementById('photo-slideshow-caption');
            const slideshowStatus = document.getElementById('photo-slideshow-status');
            if (!root || !placeholder || !viewport || !track || !controls || !counter || !caption) return;

            const slides = DEBUT_PHOTO_SLIDES.filter(slide => slide && slide.src);
            if (slides.length === 0) return;
            const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

            placeholder.classList.add('hidden');
            viewport.classList.remove('hidden');
            if (slides.length > 1) controls.classList.remove('hidden');

            slides.forEach((slide, index) => {
                const figure = document.createElement('figure');
                figure.className = 'page2-slideshow-slide is-loading';
                figure.setAttribute('aria-roledescription', 'slide');
                figure.setAttribute('aria-label', `Photo ${index + 1} of ${slides.length}`);

                const image = document.createElement('img');
                image.alt = slide.alt || `Kylie debut photo ${index + 1}`;
                image.loading = 'lazy';
                image.decoding = 'async';
                image.dataset.src = slide.src;
                image.draggable = false;
                const webpSource = document.createElement('source');
                webpSource.type = 'image/webp';
                webpSource.dataset.srcset = slide.webp || '';
                const picture = document.createElement('picture');
                if (slide.webp) picture.appendChild(webpSource);
                image.addEventListener('load', () => {
                    figure.classList.remove('is-loading');
                }, { once: true });
                image.addEventListener('error', () => {
                    if (webpSource.hasAttribute('srcset') && image.dataset.originalFallback !== 'true') {
                        image.dataset.originalFallback = 'true';
                        webpSource.removeAttribute('srcset');
                        image.removeAttribute('src');
                        image.src = image.dataset.src;
                        return;
                    }
                    figure.classList.remove('is-loading');
                    const fallback = document.createElement('div');
                    fallback.className = 'page2-slideshow-image-error';
                    fallback.textContent = 'This photo is unavailable right now.';
                    image.replaceWith(fallback);
                });
                picture.appendChild(image);
                figure.appendChild(picture);
                track.appendChild(figure);
            });

            function preloadPhotoSlide(index) {
                const slideIndex = (index + slides.length) % slides.length;
                const image = track.children[slideIndex]?.querySelector('img');
                if (!image || image.hasAttribute('src')) return;
                image.loading = 'eager';
                image.fetchPriority = slideIndex === photoSlideIndex ? 'high' : 'low';
                const webpSource = image.parentElement?.querySelector('source[type="image/webp"]');
                if (webpSource?.dataset.srcset) webpSource.srcset = webpSource.dataset.srcset;
                image.src = image.dataset.src;
            }

            function showPhotoSlide(index, announce = false, loadImages = true) {
                photoSlideIndex = (index + slides.length) % slides.length;
                if (loadImages) {
                    preloadPhotoSlide(photoSlideIndex);
                    if (slides.length > 1) {
                        preloadPhotoSlide(photoSlideIndex + 1);
                        preloadPhotoSlide(photoSlideIndex - 1);
                    }
                }
                Array.from(track.children).forEach((slide, slideIndex) => {
                    slide.setAttribute('aria-hidden', slideIndex === photoSlideIndex ? 'false' : 'true');
                });
                const slideCaption = slides[photoSlideIndex].caption || '';
                const captionChanged = caption.textContent !== slideCaption;
                counter.textContent = `${photoSlideIndex + 1} / ${slides.length}`;
                caption.textContent = slideCaption;
                if (captionChanged && !reducedMotionQuery.matches) {
                    caption.classList.remove('slide-caption-enter');
                    void caption.offsetWidth;
                    caption.classList.add('slide-caption-enter');
                }
                if (announce && slideshowStatus) {
                    slideshowStatus.textContent = `Photo ${photoSlideIndex + 1} of ${slides.length}${slideCaption ? `: ${slideCaption}` : ''}`;
                }
            }

            window.changePhotoSlide = function(direction) {
                showPhotoSlide(photoSlideIndex + direction, true);
                restartPhotoSlideTimer();
            };

            function restartPhotoSlideTimer() {
                if (photoSlideTimer) clearTimeout(photoSlideTimer);
                photoSlideTimer = null;
                // Keep manual swipe/arrow navigation available, but avoid automatic
                // image changes for visitors who request reduced motion.
                if (slides.length > 1 && photoSlideshowActive
                    && !reducedMotionQuery.matches
                    && document.visibilityState !== 'hidden') {
                    const advanceWhenReady = () => {
                        if (!photoSlideshowActive || document.visibilityState === 'hidden') return;

                        const nextIndex = (photoSlideIndex + 1) % slides.length;
                        const nextImage = track.children[nextIndex]?.querySelector('img');
                        if (nextImage && !nextImage.complete) {
                            // Back off while a slow mobile connection finishes the next photo.
                            photoSlideTimer = window.setTimeout(advanceWhenReady, 500);
                            return;
                        }

                        showPhotoSlide(nextIndex);
                        restartPhotoSlideTimer();
                    };

                    photoSlideTimer = window.setTimeout(advanceWhenReady, 3000);
                }
            }

            window.setPhotoSlideshowActive = function(isActive) {
                const shouldActivate = Boolean(isActive);
                if (shouldActivate && !photoSlideshowActive) {
                    showPhotoSlide(photoSlideIndex);
                }
                photoSlideshowActive = shouldActivate;
                restartPhotoSlideTimer();
            };

            // Mobile browsers may suspend timers when a tab is backgrounded or restored
            // from the back-forward cache. Re-arm autoplay when the page becomes visible.
            document.addEventListener('visibilitychange', restartPhotoSlideTimer);
            window.addEventListener('pageshow', restartPhotoSlideTimer);
            if (typeof reducedMotionQuery.addEventListener === 'function') {
                reducedMotionQuery.addEventListener('change', restartPhotoSlideTimer);
            } else if (typeof reducedMotionQuery.addListener === 'function') {
                reducedMotionQuery.addListener(restartPhotoSlideTimer);
            }

            let pointerStart = null;
            viewport.addEventListener('pointerdown', (event) => {
                if (event.isPrimary) pointerStart = { x: event.clientX, y: event.clientY };
            });
            viewport.addEventListener('pointerup', (event) => {
                if (!pointerStart) return;
                const deltaX = event.clientX - pointerStart.x;
                const deltaY = event.clientY - pointerStart.y;
                pointerStart = null;
                if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY)) {
                    window.changePhotoSlide(deltaX < 0 ? 1 : -1);
                }
            });
            viewport.addEventListener('pointercancel', () => { pointerStart = null; });
            viewport.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    window.changePhotoSlide(-1);
                }
                if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    window.changePhotoSlide(1);
                }
            });

            // Keep the photos out of the initial registration-page network requests.
            showPhotoSlide(0, false, false);
            restartPhotoSlideTimer();
        }

        function initializeScrollReveals() {
            const revealTargets = document.querySelectorAll(
                '#step-invitation > .page2-invitation-card, #step-invitation > #debut-photo-slideshow, #step-invitation > .page2-countdown, #step-details > .debut-card, #step-details .grid > div, #step-rsvp > .debut-card, #step-confirmation > .debut-card'
            );

            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

            revealTargets.forEach((element) => element.classList.add('scroll-reveal'));
            if (!('IntersectionObserver' in window)) {
                revealTargets.forEach((element) => element.classList.add('is-revealed'));
                return;
            }

            scrollRevealObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-revealed');
                    observer.unobserve(entry.target);
                });
            }, { threshold: 0.12, rootMargin: '0px 0px -36px 0px' });

            revealTargets.forEach((element) => scrollRevealObserver.observe(element));
        }

        function refreshScrollReveals(section) {
            if (!scrollRevealObserver || !section) return;
            section.querySelectorAll('.scroll-reveal:not(.is-revealed)').forEach((element) => {
                scrollRevealObserver.unobserve(element);
                scrollRevealObserver.observe(element);
            });
        }

        function initializeFloatingPetals() {
            const layer = document.getElementById('floating-petal-layer');
            if (!layer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

            const petals = [
                [7, '-15s', '19s', '-24px'], [19, '-6s', '22s', '20px'],
                [31, '-18s', '20s', '-18px'], [45, '-10s', '24s', '24px'],
                [59, '-3s', '21s', '-22px'], [72, '-14s', '23s', '18px'],
                [84, '-8s', '20s', '-20px'], [95, '-20s', '25s', '14px']
            ];

            petals.forEach(([left, delay, duration, drift], index) => {
                const petal = document.createElement('span');
                petal.className = 'floating-petal';
                petal.textContent = index % 2 === 0 ? '✿' : '❀';
                petal.style.setProperty('--petal-left', `${left}%`);
                petal.style.setProperty('--petal-delay', delay);
                petal.style.setProperty('--petal-duration', duration);
                petal.style.setProperty('--petal-drift', drift);
                layer.appendChild(petal);
            });
        }

        function showInvitationEnvelope() {
            const overlay = document.getElementById('site-opening-overlay');
            if (!overlay || invitationEnvelopeShown) return;
            invitationEnvelopeShown = true;
            invitationEnvelopeOpening = false;
            invitationEnvelopeBackground = Array.from(document.body.children)
                .filter((element) => element !== overlay && !element.inert);
            document.body.classList.add('entry-animation-playing');
            invitationEnvelopeBackground.forEach((element) => { element.inert = true; });
            overlay.classList.remove('hidden');
            overlay.classList.remove('is-opening', 'is-closing');
            overlay.classList.add('is-prompt');
            const button = document.getElementById('open-invitation-envelope');
            const title = document.getElementById('site-opening-title');
            if (button) {
                button.disabled = false;
                button.setAttribute('aria-label', "Open Kylie's invitation");
                button.focus();
            }
            if (title) title.textContent = 'Your invitation awaits';
        }

        function focusStepHeading(section) {
            if (!section) return;
            const target = section.querySelector('h1, h2, h3, [role="heading"]') || section;
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
        }

        function closeInvitationEnvelope(focusTargetId = 'step-invitation', allowReplay = false) {
            const overlay = document.getElementById('site-opening-overlay');
            if (!overlay) return;
            if (invitationEnvelopeCloseTimer) {
                window.clearTimeout(invitationEnvelopeCloseTimer);
                invitationEnvelopeCloseTimer = null;
            }
            if (invitationEnvelopeExitTimer) window.clearTimeout(invitationEnvelopeExitTimer);
            overlay.classList.add('is-closing');
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            invitationEnvelopeExitTimer = window.setTimeout(() => {
                invitationEnvelopeExitTimer = null;
                overlay.classList.add('hidden');
                overlay.classList.remove('is-prompt', 'is-opening', 'is-closing');
                document.body.classList.remove('entry-animation-playing');
                invitationEnvelopeBackground.forEach((element) => { element.inert = false; });
                invitationEnvelopeBackground = [];
                if (allowReplay) {
                    invitationEnvelopeShown = false;
                    invitationEnvelopeOpening = false;
                }
                const focusTarget = document.getElementById(focusTargetId);
                if (focusTarget && !focusTarget.classList.contains('hidden')) focusStepHeading(focusTarget);
                if (typeof window.setPhotoSlideshowActive === 'function') {
                    window.setPhotoSlideshowActive(focusTargetId === 'step-invitation' && !allowReplay);
                }
                if (showInvitationReminderAfterEnvelope) {
                    showInvitationReminderAfterEnvelope = false;
                    window.openSecretReminder();
                }
            }, reduceMotion ? 0 : 440);
        }

        window.openInvitationEnvelope = function() {
            const overlay = document.getElementById('site-opening-overlay');
            const button = document.getElementById('open-invitation-envelope');
            const title = document.getElementById('site-opening-title');
            if (!overlay || invitationEnvelopeOpening || !invitationEnvelopeShown) return;
            invitationEnvelopeOpening = true;
            if (button) {
                button.disabled = true;
                button.setAttribute('aria-label', 'Opening your invitation');
            }
            if (title) title.textContent = 'Your invitation is ready';
            overlay.classList.remove('is-prompt');
            overlay.classList.add('is-opening');
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            // Let the letter rise and enlarge before the full invitation fades in behind it.
            invitationEnvelopeCloseTimer = window.setTimeout(() => {
                invitationEnvelopeCloseTimer = null;
                closeInvitationEnvelope();
            }, reduceMotion ? 0 : 1380);
        };

        function updateMobileStepProgress(stepNum) {
            const stage = stepNum === 5 ? 4 : stepNum;
            const labels = { 1: 'Register', 2: 'Invitation', 3: 'Event Details', 4: 'RSVP' };
            const label = document.getElementById('mobile-step-label');
            const fill = document.getElementById('mobile-step-fill');
            const track = document.getElementById('mobile-step-track');
            if (label) label.textContent = `Step ${stage} of 4 · ${labels[stage] || labels[1]}`;
            if (fill) fill.style.width = `${stage * 25}%`;
            if (track) {
                track.setAttribute('aria-valuenow', String(stage));
                track.setAttribute('aria-valuetext', `Step ${stage} of 4: ${labels[stage] || labels[1]}`);
            }
        }

        function waitForInitialAuthState() {
            return new Promise((resolve, reject) => {
                let unsubscribe;
                let initialized = false;
                unsubscribe = onAuthStateChanged(auth, (user) => {
                    initialized = true;
                    unsubscribe?.();
                    resolve(user);
                }, reject);
                if (initialized) unsubscribe();
            });
        }

        window.addEventListener('DOMContentLoaded', async () => {
            initializeEventDateLabels();
            initializePhotoSlideshow();
            initializeNameCapitalization();
            initializeScrollReveals();
            initializeFloatingPetals();
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('admin') === '1') {
                const adminBtn = document.getElementById('admin-console-btn');
                if (adminBtn) adminBtn.classList.remove('hidden');
            }

            startCountdownTimer();

            // Open saved invitation links immediately so guests do not see the registration
            // screen while Firebase authentication is still initializing.
            if (urlParams.get('invite')) {
                inviteMode = true;
                const greeting = document.getElementById('invitation-greeting');
                if (greeting) {
                    greeting.textContent = 'Preparing your invitation…';
                    greeting.setAttribute('aria-busy', 'true');
                }
                window.goToStep(2);
            }

            try {
                // Firebase restores its saved account asynchronously. Wait for that first
                // state before creating an anonymous guest, so a persisted host session
                // is never replaced when the host opens or refreshes a personal link.
                const initialUser = await waitForInitialAuthState();
                if (!initialUser || (!initialUser.isAnonymous && !isHostUser(initialUser))) {
                    await signInAnonymously(auth);
                }
                authReady = true;
                await loadInvitationFromLink();
            } catch (err) {
                console.error("Firebase anonymous sign-in failed:", err);
                if (urlParams.has('invite')) {
                    returnToRegistrationAfterInviteFailure("We couldn't load this invitation right now. Please check your connection or recover your invitation below.");
                    return;
                }
                const inviteNotice = document.getElementById('invite-load-notice');
                if (inviteNotice) {
                    inviteNotice.textContent = 'The invitation service is not ready right now. Please wait a moment and try again.';
                    inviteNotice.classList.remove('hidden');
                } else {
                    alert('The invitation service is not ready right now. Please wait a moment and try again.');
                }
            }

            onAuthStateChanged(auth, (user) => {
                if (!isHostUser(user)) {
                    if (adminSnapshotUnsubscribe) {
                        adminSnapshotUnsubscribe();
                        adminSnapshotUnsubscribe = null;
                    }
                    guestDatabase = [];
                    guestDatabaseLoading = false;
                    guestDatabaseError = false;
                    const drawer = document.getElementById('db-drawer');
                    if (drawer?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
                        document.activeElement.blur();
                    }
                    setDbDrawerOpen(false);
                    const adminBtn = document.getElementById('admin-console-btn');
                    if (adminBtn && urlParams.get('admin') !== '1') adminBtn.classList.add('hidden');
                    renderDatabaseTable();
                    return;
                }

                // Firestore rules remain the authority for every database read/write.
                startAdminListener();
                openDbDrawer();
                const btn = document.getElementById('admin-console-btn');
                if (btn) {
                    btn.classList.remove('hidden');
                    btn.innerHTML = '<i class="fa-solid fa-crown text-rosegold" aria-hidden="true"></i><span class="guest-records-label">Guest Records</span><span id="guest-count-badge" class="bg-blush-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold" aria-hidden="true">0</span>';
                }
            });
        });

        async function saveGuestToCloud(guest, createInvitationLink = false) {
            if (!guest || !guest.id) throw new Error('Missing guest record.');
            if (!auth.currentUser) throw new Error('Firebase authentication is not ready.');

            const ownerUid = auth.currentUser.uid;
            const guestToSave = { ...guest, ownerUid };
            const guestRef = doc(db, "rsvps", guest.id);

            // Keep a lightweight registration record in invites. Pending/Confirmed emails
            // are locked; Declined emails are reusable. Only Confirmed records open as invitations.
            const inviteRef = doc(db, "invites", guest.id);
            const inviteRecord = {
                name: guest.name,
                nameLower: normalizeName(guest.name),
                email: guest.email,
                emailLower: normalizeEmail(guest.email),
                numGuests: guest.numGuests || 1,
                ownerUid,
                rsvpStatus: guest.rsvpStatus
            };

            // Keep the RSVP and lookup record in sync: either both writes commit or neither does.
            const batch = writeBatch(db);
            batch.set(guestRef, guestToSave, { merge: true });
            batch.set(inviteRef, inviteRecord, { merge: true });
            await batch.commit();

            // Preserve changes made while this write was pending (for example, a fast
            // RSVP submission) and never restore an older guest after the flow changed.
            if (currentGuest && currentGuest.id === guestToSave.id) {
                currentGuest = { ...currentGuest, ownerUid };
            }
        }

        function startAdminListener() {
            if (!isHostUser()) return;
            if (adminSnapshotUnsubscribe) adminSnapshotUnsubscribe();
            guestDatabase = [];
            guestDatabaseLoading = true;
            guestDatabaseError = false;
            renderDatabaseTable();
            const rsvpsRef = collection(db, "rsvps");
            adminSnapshotUnsubscribe = onSnapshot(rsvpsRef, (snapshot) => {
                guestDatabaseLoading = false;
                guestDatabaseError = false;
                guestDatabase = [];
                snapshot.forEach((docSnap) => {
                    guestDatabase.push({ ...docSnap.data(), id: docSnap.id });
                });
                renderDatabaseTable();
            }, (error) => {
                console.error("Private Firestore listener error:", error);
                guestDatabaseLoading = false;
                guestDatabaseError = true;
                guestDatabase = [];
                renderDatabaseTable();
            });
        }

        window.handleAdminLogin = async function(e) {
            e.preventDefault();
            const form = e.currentTarget;
            if (form?.getAttribute('aria-busy') === 'true') return;
            const email = document.getElementById('admin-email').value.trim();
            const password = document.getElementById('admin-password').value;
            const errorEl = document.getElementById('admin-login-error');
            const submitButton = form?.querySelector('button[type="submit"]');
            const submitLabel = submitButton?.textContent.trim() || 'Sign In';
            errorEl.classList.add('hidden');
            form?.setAttribute('aria-busy', 'true');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.setAttribute('aria-busy', 'true');
                submitButton.classList.add('is-saving');
                submitButton.textContent = 'Signing in…';
            }

            try {
                const credential = await signInWithEmailAndPassword(auth, email, password);
                if (!isHostUser(credential.user)) {
                    await signOut(auth);
                    try {
                        await signInAnonymously(auth);
                    } catch (restoreError) {
                        console.error('Could not restore guest session after rejected host login:', restoreError);
                    }
                    errorEl.textContent = 'This account is not authorized to access the host console.';
                    errorEl.classList.remove('hidden');
                    return;
                }
                closeAdminLogin();
                startAdminListener();
                openDbDrawer();
            } catch (err) {
                console.error('Host login failed:', err);
                errorEl.textContent = 'Login failed. Check the email/password and make sure Email/Password Authentication is enabled in Firebase.';
                errorEl.classList.remove('hidden');
            } finally {
                form?.setAttribute('aria-busy', 'false');
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.removeAttribute('aria-busy');
                    submitButton.classList.remove('is-saving');
                    submitButton.textContent = submitLabel;
                }
            }
        };

        window.closeAdminLogin = function() {
            const modal = document.getElementById('admin-login-modal');
            closeAccessibleDialog(modal);
        };

        function setDbDrawerOpen(isOpen) {
            const drawer = document.getElementById('db-drawer');
            const icon = document.getElementById('drawer-toggle-icon');
            const innerToggle = document.getElementById('drawer-toggle-btn');
            const outerToggle = document.getElementById('admin-console-btn');
            if (drawer) {
                drawer.classList.toggle('translate-y-full', !isOpen);
                drawer.inert = !isOpen;
                drawer.setAttribute('aria-hidden', String(!isOpen));
            }
            if (icon) icon.className = isOpen ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
            if (innerToggle) {
                innerToggle.setAttribute('aria-expanded', String(isOpen));
                innerToggle.setAttribute('aria-label', isOpen ? 'Close guest database' : 'Open guest database');
            }
            if (outerToggle) {
                outerToggle.setAttribute('aria-expanded', String(isOpen));
                outerToggle.setAttribute('aria-label', isOpen ? 'Close guest database' : 'Open guest database');
            }
        }

        function openDbDrawer() {
            if (!isHostUser()) return;
            setDbDrawerOpen(true);
        }

        window.toggleDbDrawer = function() {
            if (!isHostUser()) {
                const modal = document.getElementById('admin-login-modal');
                openAccessibleDialog(modal);
                return;
            }

            const drawer = document.getElementById('db-drawer');
            if (!drawer) return;

            if (drawer.classList.contains('translate-y-full')) {
                openDbDrawer();
            } else {
                setDbDrawerOpen(false);
                if (document.activeElement?.id === 'drawer-toggle-btn') {
                    document.getElementById('admin-console-btn')?.focus();
                }
            }
        };

        // Countdown Timer Logic
        function startCountdownTimer() {
            const targetTime = new Date(DEBUT_EVENT_CONFIG.dateStr).getTime();
            const eventEndTime = targetTime + DEBUT_EVENT_CONFIG.durationMinutes * 60 * 1000;

            function updateTimer() {
                const now = Date.now();
                const distance = targetTime - now;

                const daysEl = document.getElementById('count-days');
                const hoursEl = document.getElementById('count-hours');
                const minsEl = document.getElementById('count-minutes');
                const secsEl = document.getElementById('count-seconds');
                const endedMsg = document.getElementById('countdown-ended-msg');
                const countdownBox = document.getElementById('countdown-container');

                if (distance <= 0) {
                    if (countdownBox) countdownBox.classList.add('hidden');
                    if (endedMsg) {
                        endedMsg.textContent = now < eventEndTime
                            ? '✨ The Event Has Started! ✨'
                            : '✨ Thank You for Celebrating With Us! ✨';
                        endedMsg.classList.remove('hidden');
                    }
                    if (now >= eventEndTime && countdownInterval) {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                    }
                    return;
                }

                const days = Math.floor(distance / (1000 * 60 * 60 * 24));
                const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);

                setCountdownValue(daysEl, days);
                setCountdownValue(hoursEl, hours);
                setCountdownValue(minsEl, minutes);
                setCountdownValue(secsEl, seconds);
            }

            function syncCountdownTimer() {
                if (document.visibilityState === 'hidden') {
                    if (countdownInterval) clearInterval(countdownInterval);
                    countdownInterval = null;
                    return;
                }

                updateTimer();
                if (Date.now() < eventEndTime && !countdownInterval) {
                    countdownInterval = setInterval(updateTimer, 1000);
                }
            }

            document.addEventListener('visibilitychange', syncCountdownTimer);
            syncCountdownTimer();
        }

        function setCountdownValue(element, value) {
            if (!element) return;
            const nextValue = value.toString().padStart(2, '0');
            if (element.textContent === nextValue) return;

            element.textContent = nextValue;
            element.classList.remove('countdown-flip');
            requestAnimationFrame(() => element.classList.add('countdown-flip'));
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

            const previousStep = Object.values(stepMap)
                .map((id) => document.getElementById(id))
                .find((section) => section && !section.classList.contains('hidden')
                    && section.contains(document.activeElement));
            const envelopeWillOpen = stepNum === 2 && !invitationEnvelopeShown;

            Object.values(stepMap).forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.classList.add('hidden');
                    el.classList.remove('step-enter');
                }
            });

            const targetId = stepMap[stepNum];
            if (targetId) {
                const target = document.getElementById(targetId);
                if (target) {
                    target.classList.remove('hidden');
                    target.classList.add('step-enter');
                    requestAnimationFrame(() => refreshScrollReveals(target));
                    if (previousStep && previousStep !== target && !envelopeWillOpen) {
                        focusStepHeading(target);
                    }
                }
            }

            if (stepNum === 2) showInvitationEnvelope();
            if (typeof window.setPhotoSlideshowActive === 'function') {
                const openingOverlay = document.getElementById('site-opening-overlay');
                window.setPhotoSlideshowActive(stepNum === 2
                    && (!openingOverlay || openingOverlay.classList.contains('hidden')));
            }

            updateMobileStepProgress(stepNum);

            // Personal QR invitations are view-only and should not show registration steps.
            ['step-indicator', 'mobile-step-progress'].forEach((id) => {
                const progress = document.getElementById(id);
                if (!progress) return;
                progress.classList.toggle('invitation-view-progress-hidden', inviteMode);
                progress.setAttribute('aria-hidden', inviteMode ? 'true' : 'false');
            });

            const inviteViewIndicator = document.getElementById('invite-view-indicator');
            if (inviteViewIndicator) {
                inviteViewIndicator.hidden = !inviteMode;
                const onInvitation = document.getElementById('invite-view-invitation');
                const onDetails = document.getElementById('invite-view-details');
                if (onInvitation) onInvitation.setAttribute('aria-current', stepNum === 2 ? 'page' : 'false');
                if (onDetails) onDetails.setAttribute('aria-current', stepNum === 3 ? 'page' : 'false');
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
                        ind.className = "px-3 py-1 rounded-full text-blush-600 font-normal transition";
                    }
                }
            }

            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
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
                    <div class="milestone-name-item flex items-center gap-3 py-2.5 border-b border-blush-100 last:border-0" style="--milestone-index:${index}">
                        <span class="w-7 h-7 rounded-full bg-blush-100 text-blush-700 text-xs font-bold flex items-center justify-center">${index + 1}</span>
                        <span class="text-sm font-medium text-blush-900">${escapeHtml(name)}</span>
                    </div>`).join('');
            } else {
                list.innerHTML = '<p class="text-sm text-center text-blush-600 py-4">Names will be added here once the list is confirmed.</p>';
            }
            openAccessibleDialog(modal);
        };

        window.closeMilestoneModal = function() {
            const modal = document.getElementById('milestone-modal');
            closeAccessibleDialog(modal);
        };

        function normalizeEmail(email) {
            return typeof email === 'string' ? email.trim().toLowerCase() : '';
        }

        function normalizeName(name) {
            return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').toLowerCase() : '';
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
                    match = { ...data, id: docSnap.id };
                }
            });
            return match;
        }

        async function findConfirmedInvitationByEmailAndName(email, name) {
            if (!auth.currentUser) throw new Error('Firebase authentication is not ready.');
            const emailLower = normalizeEmail(email);
            const nameLower = normalizeName(name);
            if (!emailLower || !nameLower) return null;

            const invitesRef = collection(db, 'invites');
            const snapshot = await getDocs(query(invitesRef, where('emailLower', '==', emailLower)));
            let match = null;
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (!match && data.rsvpStatus === 'Confirmed' && normalizeName(data.name) === nameLower) {
                    match = { ...data, id: docSnap.id };
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
                    match = { ...data, id: docSnap.id };
                }
            });
            return match;
        }

        function openInvitationForGuest(inviteId, invite, showReminder = true) {
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
            if (showReminder) {
                const openingOverlay = document.getElementById('site-opening-overlay');
                if (openingOverlay && !openingOverlay.classList.contains('hidden')) {
                    showInvitationReminderAfterEnvelope = true;
                } else {
                    setTimeout(() => openSecretReminder(), 250);
                }
            }
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
            const linkStatus = document.getElementById('recovery-link-status');
            if (emailInput) emailInput.value = prefillEmail;
            if (nameInput) nameInput.value = prefillName;
            errorEl.classList.add('hidden');
            welcome.classList.add('hidden');
            form.classList.remove('hidden');
            actions.classList.add('hidden');
            if (qrWrap) qrWrap.innerHTML = '';
            if (linkStatus) {
                linkStatus.textContent = '';
                linkStatus.classList.add('hidden');
                linkStatus.classList.remove('text-rose-700');
                linkStatus.classList.add('text-emerald-700');
            }
            window.recoveredInvite = null;
            openAccessibleDialog(modal);
        };

        window.closeRecoveryModal = function() {
            const modal = document.getElementById('recovery-modal');
            closeAccessibleDialog(modal);
        };

        window.handleRecovery = async function(e) {
            e.preventDefault();
            const email = document.getElementById('recovery-email').value.trim();
            const name = normalizeSubmittedName(document.getElementById('recovery-name').value);
            const errorEl = document.getElementById('recovery-error');
            const form = document.getElementById('recovery-form');
            if (form.getAttribute('aria-busy') === 'true') return;
            const welcome = document.getElementById('recovery-welcome');
            const actions = document.getElementById('recovery-actions');
            const welcomeName = document.getElementById('recovery-welcome-name');
            const submitButton = form.querySelector('button[type="submit"]');
            const submitLabel = document.getElementById('recovery-submit-label');

            errorEl.classList.add('hidden');
            form.setAttribute('aria-busy', 'true');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.classList.add('is-saving');
                submitButton.setAttribute('aria-busy', 'true');
            }
            if (submitLabel) submitLabel.textContent = 'Searching…';
            try {
                const ready = await waitForFirebaseAuth();
                if (!ready) {
                    errorEl.textContent = 'The RSVP connection is still loading. Please wait a moment and try again.';
                    errorEl.classList.remove('hidden');
                    return;
                }

                const invite = await findConfirmedInvitationByEmailAndName(email, name);
                if (!invite) {
                    errorEl.textContent = 'We could not find a confirmed invitation with those details.';
                    errorEl.classList.remove('hidden');
                    return;
                }
                window.recoveredInvite = { id: invite.id, data: invite };
                welcomeName.textContent = normalizeSubmittedName(invite.name);
                form.classList.add('hidden');
                welcome.classList.remove('hidden');
                actions.classList.remove('hidden');
                renderInvitationQRCode('recovery-qr-wrap', invite.id);
                welcomeName.focus({ preventScroll: true });
            } catch (err) {
                console.error('Invitation recovery failed:', err);
                errorEl.textContent = 'We could not recover your invitation right now. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                form.setAttribute('aria-busy', 'false');
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.classList.remove('is-saving');
                    submitButton.setAttribute('aria-busy', 'false');
                }
                if (submitLabel) submitLabel.textContent = 'Find My Invitation';
            }
        };

        window.saveRecoveredQRCode = function() {
            if (!window.recoveredInvite) return;
            const inviteId = window.recoveredInvite.id;
            try {
                const saved = saveQRCodeFromContainer('recovery-qr-wrap', 'Kylie-18th-Invitation-' + inviteId + '.png');
                setQRCodeSaveStatus('recovery-link-status', saved,
                    saved ? 'Your invitation QR code has been saved 💙' : 'The QR code is not ready yet. Please wait a moment and try again.');
            } catch (error) {
                console.error('Could not save recovered invitation QR:', error);
                setQRCodeSaveStatus('recovery-link-status', false, 'Could not save the QR code. Please try again or long-press the image.');
            }
        };

        window.openRecoveredInvitation = async function() {
            if (!window.recoveredInvite) return;
            const recovered = window.recoveredInvite;
            window.recoveredInvite = null;
            window.closeRecoveryModal();
            openInvitationForGuest(recovered.id, recovered.data, true);
        };

        async function waitForFirebaseAuth(timeoutMs = 10000) {
            if (auth.currentUser) return true;
            const started = Date.now();
            while (!auth.currentUser && Date.now() - started < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            return !!auth.currentUser;
        }

        window.handleRegistration = async function(e) {
            if (e) e.preventDefault();
            const registrationForm = document.getElementById('registration-form');
            if (registrationForm?.getAttribute('aria-busy') === 'true') return false;
            inviteMode = false;
            const inviteNotice = document.getElementById('invite-load-notice');
            if (inviteNotice) inviteNotice.classList.add('hidden');
            const fullNameEl = document.getElementById('reg-fullname');
            const emailEl = document.getElementById('reg-email');
            const showRegistrationNotice = (message) => {
                if (!inviteNotice) {
                    alert(message);
                    return;
                }
                inviteNotice.textContent = message;
                inviteNotice.classList.remove('hidden');
            };
            const submitButton = document.querySelector('#registration-form button[type=\"submit\"]');
            const submitLabel = submitButton?.querySelector('span');
            const originalSubmitLabel = submitLabel?.textContent || 'Unlock My Personalized Invitation';
            const setRegistrationBusy = (isBusy) => {
                registrationForm?.setAttribute('aria-busy', String(isBusy));
                if (!submitButton) return;
                submitButton.disabled = isBusy;
                submitButton.classList.toggle('is-saving', isBusy);
                submitButton.classList.toggle('opacity-70', isBusy);
                submitButton.classList.toggle('cursor-wait', isBusy);
                submitButton.setAttribute('aria-busy', String(isBusy));
                if (submitLabel) {
                    submitLabel.textContent = isBusy ? 'Preparing your invitation…' : originalSubmitLabel;
                }
            };
            const fullName = fullNameEl ? normalizeSubmittedName(fullNameEl.value) : '';
            const email = emailEl ? emailEl.value.trim() : '';
            const guestCount = 1;

            if (fullNameEl) fullNameEl.value = fullName;

            if (!fullName || !email) {
                showRegistrationNotice(!fullName
                    ? 'Please enter your name; spaces alone are not enough.'
                    : 'Please enter your email address.');
                (fullName ? emailEl : fullNameEl)?.focus();
                return false;
            }

            setRegistrationBusy(true);

            try {
                const ready = await waitForFirebaseAuth();
                if (!ready) {
                    showRegistrationNotice('The RSVP connection is still loading. Please wait a moment and try again.');
                    setRegistrationBusy(false);
                    return false;
                }
                const existingInvite = await findInvitationByEmail(email, false);
                if (existingInvite) {
                    if (existingInvite.rsvpStatus === 'Pending'
                        && existingInvite.ownerUid === auth.currentUser.uid) {
                        // The previous save may have reached Firestore even if a weak
                        // mobile connection made the client report a failure. Restore
                        // that guest's own pending record instead of blocking a retry.
                        const restoredName = existingInvite.name || fullName;
                        currentGuest = {
                            id: existingInvite.id,
                            name: restoredName,
                            email: existingInvite.email || email,
                            numGuests: 1,
                            guestNames: [restoredName],
                            rsvpStatus: 'Pending'
                        };
                        populateInvitationView();
                        window.goToStep(2);
                        setRegistrationBusy(false);
                        return false;
                    }

                    if (existingInvite.rsvpStatus === 'Pending') {
                        showRegistrationNotice('This email has a pending registration on another device. Please use that device or contact the host for help.');
                        setRegistrationBusy(false);
                        return false;
                    }

                    showRegistrationNotice('This email has already been registered. Recover the invitation with the same full name and email.');
                    openRecoveryModal(email, fullName);
                    setRegistrationBusy(false);
                    return;
                }

                // Reuse a declined record only when this anonymous account owns it.
                // Firestore rules allow an owner to update their own document, but a
                // different device/session must create a new guest record instead.
                const declinedInvite = await findDeclinedInvitationByEmailAndName(email, fullName);
                if (declinedInvite && declinedInvite.ownerUid === auth.currentUser.uid) {
                    currentGuest = {
                        id: declinedInvite.id,
                        name: declinedInvite.name || fullName,
                        email: declinedInvite.email || email,
                        numGuests: 1,
                        guestNames: [declinedInvite.name || fullName],
                        rsvpStatus: 'Pending',
                        createdAt: declinedInvite.createdAt || new Date().toLocaleString()
                    };

                    populateInvitationView();
                    window.goToStep(2);
                    registrationSavePromise = saveGuestToCloud(currentGuest);
                    try {
                        await registrationSavePromise;
                    } catch (err) {
                        console.error('Could not save the returning guest registration:', err);
                        currentGuest = null;
                        window.goToStep(1);
                        closeInvitationEnvelope('step-registration', true);
                        showRegistrationNotice('We could not save your registration. Check your connection, then try again.');
                        setRegistrationBusy(false);
                        return false;
                    } finally {
                        registrationSavePromise = null;
                    }
                    setRegistrationBusy(false);
                    return;
                }
            } catch (err) {
                console.error('Could not check existing email:', err);
                showRegistrationNotice('We could not verify this email right now. Check your connection, then try again.');
                setRegistrationBusy(false);
                return;
            }

            currentGuest = {
                // Let Firestore generate a collision-resistant ID so one guest cannot
                // accidentally overwrite another guest's RSVP record.
                id: doc(collection(db, 'rsvps')).id,
                name: fullName,
                email: email,
                numGuests: guestCount,
                guestNames: [fullName],
                rsvpStatus: 'Pending',
                createdAt: new Date().toLocaleString()
            };

            try {
                // Show the invitation immediately. Firebase persistence continues in the
                // background so the interface does not feel frozen after registration.
                populateInvitationView();
                window.goToStep(2);
                registrationSavePromise = saveGuestToCloud(currentGuest);
                await registrationSavePromise;
            } catch (err) {
                console.error(err);
                currentGuest = null;
                window.goToStep(1);
                closeInvitationEnvelope('step-registration', true);
                showRegistrationNotice('We could not save your registration. Check your connection, then try again.');
            } finally {
                registrationSavePromise = null;
                setRegistrationBusy(false);
            }
            return false;
        };

        function buildInvitationLink(inviteId) {
            const invitationUrl = new URL(window.location.href);
            invitationUrl.search = '';
            invitationUrl.hash = '';
            invitationUrl.searchParams.set('invite', String(inviteId));
            return invitationUrl.href;
        }

        function getInvitationLink() {
            if (!currentGuest || !currentGuest.id) return window.location.href;
            return buildInvitationLink(currentGuest.id);
        }

        function renderInvitationQRCode(containerId, inviteId) {
            const container = document.getElementById(containerId);
            if (!container) return false;
            container.innerHTML = '';

            const showQrError = (message) => {
                const notice = document.createElement('p');
                notice.className = 'max-w-xs px-4 py-3 text-center text-xs leading-relaxed text-rose-700';
                notice.setAttribute('role', 'status');
                notice.textContent = message;
                container.appendChild(notice);
            };

            if (!inviteId) {
                showQrError('This invitation QR code is unavailable. Please reopen your invitation.');
                return false;
            }
            if (typeof QRCode === 'undefined') {
                showQrError('The QR code could not load. You can still open your personal invitation link.');
                return false;
            }

            const qrHolder = document.createElement('div');
            qrHolder.style.width = '240px';
            qrHolder.style.height = '240px';
            qrHolder.style.display = 'flex';
            qrHolder.style.alignItems = 'center';
            qrHolder.style.justifyContent = 'center';
            container.appendChild(qrHolder);

            try {
                new QRCode(qrHolder, {
                    text: buildInvitationLink(inviteId),
                    width: 240,
                    height: 240,
                    colorDark: '#4A2633',
                    colorLight: '#FFFFFF',
                    correctLevel: QRCode.CorrectLevel.H
                });
            } catch (error) {
                console.error('Could not generate invitation QR code:', error);
                showQrError('The QR code could not be generated. You can still open your personal invitation link.');
                return false;
            }

            // Convert the generated canvas into a normal image so guests can
            // long-press on mobile or right-click/save on desktop.
            setTimeout(() => {
                const canvas = qrHolder.querySelector('canvas');
                if (canvas) {
                    try {
                        const img = document.createElement('img');
                        img.src = canvas.toDataURL('image/png');
                        img.alt = 'Personal invitation QR code';
                        img.draggable = false;
                        qrHolder.innerHTML = '';
                        qrHolder.appendChild(img);
                    } catch (error) {
                        console.warn('Could not convert invitation QR canvas to image:', error);
                    }
                }
            }, 60);

            return true;
        }

        function saveQRCodeFromContainer(containerId, fileName) {
            const container = document.getElementById(containerId);
            if (!container) return false;
            const img = container.querySelector('img');
            const canvas = container.querySelector('canvas');
            let dataUrl = img && img.src ? img.src : null;

            if (!dataUrl && canvas) dataUrl = canvas.toDataURL('image/png');
            if (!dataUrl) return false;

            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = fileName || 'Kylie-18th-Invitation-QR.png';
            document.body.appendChild(link);
            link.click();
            link.remove();
            return true;
        }

        function setQRCodeSaveStatus(statusId, saved, message) {
            const status = document.getElementById(statusId);
            if (!status) return;
            status.textContent = message;
            status.classList.toggle('text-emerald-700', saved);
            status.classList.toggle('text-rose-700', !saved);
            status.classList.remove('hidden');
        }

        window.saveConfirmationQRCode = function() {
            if (!currentGuest || !currentGuest.id) return;
            try {
                const saved = saveQRCodeFromContainer('confirmation-qr-wrap', 'Kylie-18th-Invitation-' + currentGuest.id + '.png');
                setQRCodeSaveStatus('invitation-link-note', saved,
                    saved ? 'Your invitation QR code has been saved 💙' : 'The QR code is not ready yet. Please wait a moment and try again.');
            } catch (error) {
                console.error('Could not save confirmation invitation QR:', error);
                setQRCodeSaveStatus('invitation-link-note', false, 'Could not save the QR code. Please try again or long-press the image.');
            }
        };

        window.openInvitationLink = function() {
            window.open(getInvitationLink(), '_blank', 'noopener,noreferrer');
        };


        // Controls whether the confirmation invitation QR section should appear only after the reminder is acknowledged.
        window.revealInvitationLinksAfterReminder = false;

        // Elegant surprise reminder for saved invitation links and RSVP confirmation.
        window.openSecretReminder = function() {
            const modal = document.getElementById('secret-reminder-modal');
            if (!modal) return;
            openAccessibleDialog(modal);
        };

        window.closeSecretReminder = function() {
            const modal = document.getElementById('secret-reminder-modal');
            if (!modal) return;
            closeAccessibleDialog(modal);

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

        document.addEventListener('keydown', (event) => {
            const topDialog = getTopOpenDialog();
            if (!topDialog) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                topDialog.close();
                return;
            }

            if (event.key !== 'Tab') return;

            const focusableElements = getDialogFocusableElements(topDialog.dialog);
            if (!focusableElements.length) {
                event.preventDefault();
                return;
            }

            const firstFocusable = focusableElements[0];
            const lastFocusable = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement;
            const activeIndex = focusableElements.indexOf(activeElement);
            if (activeIndex === -1) {
                event.preventDefault();
                (event.shiftKey ? lastFocusable : firstFocusable).focus();
            } else if (event.shiftKey && activeIndex === 0) {
                event.preventDefault();
                lastFocusable.focus();
            } else if (!event.shiftKey && activeIndex === focusableElements.length - 1) {
                event.preventDefault();
                firstFocusable.focus();
            }
        }, true);

        async function loadInvitationFromLink() {
            const inviteId = new URLSearchParams(window.location.search).get('invite');
            if (!inviteId) return false;
            if (!auth.currentUser) return false;

            try {
                // Guests read the lightweight invite record. The configured host can
                // read RSVP records, so use that permitted source for host previews.
                const isHost = auth.currentUser.uid === HOST_UID;
                const inviteSnap = await getDoc(doc(db, isHost ? "rsvps" : "invites", inviteId));
                if (!inviteSnap.exists()) {
                    console.warn('Invitation link not found:', inviteId);
                    returnToRegistrationAfterInviteFailure("We couldn't find an invitation for this link. You can recover your invitation below or register again.");
                    return false;
                }

                const invite = inviteSnap.data();
                if (!invite.name || invite.rsvpStatus !== 'Confirmed') {
                    returnToRegistrationAfterInviteFailure("This invitation isn't confirmed yet. You can recover an existing invitation below or register again.");
                    return false;
                }

                // A saved invitation is for a guest who already confirmed attendance.
                // Open it in VIEW-ONLY mode so the guest cannot register/RSVP again.
                await openInvitationForGuest(inviteId, invite, true);
                return true;
            } catch (err) {
                console.error('Could not load invitation link:', err);
                returnToRegistrationAfterInviteFailure("We couldn't load this invitation right now. Please check your connection or recover your invitation below.");
                return false;
            }
        }

        function returnToRegistrationAfterInviteFailure(message) {
            inviteMode = false;
            currentGuest = null;
            const greeting = document.getElementById('invitation-greeting');
            if (greeting) {
                greeting.textContent = 'Dear Guest,';
                greeting.setAttribute('aria-busy', 'false');
            }
            const notice = document.getElementById('invite-load-notice');
            if (notice) {
                notice.textContent = message;
                notice.classList.remove('hidden');
            }
            window.goToStep(1);
            closeInvitationEnvelope('step-registration', true);
        }

        function populateInvitationView() {
            if (!currentGuest) return;
            currentGuest.name = normalizeSubmittedName(currentGuest.name);
            const greeting = document.getElementById('invitation-greeting');
            if (greeting) {
                greeting.textContent = `Dear ${currentGuest.name},`;
                greeting.setAttribute('aria-busy', 'false');
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
                labelYes.classList.add('border-blush-600', 'bg-blush-50', 'is-selected');
                labelNo.classList.remove('border-blush-600', 'bg-blush-50', 'is-selected');
            } else {
                detailsBox.classList.add('hidden');
                labelNo.classList.add('border-blush-600', 'bg-blush-50', 'is-selected');
                labelYes.classList.remove('border-blush-600', 'bg-blush-50', 'is-selected');
            }
        };

        window.handleRsvpSubmit = async function(e) {
            e.preventDefault();
            if (!currentGuest) return;

            const form = e.target;
            if (form.getAttribute('aria-busy') === 'true') return;
            const attendance = form.attendance.value;
            const submitButton = form.querySelector('button[type="submit"]');
            const submitLabel = submitButton ? submitButton.textContent.trim() : '';
            const status = document.getElementById('rsvp-save-status');
            if (status) {
                status.textContent = '';
                status.classList.add('hidden');
            }
            form.setAttribute('aria-busy', 'true');

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.setAttribute('aria-busy', 'true');
                submitButton.classList.add('is-saving');
                submitButton.textContent = 'Saving your RSVP…';
            }

            if (attendance === 'Yes') {
                currentGuest.rsvpStatus = 'Confirmed';
                currentGuest.numGuests = 1;
                currentGuest.guestNames = [currentGuest.name];
            } else {
                currentGuest.rsvpStatus = 'Declined';
                currentGuest.guestNames = [];
            }

            try {
                if (registrationSavePromise) {
                    await registrationSavePromise;
                    registrationSavePromise = null;
                }
                await saveGuestToCloud(currentGuest, currentGuest.rsvpStatus === 'Confirmed');
                if (currentGuest.rsvpStatus === 'Confirmed'
                    && typeof confetti === 'function'
                    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    try {
                        confetti({
                            particleCount: 90,
                            spread: 70,
                            origin: { y: 0.6 },
                            colors: ['#F8A8B9', '#B76E79', '#F7E7CE', '#E84E72']
                        });
                    } catch (motionError) {
                        console.warn('RSVP saved; celebration animation could not start:', motionError);
                    }
                }
                showConfirmationView();
                window.goToStep(5);
                // Show the note first. The invitation-link buttons appear only after "I Understand".
                setTimeout(() => openSecretReminder(), 250);
            } catch (err) {
                console.error(err);
                if (status) {
                    status.textContent = 'We could not save your RSVP. Check your connection, then try again.';
                    status.classList.remove('hidden');
                } else {
                    alert('We could not save your RSVP. Please try again.');
                }
            } finally {
                form.setAttribute('aria-busy', 'false');
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.removeAttribute('aria-busy');
                    submitButton.classList.remove('is-saving');
                    submitButton.textContent = submitLabel;
                }
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
            registrationSavePromise = null;
            invitationEnvelopeShown = false;
            invitationEnvelopeOpening = false;
            showInvitationReminderAfterEnvelope = false;
            document.getElementById('registration-form').reset();
            document.getElementById('rsvp-form').reset();
            document.getElementById('attending-details')?.classList.add('hidden');
            ['opt-label-yes', 'opt-label-no'].forEach((id) => {
                document.getElementById(id)?.classList.remove('border-blush-600', 'bg-blush-50', 'is-selected');
            });
            const rsvpStatus = document.getElementById('rsvp-save-status');
            if (rsvpStatus) {
                rsvpStatus.textContent = '';
                rsvpStatus.classList.add('hidden');
            }
            window.goToStep(1);
        };

        // ------------------------------
        // Event QR check-in scanner
        // ------------------------------
        let qrScanner = null;
        let qrScannerBusy = false;
        let qrScannerSession = 0;
        let qrScannerLibraryPromise = null;

        function loadQrScannerLibrary() {
            if (typeof Html5Qrcode !== 'undefined') return Promise.resolve();
            if (qrScannerLibraryPromise) return qrScannerLibraryPromise;

            qrScannerLibraryPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                // Pin the scanner release so a CDN's moving "latest" alias cannot change behavior.
                script.src = 'https://unpkg.com/html5-qrcode@2.3.8';
                script.async = true;
                script.onload = () => {
                    if (typeof Html5Qrcode !== 'undefined') resolve();
                    else {
                        script.remove();
                        reject(new Error('QR scanner library loaded without its API.'));
                    }
                };
                script.onerror = () => {
                    script.remove();
                    reject(new Error('Could not download QR scanner library.'));
                };
                document.head.appendChild(script);
            }).catch((error) => {
                qrScannerLibraryPromise = null;
                throw error;
            });

            return qrScannerLibraryPromise;
        }

        window.openQrScanner = async function() {
            const modal = document.getElementById('qr-scanner-modal');
            const status = document.getElementById('qr-scan-status');
            const result = document.getElementById('qr-scan-result');
            const retryButton = document.getElementById('qr-scan-retry');
            const reader = document.getElementById('qr-reader');

            if (!isHostUser()) {
                const loginModal = document.getElementById('admin-login-modal');
                openAccessibleDialog(loginModal);
                return;
            }
            if (qrScanner) return;
            if (!modal || !status || !result || !reader) {
                alert('QR scanner is not available. Please refresh the page and try again.');
                return;
            }

            openAccessibleDialog(modal);
            status.textContent = 'Loading scanner…';
            status.className = 'mt-4 text-center text-sm text-blush-800 font-medium';
            status.classList.add('qr-scan-status-loading');
            status.setAttribute('aria-busy', 'true');
            result.classList.add('hidden');
            result.innerHTML = '';
            retryButton?.classList.add('hidden');
            reader.innerHTML = '';
            qrScannerBusy = false;

            const session = ++qrScannerSession;
            try {
                await loadQrScannerLibrary();
            } catch (err) {
                if (qrScannerSession !== session || modal.classList.contains('hidden')) return;
                status.classList.remove('qr-scan-status-loading');
                status.setAttribute('aria-busy', 'false');
                status.textContent = 'QR scanner is unavailable.';
                result.textContent = 'The scanner could not load. Check your connection, then try again.';
                result.className = 'mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-rose-800';
                result.classList.remove('hidden');
                retryButton?.classList.remove('hidden');
                retryButton?.focus({ preventScroll: true });
                return;
            }
            if (qrScannerSession !== session || modal.classList.contains('hidden')) return;

            status.textContent = 'Starting camera…';
            const scannerInstance = new Html5Qrcode('qr-reader');
            qrScanner = scannerInstance;
            const isCurrentSession = () => qrScannerSession === session && qrScanner === scannerInstance;
            const availableReaderWidth = reader.clientWidth;
            const qrBoxSize = availableReaderWidth
                ? Math.max(120, Math.min(240, Math.floor(availableReaderWidth * 0.88)))
                : 240;
            try {
                await scannerInstance.start(
                    { facingMode: 'environment' },
                    { fps: 10, qrbox: { width: qrBoxSize, height: qrBoxSize } },
                    async (decodedText) => {
                        if (!isCurrentSession() || qrScannerBusy) return;
                        qrScannerBusy = true;
                        result.classList.add('hidden');
                        result.innerHTML = '';
                        status.classList.add('qr-scan-status-loading');
                        status.setAttribute('aria-busy', 'true');
                        status.textContent = 'Checking guest…';
                        try {
                            await processScannedGuestQr(decodedText);
                        } finally {
                            if (isCurrentSession()) {
                                status.classList.remove('qr-scan-status-loading');
                                status.setAttribute('aria-busy', 'false');
                                if (status.textContent === 'Checking guest…') {
                                    status.textContent = 'Camera ready. Point it at the guest QR code.';
                                }
                            }
                            setTimeout(() => {
                                if (isCurrentSession()) qrScannerBusy = false;
                            }, 1200);
                        }
                    },
                    () => {}
                );
                if (!isCurrentSession()) {
                    try { await scannerInstance.stop(); } catch (err) {}
                    if (!qrScanner) {
                        try { scannerInstance.clear(); } catch (err) {}
                    }
                    return;
                }
                status.classList.remove('qr-scan-status-loading');
                status.setAttribute('aria-busy', 'false');
                status.textContent = 'Camera ready. Point it at the guest QR code.';
            } catch (err) {
                console.error('QR scanner start failed:', err);
                if (!isCurrentSession()) {
                    if (!qrScanner) {
                        try { scannerInstance.clear(); } catch (clearErr) {}
                    }
                    return;
                }
                status.classList.remove('qr-scan-status-loading');
                status.setAttribute('aria-busy', 'false');
                status.textContent = 'Camera could not start.';
                result.classList.remove('hidden');
                result.className = 'mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-rose-800';
                result.innerHTML = '<div class="font-bold mb-1">Camera Permission Needed</div><div class="text-xs">Allow camera access in your browser, then close and reopen the scanner.</div>';
            }
        };

        window.closeQrScanner = async function() {
            const modal = document.getElementById('qr-scanner-modal');
            const scannerInstance = qrScanner;
            qrScanner = null;
            qrScannerSession += 1;
            if (scannerInstance) {
                try {
                    await scannerInstance.stop();
                } catch (err) {
                    console.warn('QR scanner stop:', err);
                }
                try { scannerInstance.clear(); } catch (err) {}
            }
            qrScannerBusy = false;
            const status = document.getElementById('qr-scan-status');
            document.getElementById('qr-scan-retry')?.classList.add('hidden');
            status?.classList.remove('qr-scan-status-loading');
            status?.setAttribute('aria-busy', 'false');
            closeAccessibleDialog(modal);
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
                const guestRef = doc(db, 'rsvps', inviteId);
                const checkInResult = await runTransaction(db, async (transaction) => {
                    const guestSnap = await transaction.get(guestRef);
                    if (!guestSnap.exists()) return { status: 'missing' };

                    const guest = { ...guestSnap.data(), id: guestSnap.id };
                    if (guest.rsvpStatus !== 'Confirmed') {
                        return { status: 'not-confirmed', guest };
                    }
                    if (guest.checkInStatus === 'Checked In') {
                        return { status: 'already-checked-in', guest };
                    }

                    const checkedInAt = new Date().toLocaleString();
                    transaction.update(guestRef, {
                        checkInStatus: 'Checked In',
                        checkedInAt
                    });
                    return { status: 'checked-in', guest, checkedInAt };
                });

                if (checkInResult.status === 'missing') {
                    showQrScanResult('error', 'Guest Not Found', 'This invitation is not registered in the RSVP database.');
                    return;
                }
                const guest = checkInResult.guest;
                if (checkInResult.status === 'not-confirmed') {
                    showQrScanResult('error', 'Guest Not Confirmed', `${guest.name || 'This guest'} has RSVP status: ${guest.rsvpStatus || 'Unknown'}.`);
                    return;
                }

                if (checkInResult.status === 'already-checked-in') {
                    showQrScanResult('warning', 'Already Checked In', `${guest.name} was already checked in${guest.checkedInAt ? ' at ' + guest.checkedInAt : ''}.`);
                    return;
                }

                const cachedGuest = guestDatabase.find((record) => record.id === guest.id);
                if (cachedGuest) {
                    cachedGuest.checkInStatus = 'Checked In';
                    cachedGuest.checkedInAt = checkInResult.checkedInAt;
                }
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
                const name = typeof g.name === 'string' ? g.name : '';
                const email = typeof g.email === 'string' ? g.email : '';
                const matchesSearch = name.toLowerCase().includes(searchVal) || email.toLowerCase().includes(searchVal);
                const matchesFilter = filterStatus === 'ALL' || g.rsvpStatus === filterStatus;
                return matchesSearch && matchesFilter;
            });

            if (filtered.length === 0) {
                if (emptyMsg) {
                    emptyMsg.classList.toggle('is-loading', guestDatabaseLoading);
                    emptyMsg.textContent = guestDatabaseError
                        ? 'Guest records could not be loaded. Check your connection and host login, then reload the page.'
                        : guestDatabaseLoading
                            ? 'Loading guest records…'
                            : guestDatabase.length === 0
                                ? 'No guest registrations recorded in Firestore yet.'
                                : 'No guest records match this search or filter.';
                    emptyMsg.classList.remove('hidden');
                }
                return;
            } else {
                if (emptyMsg) {
                    emptyMsg.classList.add('hidden');
                    emptyMsg.classList.remove('is-loading');
                }
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

                const guestNames = Array.isArray(guest.guestNames)
                    ? guest.guestNames.filter((name) => typeof name === 'string')
                    : [];
                const namesStr = guestNames.length > 0 ? guestNames.join(', ') : '-';
                const numericGuestCount = Number(guest.numGuests);
                const guestCount = Number.isFinite(numericGuestCount) && numericGuestCount > 0
                    ? Math.floor(numericGuestCount)
                    : 1;

                tr.innerHTML = `
                    <td class="p-3 font-mono text-blush-600">${escapeHtml(guest.id)}</td>
                    <td class="p-3 font-semibold text-blush-900">${escapeHtml(guest.name)}</td>
                    <td class="p-3 text-blush-700">${escapeHtml(guest.email)}</td>
                    <td class="p-3 font-medium">${guestCount}</td>
                    <td class="p-3 text-blush-700 max-w-[150px] truncate" title="${escapeHtml(namesStr)}">${escapeHtml(namesStr)}</td>
                    <td class="p-3">${statusBadge}</td>
                    <td class="p-3">${guest.checkInStatus === 'Checked In'
                        ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800">Checked In</span><div class="text-[9px] mt-1 text-blush-500">${escapeHtml(guest.checkedInAt || '')}</div>`
                        : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">Not Yet</span>`}</td>
                    <td class="p-3 text-[10px] text-blush-600">${escapeHtml(guest.createdAt || '-')}</td>
                `;
                tbody.appendChild(tr);
            });
        };

        window.exportCsv = function() {
            if (!isHostUser()) return;
            if (guestDatabase.length === 0) return;
            const csvCell = (value) => {
                const text = String(value ?? '');
                const spreadsheetSafeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
                return `"${spreadsheetSafeText.replace(/"/g, '""')}"`;
            };
            const rows = [[
                'ID', 'Name', 'Email', 'PartyCount', 'GuestNames', 'RSVPStatus',
                'CheckInStatus', 'CheckedInAt', 'RegisteredAt'
            ]];
            guestDatabase.forEach((g) => {
                const party = Array.isArray(g.guestNames)
                    ? g.guestNames.filter((name) => typeof name === 'string').join('; ')
                    : '';
                const numericGuestCount = Number(g.numGuests);
                const guestCount = Number.isFinite(numericGuestCount) && numericGuestCount > 0
                    ? Math.floor(numericGuestCount)
                    : 1;
                rows.push([
                    g.id, g.name, g.email, guestCount, party, g.rsvpStatus,
                    g.checkInStatus || 'Not Yet', g.checkedInAt || '', g.createdAt || ''
                ]);
            });
            const csvContent = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
            const fileUrl = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement("a");
            link.setAttribute("href", fileUrl);
            link.setAttribute("download", "Kylie_18th_Debut_Guest_List.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
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
            updateButton();
        } catch (e) {
            // Browser autoplay policy may delay playback until another interaction.
            updateButton();
        }
    }

    function updateButton() {
        const icon = toggle.querySelector('i');
        if (!icon) return;
        const isPlaying = !music.paused && !muted;
        const label = toggle.querySelector('#music-toggle-label');
        icon.className = isPlaying
            ? 'fa-solid fa-volume-high'
            : 'fa-solid fa-volume-xmark';
        if (label) label.textContent = isPlaying ? 'Mute music' : 'Play music';
        toggle.setAttribute('aria-pressed', String(isPlaying));
        toggle.setAttribute('aria-label', isPlaying ? 'Mute background music' : 'Play background music');
        toggle.title = isPlaying ? 'Mute music' : 'Play music';
    }

    document.addEventListener('pointerdown', function (event) {
        if (toggle.contains(event.target)) return;
        startMusic();
    }, { passive: true });

    document.addEventListener('keydown', function (event) {
        if (toggle.contains(event.target)) return;
        if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(event.key)) return;
        startMusic();
    });

    toggle.addEventListener('click', function (event) {
        event.stopPropagation();
        if (music.paused) {
            muted = false;
            music.play().then(() => { started = true; updateButton(); }).catch(() => { updateButton(); });
        } else {
            music.pause();
            muted = true;
            updateButton();
        }
    });

    updateButton();
})();
