/* Cinematic birthday presentation — recovered original engine (celebration.js).
   Inline in the invitation page, auto-playing when the Invitation step is shown.
   Photos come from the shared list exposed by script.js (one photo source). */
(() => {
    'use strict';

    const SLIDES = Array.isArray(window.DEBUT_PHOTO_SLIDER_DATA)
        ? window.DEBUT_PHOTO_SLIDER_DATA
        : [];

    const CLOSING = {
        kicker: 'With love and gratitude',
        title: 'Thank You for Celebrating With Me',
        subtitle: 'Kylie’s 18th Birthday'
    };

    const AUTOPLAY_MS = 6500;
    const INTRO_MS = 5000;
    const MONTAGE_MS = 9000;
    const CLOSING_MS = 8000;

    const root = document.getElementById('cine-root');
    if (!root) return;

    const el = {
        intro: document.getElementById('cine-intro'),
        stage: document.getElementById('cine-stage'),
        backdrops: document.getElementById('cine-backdrops'),
        reel: document.getElementById('cine-reel'),
        montage: document.getElementById('cine-montage'),
        montageStrips: document.getElementById('cine-montage-strips'),
        slides: document.getElementById('cine-slides'),
        hud: document.getElementById('cine-hud'),
        controls: document.getElementById('cine-controls'),
        current: document.getElementById('cine-current'),
        total: document.getElementById('cine-total'),
        progress: document.getElementById('cine-progress'),
        progressFill: document.getElementById('cine-progress-fill'),
        play: document.getElementById('cine-play'),
        prev: document.getElementById('cine-prev'),
        next: document.getElementById('cine-next'),
        full: document.getElementById('cine-full'),
        music: document.getElementById('cine-music'),
        status: document.getElementById('cine-status'),
        audio: document.getElementById('cine-audio'),
        particles: document.getElementById('cine-particles')
    };

    if (!el.stage || !el.slides || !SLIDES.length) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const total = SLIDES.length + 1;

    let index = 0;
    let started = false;
    let playing = !reduceMotion.matches;
    let active = false;
    let timer = null;
    let introTimer = null;
    let introHideTimer = null;
    let closingTimer = null;
    let fullscreenTimer = null;
    let montageTimer = null;
    let montageHideTimer = null;
    let montageRemaining = MONTAGE_MS;
    let montageStartedAt = 0;
    let montageActive = false;
    let particlesBuilt = false;
    let audioUserMuted = false;
    let audioGestureCleanup = null;
    let heroFitFrame = null;
    let heroFitResizeTimer = null;
    let backdropHoldTimer = null;
    let previousBackdropIndex = -1;

    const pad = (n) => String(n).padStart(2, '0');

    function setStatus(message, visible = false) {
        if (!el.status) return;
        el.status.textContent = message || '';
        el.status.classList.toggle('cine-status-visible', Boolean(message) && visible);
    }

    function buildSlides() {
        const frag = document.createDocumentFragment();
        const backdropFrag = document.createDocumentFragment();

        SLIDES.forEach((slide, i) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'cine-backdrop';
            backdrop.setAttribute('aria-hidden', 'true');
            const backdropImg = document.createElement('img');
            backdropImg.src = slide.src;
            backdropImg.alt = '';
            backdropImg.decoding = 'async';
            backdropImg.loading = i < 3 ? 'eager' : 'lazy';
            backdrop.appendChild(backdropImg);
            backdropFrag.appendChild(backdrop);

            const wrap = document.createElement('article');
            wrap.className = 'cine-slide';
            wrap.setAttribute('aria-roledescription', 'slide');
            wrap.setAttribute('aria-label', `${i + 1} of ${total}`);
            wrap.setAttribute('aria-hidden', 'true');

            const hero = document.createElement('div');
            hero.className = 'cine-hero';

            const heroReel = document.createElement('div');
            heroReel.className = 'cine-hero-reel';

            const card = document.createElement('figure');
            card.className = 'cine-hero-card';

            const img = document.createElement('img');
            img.alt = slide.alt;
            img.decoding = 'async';
            img.loading = i < 2 ? 'eager' : 'lazy';
            img.addEventListener('error', () => wrap.classList.add('is-missing'));
            img.addEventListener('load', () => {
                if (wrap.classList.contains('is-active')) scheduleHeroFit();
            });
            img.src = slide.src;

            card.appendChild(img);
            heroReel.appendChild(card);

            const edge = document.createElement('span');
            edge.className = 'cine-hero-edge';
            edge.setAttribute('aria-hidden', 'true');
            edge.textContent = 'KODAK 20';
            heroReel.appendChild(edge);

            const caption = document.createElement('p');
            caption.className = 'cine-caption';
            caption.textContent = slide.caption;

            hero.append(heroReel, caption);
            wrap.appendChild(hero);
            frag.appendChild(wrap);
        });

        const closing = document.createElement('article');
        closing.className = 'cine-slide cine-slide--closing';
        closing.setAttribute('aria-roledescription', 'slide');
        closing.setAttribute('aria-label', `${total} of ${total}`);
        closing.setAttribute('aria-hidden', 'true');
        closing.innerHTML = `
            <div class="cine-closing-inner">
                <p class="cine-closing-kicker">${CLOSING.kicker}</p>
                <h2 class="cine-closing-title">${CLOSING.title}</h2>
                <p class="cine-closing-sub">${CLOSING.subtitle}</p>
            </div>`;
        frag.appendChild(closing);

        if (el.backdrops) el.backdrops.appendChild(backdropFrag);
        el.slides.appendChild(frag);
        el.total.textContent = pad(total);
        el.progress.setAttribute('aria-valuemax', String(total));

        buildReel();
        buildMontage();
    }

    function buildReel() {
        if (!el.reel) return;
        const strips = [
            { className: 'cine-reel-strip--left', offset: 0, speed: '92s', reverse: false },
            { className: 'cine-reel-strip--right', offset: 5, speed: '116s', reverse: true },
            { className: 'cine-reel-strip--center', offset: 2, speed: '138s', reverse: false }
        ];

        strips.forEach((config, stripIndex) => {
            const strip = document.createElement('div');
            strip.className = `cine-reel-strip ${config.className}`;
            strip.style.setProperty('--reel-speed', config.speed);
            if (config.reverse) strip.classList.add('is-reverse');

            const track = document.createElement('div');
            track.className = 'cine-reel-track';
            track.style.animationDelay = `${-stripIndex * 19}s`;

            const run = document.createElement('div');
            run.className = 'cine-reel-run';

            for (let i = 0; i < 8; i++) {
                const slide = SLIDES[(config.offset + i) % SLIDES.length];
                const frame = document.createElement('div');
                frame.className = 'cine-reel-frame';
                if ((i + stripIndex) % 5 === 3) frame.classList.add('cine-reel-frame--split');
                if ((i + stripIndex) % 4 === 1) frame.classList.add('is-tall');
                if ((i + stripIndex) % 3 === 2) frame.classList.add('is-short');

                const img = document.createElement('img');
                img.src = slide.src;
                img.alt = '';
                img.decoding = 'async';
                img.loading = 'lazy';
                img.draggable = false;
                frame.appendChild(img);

                if (frame.classList.contains('cine-reel-frame--split')) {
                    const second = SLIDES[(config.offset + i + 4) % SLIDES.length];
                    const img2 = document.createElement('img');
                    img2.src = second.src;
                    img2.alt = '';
                    img2.decoding = 'async';
                    img2.loading = 'lazy';
                    img2.draggable = false;
                    frame.appendChild(img2);
                }

                run.appendChild(frame);
            }

            track.appendChild(run);
            track.appendChild(run.cloneNode(true));
            strip.appendChild(track);
            el.reel.appendChild(strip);
        });
    }

    function buildMontage() {
        if (!el.montageStrips) return;
        const configs = [
            { className: 'a', offset: 0, speed: '46s', reverse: false },
            { className: 'b', offset: 2, speed: '58s', reverse: true },
            { className: 'c', offset: 4, speed: '52s', reverse: false },
            { className: 'd', offset: 6, speed: '64s', reverse: true }
        ];

        configs.forEach((config) => {
            const strip = document.createElement('div');
            strip.className = `cine-montage-strip cine-montage-strip--${config.className}`;
            strip.style.setProperty('--montage-speed', config.speed);
            if (config.reverse) strip.classList.add('is-reverse');

            const track = document.createElement('div');
            track.className = 'cine-montage-track';

            const run = document.createElement('div');
            run.className = 'cine-montage-run';

            SLIDES.slice(0, 8).forEach((slide, i) => {
                const source = SLIDES[(config.offset + i) % SLIDES.length];
                const frame = document.createElement('div');
                frame.className = 'cine-montage-frame';

                const img = document.createElement('img');
                img.src = source.src;
                img.alt = '';
                img.decoding = 'async';
                img.loading = 'eager';
                img.draggable = false;
                frame.appendChild(img);

                run.appendChild(frame);
            });

            track.appendChild(run);
            track.appendChild(run.cloneNode(true));
            strip.appendChild(track);
            el.montageStrips.appendChild(strip);
        });
    }

    function primeBackdrop(i) {
        if (!el.backdrops) return;
        const node = el.backdrops.children[i];
        const img = node ? node.querySelector('img') : null;
        if (!img) return;
        if (img.loading === 'lazy') img.loading = 'eager';
        decodeImage(img);
    }

    function scheduleHeroFit() {
        if (heroFitFrame) cancelAnimationFrame(heroFitFrame);
        heroFitFrame = requestAnimationFrame(() => {
            heroFitFrame = null;
            fitHeroImage(index);
            fitHeroImage(index + 1);
        });
    }

    function scheduleHeroFitOnResize() {
        clearTimeout(heroFitResizeTimer);
        heroFitResizeTimer = window.setTimeout(() => {
            heroFitResizeTimer = null;
            scheduleHeroFit();
        }, 180);
    }

    function fitHeroImage(slideIndex) {
        if (!el.stage || slideIndex < 0 || slideIndex >= total - 1) return;
        const slide = el.slides.children[slideIndex];
        if (!slide) return;
        const hero = slide.querySelector('.cine-hero');
        const img = slide.querySelector('.cine-hero-card img');
        const caption = slide.querySelector('.cine-caption');
        if (!hero || !img) return;

        const rect = el.stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const style = getComputedStyle(hero);
        const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
        const gap = parseFloat(style.rowGap) || 0;
        const captionHeight = caption ? caption.getBoundingClientRect().height : 0;
        const compact = rect.width < 560;
        const frameX = compact ? 24 : 38; // film rail + photo border, per side
        const frameY = compact ? 40 : 52; // top and bottom film rail + border
        const maxW = hero.clientWidth - padX - frameX * 2;
        const maxH = hero.clientHeight - padY - captionHeight - gap - frameY;

        const nextMaxWidth = `${Math.max(120, Math.round(maxW))}px`;
        const nextMaxHeight = `${Math.max(120, Math.round(maxH))}px`;
        if (img.style.maxWidth !== nextMaxWidth) img.style.maxWidth = nextMaxWidth;
        if (img.style.maxHeight !== nextMaxHeight) img.style.maxHeight = nextMaxHeight;
    }

    function decodeImage(img) {
        if (!img || typeof img.decode !== 'function') return;
        try {
            const decoded = img.decode();
            if (decoded && typeof decoded.catch === 'function') decoded.catch(() => {});
        } catch (error) {
            /* decode is best-effort; never block the slideshow */
        }
    }

    function primeImage(i) {
        const node = el.slides.children[i];
        const img = node ? node.querySelector('img') : null;
        if (!img) return;
        if (img.loading === 'lazy') img.loading = 'eager';
        decodeImage(img);
    }

    function render() {
        const nodes = el.slides.children;
        for (let i = 0; i < nodes.length; i++) {
            const isActive = i === index;
            nodes[i].classList.toggle('is-active', isActive);
            nodes[i].setAttribute('aria-hidden', String(!isActive));
        }
        primeImage(index);
        primeImage(index + 1);

        if (el.backdrops) {
            const backdropIndex = Math.min(index, total - 2);
            const backdrops = el.backdrops.children;
            if (backdropIndex !== previousBackdropIndex) {
                const outgoing = previousBackdropIndex;
                previousBackdropIndex = backdropIndex;
                clearTimeout(backdropHoldTimer);
                for (let i = 0; i < backdrops.length; i++) {
                    if (i !== outgoing) backdrops[i].classList.remove('is-previous');
                }
                if (outgoing >= 0 && backdrops[outgoing]) {
                    backdrops[outgoing].classList.add('is-previous');
                }
                backdropHoldTimer = window.setTimeout(() => {
                    backdropHoldTimer = null;
                    if (outgoing >= 0 && backdrops[outgoing]) {
                        backdrops[outgoing].classList.remove('is-previous');
                    }
                }, 1300);
            }
            for (let i = 0; i < backdrops.length; i++) {
                backdrops[i].classList.toggle('is-active', i === backdropIndex);
            }
            primeBackdrop(backdropIndex);
            primeBackdrop(backdropIndex + 1);
        }

        el.current.textContent = pad(index + 1);
        el.progress.setAttribute('aria-valuenow', String(index + 1));
        el.progress.setAttribute('aria-valuetext', `Slide ${index + 1} of ${total}`);
        el.progressFill.style.width = `${((index + 1) / total) * 100}%`;

        const isClosing = index === total - 1;
        setStatus(isClosing
            ? 'Closing slide: thank you for celebrating.'
            : `Slide ${index + 1} of ${total}${SLIDES[index] ? ': ' + SLIDES[index].caption : ''}`);

        scheduleHeroFit();
    }

    function clearProgressionTimers() {
        clearTimeout(timer);
        timer = null;
        clearTimeout(closingTimer);
        closingTimer = null;
    }

    function schedule() {
        clearTimeout(timer);
        timer = null;
        if (montageActive) return;
        if (!active || !started || !playing || document.hidden) return;
        if (index >= total - 1) {
            scheduleLoop();
            return;
        }
        timer = window.setTimeout(() => next(), AUTOPLAY_MS);
    }

    function scheduleLoop() {
        clearTimeout(closingTimer);
        closingTimer = null;
        if (!active || !started || !playing || document.hidden) return;
        if (index < total - 1) return;
        closingTimer = window.setTimeout(loopPresentation, CLOSING_MS);
    }

    function setPlaying(value) {
        playing = value;
        root.classList.toggle('is-playing', value);
        if (el.play) {
            el.play.setAttribute('aria-pressed', String(value));
            el.play.setAttribute('aria-label', value ? 'Pause presentation' : 'Play presentation');
        }
        if (value) {
            if (montageActive) scheduleMontageEnd();
            else if (index >= total - 1) scheduleLoop();
            else schedule();
        } else {
            if (montageActive) pauseMontageTimer();
            clearTimeout(timer);
            timer = null;
            clearTimeout(closingTimer);
            closingTimer = null;
        }
    }

    function goTo(nextIndex) {
        clearProgressionTimers();
        index = ((nextIndex % total) + total) % total;
        render();
        schedule();
    }

    function next() {
        if (montageActive) {
            endMontage();
            return;
        }
        if (index >= total - 1) return; // closing is the last slide
        goTo(index + 1);
    }

    function prev() {
        if (montageActive) return;
        if (index <= 0) return;
        goTo(index - 1);
    }

    function scheduleMontageEnd() {
        clearTimeout(montageTimer);
        montageTimer = null;
        if (!active || !started || !playing || !montageActive || document.hidden) return;
        montageStartedAt = performance.now();
        montageTimer = window.setTimeout(() => {
            montageTimer = null;
            endMontage();
        }, Math.max(0, montageRemaining));
    }

    function pauseMontageTimer() {
        if (!montageTimer) return;
        montageRemaining = Math.max(0, montageRemaining - (performance.now() - montageStartedAt));
        clearTimeout(montageTimer);
        montageTimer = null;
    }

    function startMontage() {
        if (!el.montage) return;
        montageActive = true;
        montageRemaining = MONTAGE_MS;
        clearTimeout(montageTimer);
        clearTimeout(montageHideTimer);
        montageTimer = null;
        montageHideTimer = null;
        el.montage.hidden = false;
        el.montage.classList.remove('is-leaving');
        root.classList.add('is-montage');
        setStatus('Film montage: every frame, a memory.');
    }

    function endMontage() {
        if (!montageActive) return;
        montageActive = false;
        montageRemaining = 0;
        clearTimeout(montageTimer);
        montageTimer = null;
        root.classList.remove('is-montage');
        if (el.montage) {
            el.montage.classList.add('is-leaving');
            clearTimeout(montageHideTimer);
            montageHideTimer = window.setTimeout(() => {
                if (!el.montage) return;
                el.montage.hidden = true;
                el.montage.classList.remove('is-leaving');
            }, reduceMotion.matches ? 0 : 1100);
        }
        index = 0;
        render();
        if (playing) schedule();
    }

    function start() {
        if (!active || started) return;
        started = true;
        clearTimeout(introTimer);
        clearTimeout(closingTimer);
        closingTimer = null;
        el.intro.classList.add('is-leaving');
        clearTimeout(introHideTimer);
        introHideTimer = window.setTimeout(() => { el.intro.hidden = true; }, reduceMotion.matches ? 0 : 950);
        el.stage.hidden = false;
        el.hud.hidden = false;
        el.controls.hidden = false;
        root.classList.add('is-started');
        index = 0;
        render();
        startMontage();
        setPlaying(!reduceMotion.matches);
    }

    function loopPresentation() {
        if (!active) return;
        clearProgressionTimers();
        resetToIntro(true);
        clearTimeout(introTimer);
        setStatus('Replaying the presentation.');
        introTimer = window.setTimeout(start, reduceMotion.matches ? 1200 : INTRO_MS);
    }

    function updateMusicUi(isOn) {
        if (!el.music) return;
        root.classList.toggle('is-music-on', isOn);
        el.music.setAttribute('aria-pressed', String(isOn));
        el.music.setAttribute('aria-label', isOn ? 'Mute background music' : 'Play background music');
    }

    function cleanupAudioGestureListeners() {
        if (!audioGestureCleanup) return;
        const cleanup = audioGestureCleanup;
        audioGestureCleanup = null;
        cleanup();
    }

    function registerAudioGestureListeners() {
        if (!el.audio || audioGestureCleanup) return;
        const events = ['pointerdown', 'touchend', 'keydown'];
        const handler = (event) => {
            if (audioUserMuted) {
                cleanup();
                return;
            }
            const target = event && event.target;
            if (target && typeof target.closest === 'function' && target.closest('#cine-music')) {
                cleanup();
                return;
            }
            const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
            if (event.type === 'keydown'
                && (['input', 'textarea', 'select'].includes(tag) || target?.isContentEditable)) {
                return;
            }
            void startAudio();
        };
        const cleanup = () => {
            events.forEach((name) => document.removeEventListener(name, handler, true));
            audioGestureCleanup = null;
        };
        events.forEach((name) => document.addEventListener(name, handler, { capture: true, once: true }));
        audioGestureCleanup = cleanup;
    }

    async function startAudio() {
        if (!el.audio || audioUserMuted) return false;
        if (getFullscreenElement() !== root) return false;
        try {
            el.audio.volume = 0.35;
            await el.audio.play();
            updateMusicUi(true);
            cleanupAudioGestureListeners();
            return true;
        } catch (error) {
            return false;
        }
    }

    function pauseAudioOutsideFullscreen() {
        if (!el.audio) return;
        if (!el.audio.paused) el.audio.pause();
        updateMusicUi(false);
        cleanupAudioGestureListeners();
    }

    function syncAudioWithFullscreen() {
        if (!active) return;
        if (getFullscreenElement() === root) attemptAudioAutoplay();
        else pauseAudioOutsideFullscreen();
    }

    function attemptAudioAutoplay() {
        if (!el.audio || audioUserMuted) return;
        if (getFullscreenElement() !== root) {
            pauseAudioOutsideFullscreen();
            return;
        }
        if (!el.audio.paused) {
            updateMusicUi(true);
            cleanupAudioGestureListeners();
            return;
        }
        startAudio().then((ok) => {
            if (!ok) registerAudioGestureListeners();
        });
    }

    async function toggleMusic() {
        if (!el.audio) return;
        if (el.audio.paused) {
            if (getFullscreenElement() !== root) {
                setStatus('Background music plays in full screen.', true);
                return;
            }
            audioUserMuted = false;
            const ok = await startAudio();
            if (ok) setStatus('Background music on.');
            else setStatus('Background music could not start in this browser.', true);
            return;
        }
        audioUserMuted = true;
        cleanupAudioGestureListeners();
        el.audio.pause();
        updateMusicUi(false);
        setStatus('Background music paused.');
    }

    function getFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function describeError(error) {
        if (error && (error.name || error.message)) {
            return [error.name, error.message].filter(Boolean).join(': ');
        }
        return 'Unknown error';
    }

    function syncFullscreenState() {
        clearTimeout(fullscreenTimer);
        const isFullscreen = getFullscreenElement() === root;
        const docEl = document.documentElement;
        root.classList.toggle('is-fullscreen', isFullscreen);
        docEl.classList.toggle('cine-fullscreen-active', isFullscreen);
        docEl.classList.remove('cine-fullscreen-pending');
        if (el.full) {
            el.full.setAttribute('aria-pressed', String(isFullscreen));
            el.full.setAttribute('aria-label', isFullscreen ? 'Exit full screen' : 'Enter full screen');
            if (isFullscreen) setStatus('');
        }
        scheduleHeroFit();
        syncAudioWithFullscreen();
    }

    function fullscreenContextHint() {
        if (window.self !== window.top) {
            return 'This presentation is running inside an embedded preview frame; open the invitation URL in a top-level browser tab to use fullscreen.';
        }
        if (!window.isSecureContext) {
            return 'Fullscreen requires a secure context (HTTPS or localhost).';
        }
        if (document.visibilityState === 'hidden' || !document.hasFocus()) {
            return 'Focus the browser tab or window and try again.';
        }
        return 'Open the site in a normal browser tab and try again.';
    }

    function failFullscreen(error) {
        clearTimeout(fullscreenTimer);
        document.documentElement.classList.remove('cine-fullscreen-pending', 'cine-fullscreen-active');
        setStatus(`Full screen could not start (${describeError(error)}). ${fullscreenContextHint()}`, true);
        console.error('Full screen request failed:', error);
    }

    function toggleFullscreen() {
        const requestMethod = root.requestFullscreen || root.webkitRequestFullscreen;
        const exitMethod = document.exitFullscreen || document.webkitExitFullscreen;
        const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled;
        if (!requestMethod) {
            failFullscreen(new Error('Fullscreen API is not available'));
            return;
        }
        if (enabled === false) {
            failFullscreen(new Error('Fullscreen is disabled or blocked in this browser context'));
            return;
        }
        if (getFullscreenElement() === root) {
            try {
                const exit = exitMethod && exitMethod.call(document);
                if (exit && typeof exit.catch === 'function') exit.catch(failFullscreen);
            } catch (error) {
                failFullscreen(error);
            }
            return;
        }
        // A retained transform on #step-invitation (from stepReveal) creates a
        // containing block. Neutralise ancestors before requesting fullscreen and
        // force a style flush so the neutralisation is active for the request.
        document.documentElement.classList.add('cine-fullscreen-pending');
        void root.offsetWidth;
        clearTimeout(fullscreenTimer);
        fullscreenTimer = window.setTimeout(() => {
            if (getFullscreenElement() === root) return;
            document.documentElement.classList.remove('cine-fullscreen-pending');
            const reasons = [];
            if (window.self !== window.top) reasons.push('the page is inside an embedded preview frame');
            if (!window.isSecureContext) reasons.push('the address is not a secure context (HTTPS or localhost is required)');
            if (document.visibilityState === 'hidden' || !document.hasFocus()) reasons.push('the browser tab is not focused or visible');
            const reason = reasons.length ? reasons.join('; ') : 'the browser did not grant fullscreen';
            setStatus(`Full screen did not start (${reason}). Open the site in a normal browser tab and try again.`, true);
        }, 2500);

        let request;
        try {
            request = requestMethod.call(root);
        } catch (error) {
            failFullscreen(error);
            return;
        }
        if (request && typeof request.then === 'function') {
            request.then(() => {
                clearTimeout(fullscreenTimer);
                document.documentElement.classList.remove('cine-fullscreen-pending');
                document.documentElement.classList.add('cine-fullscreen-active');
                setStatus('');
            }).catch(failFullscreen);
        }
    }

    function spawnParticles() {
        if (!el.particles || reduceMotion.matches || particlesBuilt) return;
        particlesBuilt = true;
        const count = window.innerWidth < 1024 ? 14 : 24;
        for (let i = 0; i < count; i++) {
            const dot = document.createElement('span');
            dot.className = 'cine-particle';
            dot.style.left = `${Math.random() * 100}%`;
            dot.style.animationDuration = `${8 + Math.random() * 10}s`;
            dot.style.animationDelay = `${Math.random() * 10}s`;
            dot.style.setProperty('--cine-drift', `${(Math.random() - 0.5) * 120}px`);
            const size = 2 + Math.random() * 4;
            dot.style.width = `${size}px`;
            dot.style.height = `${size}px`;
            el.particles.appendChild(dot);
        }
    }

    function resetToIntro(preserveAudio = false) {
        started = false;
        index = 0;
        montageActive = false;
        montageRemaining = MONTAGE_MS;
        clearProgressionTimers();
        clearTimeout(montageTimer);
        clearTimeout(montageHideTimer);
        montageTimer = null;
        montageHideTimer = null;
        clearTimeout(backdropHoldTimer);
        backdropHoldTimer = null;
        previousBackdropIndex = -1;
        clearTimeout(heroFitResizeTimer);
        heroFitResizeTimer = null;
        if (el.backdrops) {
            for (let i = 0; i < el.backdrops.children.length; i++) {
                el.backdrops.children[i].classList.remove('is-previous');
            }
        }
        if (el.montage) {
            el.montage.hidden = true;
            el.montage.classList.remove('is-leaving');
        }
        root.classList.remove('is-montage');
        root.classList.remove('is-started');
        clearTimeout(introHideTimer);
        introHideTimer = null;
        el.intro.hidden = false;
        el.intro.classList.remove('is-leaving');
        el.stage.hidden = true;
        el.hud.hidden = true;
        el.controls.hidden = true;
        root.classList.remove('is-playing');
        if (el.audio && (!preserveAudio || getFullscreenElement() !== root)) {
            el.audio.pause();
            updateMusicUi(false);
            cleanupAudioGestureListeners();
        }
        render();
    }

    function activate() {
        if (active) return;
        active = true;
        resetToIntro();
        spawnParticles();
        clearTimeout(introTimer);
        setStatus('Presentation starting.');
        syncAudioWithFullscreen();
        introTimer = window.setTimeout(start, reduceMotion.matches ? 1200 : INTRO_MS);
    }

    function deactivate() {
        if (!active) return;
        active = false;
        clearProgressionTimers();
        clearTimeout(introTimer);
        clearTimeout(introHideTimer);
        clearTimeout(fullscreenTimer);
        clearTimeout(montageTimer);
        clearTimeout(montageHideTimer);
        introTimer = null;
        introHideTimer = null;
        montageTimer = null;
        montageHideTimer = null;
        montageActive = false;
        montageRemaining = MONTAGE_MS;
        clearTimeout(backdropHoldTimer);
        backdropHoldTimer = null;
        previousBackdropIndex = -1;
        clearTimeout(heroFitResizeTimer);
        heroFitResizeTimer = null;
        if (el.backdrops) {
            for (let i = 0; i < el.backdrops.children.length; i++) {
                el.backdrops.children[i].classList.remove('is-previous');
            }
        }
        if (el.montage) {
            el.montage.hidden = true;
            el.montage.classList.remove('is-leaving');
        }
        root.classList.remove('is-montage');
        cleanupAudioGestureListeners();
        if (getFullscreenElement() === root) {
            const exitMethod = document.exitFullscreen || document.webkitExitFullscreen;
            if (exitMethod) {
                try {
                    const exit = exitMethod.call(document);
                    if (exit && typeof exit.catch === 'function') exit.catch(() => {});
                } catch (error) { /* ignore */ }
            }
        }
        if (el.audio) el.audio.pause();
        updateMusicUi(false);
        started = false;
        document.documentElement.classList.remove('cine-fullscreen-pending', 'cine-fullscreen-active');
        root.classList.remove('is-playing', 'is-music-on', 'is-started');
    }

    buildSlides();
    render();

    window.addEventListener('resize', scheduleHeroFitOnResize);
    window.addEventListener('orientationchange', scheduleHeroFitOnResize);

    if (el.prev) el.prev.addEventListener('click', prev);
    el.next.addEventListener('click', next);
    el.play.addEventListener('click', () => setPlaying(!playing));
    el.music.addEventListener('click', toggleMusic);
    el.full.addEventListener('click', toggleFullscreen);

    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);

    // Kept for compatibility with the invitation flow's activation hook.
    window.setCinematicPresentationActive = function (isActive) {
        if (isActive) activate();
        else deactivate();
    };

    document.addEventListener('keydown', (event) => {
        if (!active) return;
        const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
        if (['input', 'textarea', 'select'].includes(tag) || event.target?.isContentEditable) return;
        if (!started) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                start();
            }
            return;
        }
        switch (event.key) {
            case 'ArrowRight':
                event.preventDefault();
                next();
                break;
            case 'ArrowLeft':
                event.preventDefault();
                prev();
                break;
            case ' ':
            case 'Spacebar':
                if (tag === 'button') return;
                event.preventDefault();
                setPlaying(!playing);
                break;
            case 'f':
            case 'F':
                event.preventDefault();
                toggleFullscreen();
                break;
            case 'm':
            case 'M':
                event.preventDefault();
                toggleMusic();
                break;
            default:
                break;
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearTimeout(timer);
            timer = null;
            clearTimeout(closingTimer);
            closingTimer = null;
            clearTimeout(introTimer);
            introTimer = null;
            pauseMontageTimer();
        } else if (active) {
            if (!started) {
                introTimer = window.setTimeout(start, reduceMotion.matches ? 1200 : INTRO_MS);
            } else if (montageActive) {
                if (playing) scheduleMontageEnd();
            } else if (playing) {
                if (index >= total - 1) scheduleLoop();
                else schedule();
            }
        }
    });

    if (reduceMotion.addEventListener) {
        reduceMotion.addEventListener('change', (event) => {
            if (event.matches) {
                setPlaying(false);
            }
        });
    }
})();
