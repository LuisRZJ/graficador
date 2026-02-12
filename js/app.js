(function () {
    const THEME_COOKIE = 'graficador_theme';
    const THEME_VALUES = new Set(['light', 'dark', 'auto']);
    const THEME_COLOR_DARK = '#020617';
    const THEME_COLOR_LIGHT = '#f8fafc';

    function getCookie(name) {
        const prefix = `${encodeURIComponent(name)}=`;
        return document.cookie
            .split(';')
            .map(v => v.trim())
            .filter(v => v.startsWith(prefix))
            .map(v => decodeURIComponent(v.slice(prefix.length)))[0];
    }

    function setCookie(name, value, days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = `expires=${date.toUTCString()}`;
        document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ${expires}; path=/; SameSite=Lax`;
    }

    function resolveTheme(preference) {
        if (preference === 'auto') {
            const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
            return mql && mql.matches ? 'dark' : 'light';
        }
        return preference;
    }

    function setThemeColorMeta(resolvedTheme) {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        meta.setAttribute('content', resolvedTheme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
    }

    function emitThemeChange(preference) {
        const resolvedTheme = resolveTheme(preference);
        window.dispatchEvent(new CustomEvent('app:themechange', { detail: { preference, resolvedTheme } }));
    }

    function applyThemePreference(preference) {
        const safePreference = THEME_VALUES.has(preference) ? preference : 'auto';
        document.documentElement.setAttribute('data-theme', safePreference);
        setThemeColorMeta(resolveTheme(safePreference));
        emitThemeChange(safePreference);
        return safePreference;
    }

    function getThemePreference() {
        const stored = getCookie(THEME_COOKIE);
        return THEME_VALUES.has(stored) ? stored : 'auto';
    }

    function setThemePreference(preference) {
        const safePreference = THEME_VALUES.has(preference) ? preference : 'auto';
        setCookie(THEME_COOKIE, safePreference, 3650);
        applyThemePreference(safePreference);
    }

    function initTheme() {
        applyThemePreference(getThemePreference());
        const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
        if (!mql) return;

        const handler = () => {
            if (getThemePreference() !== 'auto') return;
            setThemeColorMeta(resolveTheme('auto'));
            emitThemeChange('auto');
        };

        if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler);
        else if (typeof mql.addListener === 'function') mql.addListener(handler);
    }

    function fixFavicon() {
        const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';

        const img = new Image();
        img.src = 'LogoApp.png';
        img.onload = () => {
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);

            const scale = Math.min(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = (size - w) / 2;
            const y = (size - h) / 2;
            ctx.drawImage(img, x, y, w, h);

            link.href = canvas.toDataURL('image/png');
            if (!link.parentNode) document.head.appendChild(link);
        };
    }

    async function checkForUpdates() {
        if (!('serviceWorker' in navigator)) {
            alert('Actualizaciones no disponibles en este navegador.');
            return;
        }
        if (!navigator.onLine) {
            alert('Sin conexión. Se usará la versión offline si está disponible.');
            return;
        }
        try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (!registration) {
                alert('PWA no inicializada. Recarga la página e inténtalo de nuevo.');
                return;
            }

            await registration.update();

            if (registration.waiting) {
                registration.waiting.postMessage('SKIP_WAITING');
                return;
            }

            if (registration.installing) {
                await new Promise((resolve) => {
                    const worker = registration.installing;
                    if (!worker) return resolve();
                    worker.addEventListener('statechange', () => {
                        if (worker.state === 'installed') resolve();
                    });
                });
            }

            if (registration.waiting) {
                registration.waiting.postMessage('SKIP_WAITING');
                return;
            }

            alert('Ya estás en la versión más reciente disponible.');
        } catch {
            alert('No se pudo verificar actualizaciones.');
        }
    }

    window.App = window.App || {};
    window.App.Theme = {
        applyThemePreference,
        getThemePreference,
        resolveTheme,
        setThemePreference
    };
    window.App.PWA = { checkForUpdates };
    window.App.fixFavicon = fixFavicon;

    window.checkForUpdates = checkForUpdates;

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then((registration) => {
                if (!registration) return;
                registration.addEventListener('updatefound', () => {
                    const worker = registration.installing;
                    if (!worker) return;
                    worker.addEventListener('statechange', () => {
                        if (worker.state !== 'installed') return;
                        if (navigator.serviceWorker.controller) {
                            worker.postMessage('SKIP_WAITING');
                        }
                    });
                });
            }).catch(() => {
            });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    }

    initTheme();
    fixFavicon();
})();
