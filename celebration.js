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
    const CLOSING_MS = 8000;

    const root = document.getElementById('cine-root');
    if (!root) return;

    const el = {
        intro: document.getElementById('cine-intro'),
        stage: document.getElementById('cine-stage'),
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
    let particlesBuilt = false;
    let audioUserMuted = false;
    let audioGestureCleanup = null;

    const pad = (n) => String(n).padStart(2, '0');

    function setStatus(message, visible = false) {
        if (!el.status) return;
        el.status.textContent = message || '';
        el.status.classList.toggle('cine-status-visible', Boolean(message) && visible);
    }

    function buildSlides() {
        const frag = document.createDocumentFragment();

        SLIDES.forEach((slide, i) => {
            const wrap = document.createElement('article');
            wrap.className = 'cine-slide';
            wrap.setAttribute('aria-roledescription', 'slide');
            wrap.setAttribute('aria-label', `${i + 1} of ${total}`);
            wrap.setAttribute('aria-hidden', 'true');

            const img = document.createElement('img');
            img.src = slide.src;
            img.alt = slide.alt;
            img.decoding = 'async';
            img.loading = i < 2 ? 'eager' : 'lazy';
            img.addEventListener('error', () => wrap.classList.add('is-missing'));

            const caption = document.createElement('p');
            caption.className = 'cine-caption';
            caption.textContent = slide.caption;

            wrap.append(img, caption);
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

        el.slides.appendChild(frag);
        el.total.textContent = pad(total);
        el.progress.setAttribute('aria-valuemax', String(total));
    }

    function primeImage(i) {
        const node = el.slides.children[i];
        const img = node ? node.querySelector('img') : null;
        if (img && img.loading === 'lazy') img.loading = 'eager';
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

        el.current.textContent = pad(index + 1);
        el.progress.setAttribute('aria-valuenow', String(index + 1));
        el.progress.setAttribute('aria-valuetext', `Slide ${index + 1} of ${total}`);
        el.progressFill.style.width = `${((index + 1) / total) * 100}%`;

        const isClosing = index === total - 1;
        setStatus(isClosing
            ? 'Closing slide: thank you for celebrating.'
            : `Slide ${index + 1} of ${total}${SLIDES[index] ? ': ' + SLIDES[index].caption : ''}`);
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
            if (index >= total - 1) scheduleLoop();
            else schedule();
        } else {
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
        if (index >= total - 1) return; // closing is the last slide
        goTo(index + 1);
    }

    function prev() {
        if (index <= 0) return;
        goTo(index - 1);
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
        index = 0;
        render();
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

    function attemptAudioAutoplay() {
        if (!el.audio || audioUserMuted) return;
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
        if (!el.full) return;
        el.full.setAttribute('aria-pressed', String(isFullscreen));
        el.full.setAttribute('aria-label', isFullscreen ? 'Exit full screen' : 'Enter full screen');
        if (isFullscreen) setStatus('');
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
        const count = window.innerWidth < 640 ? 16 : 28;
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
        clearProgressionTimers();
        clearTimeout(introHideTimer);
        introHideTimer = null;
        el.intro.hidden = false;
        el.intro.classList.remove('is-leaving');
        el.stage.hidden = true;
        el.hud.hidden = true;
        el.controls.hidden = true;
        root.classList.remove('is-playing');
        if (!preserveAudio && el.audio) {
            el.audio.pause();
            updateMusicUi(false);
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
        attemptAudioAutoplay();
        introTimer = window.setTimeout(start, reduceMotion.matches ? 1200 : INTRO_MS);
    }

    function deactivate() {
        if (!active) return;
        active = false;
        clearProgressionTimers();
        clearTimeout(introTimer);
        clearTimeout(introHideTimer);
        clearTimeout(fullscreenTimer);
        introTimer = null;
        introHideTimer = null;
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
        root.classList.remove('is-playing', 'is-music-on');
    }

    buildSlides();
    render();

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
        } else if (active) {
            if (!started) {
                introTimer = window.setTimeout(start, reduceMotion.matches ? 1200 : INTRO_MS);
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
