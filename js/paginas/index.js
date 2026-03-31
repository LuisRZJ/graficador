const panelWrapper = document.getElementById('panel-wrapper');
const dragHandle = document.getElementById('drag-handle');
const handleIcon = document.getElementById('handle-icon');
let startY, startHeight;

dragHandle.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    startHeight = panelWrapper.offsetHeight;
    panelWrapper.classList.remove('smooth-resize');
}, { passive: false });

dragHandle.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const deltaY = e.touches[0].clientY - startY;
    let newHeight = startHeight + deltaY;
    if (newHeight >= 0 && newHeight <= window.innerHeight * 0.85) {
        panelWrapper.style.height = `${newHeight}px`;
        resizeCanvas();
    }
}, { passive: false });

dragHandle.addEventListener('touchend', () => {
    panelWrapper.classList.add('smooth-resize');
    const currentHeight = panelWrapper.offsetHeight;
    if (currentHeight < window.innerHeight * 0.2) {
        panelWrapper.style.height = '0px';
        handleIcon.style.transform = 'rotate(180deg)';
    } else {
        if (currentHeight < window.innerHeight * 0.35) panelWrapper.style.height = '40%';
        handleIcon.style.transform = 'rotate(0deg)';
    }
    setTimeout(resizeCanvas, 305);
});

dragHandle.addEventListener('click', () => {
    panelWrapper.classList.add('smooth-resize');
    if (panelWrapper.offsetHeight < 50) {
        panelWrapper.style.height = '40%';
        handleIcon.style.transform = 'rotate(0deg)';
    }
    setTimeout(resizeCanvas, 305);
});

const canvas = document.getElementById('graphCanvas');
const ctx = canvas.getContext('2d');

let state = {
    scale: 40,
    offsetX: 0,
    offsetY: 0,
    isDraggingCanvas: false,
    draggingElementId: null,
    lastMouseX: 0,
    lastMouseY: 0
};

let elements = [
    { id: 1, type: 'function', content: 'sin(x)', color: '#3b82f6', visible: true },
    { id: 2, type: 'text', content: 'Zona Compra', x: 2, y: 1.5, color: '#10b981', visible: true }
];

const EPS = 1e-3;
const PAN_SENSITIVITY = 0.6;

const DRAW_DEBOUNCE_MS = 70;
let pendingDrawTimeoutId = 0;
let pendingDrawFrameId = 0;

const SESSION_STORAGE_KEY = 'graficador.session.v1';
const SESSION_SAVE_DEBOUNCE_MS = 250;
let pendingSessionSaveId = 0;

function scheduleSessionSave() {
    if (pendingSessionSaveId) window.clearTimeout(pendingSessionSaveId);
    pendingSessionSaveId = window.setTimeout(() => {
        pendingSessionSaveId = 0;
        saveSessionState();
    }, SESSION_SAVE_DEBOUNCE_MS);
}

function serializeElementsForSession(list) {
    if (!Array.isArray(list)) return [];
    const allowedTypes = new Set(['function', 'text']);
    return list
        .filter((el) => el && typeof el === 'object' && allowedTypes.has(el.type))
        .slice(0, 250)
        .map((el) => {
            const base = {
                id: typeof el.id === 'number' ? el.id : Date.now(),
                type: el.type,
                content: String(el.content ?? ''),
                color: /^#[0-9a-fA-F]{6}$/.test(String(el.color || '')) ? el.color : '#3b82f6',
                visible: el.visible !== false
            };
            if (el.type === 'text') {
                const x = Number(el.x);
                const y = Number(el.y);
                base.x = isFinite(x) ? x : 0;
                base.y = isFinite(y) ? y : 0;
            }
            return base;
        });
}

function saveSessionState() {
    try {
        const payload = {
            v: 1,
            savedAt: Date.now(),
            state: {
                scale: state.scale,
                offsetX: state.offsetX,
                offsetY: state.offsetY
            },
            elements: serializeElementsForSession(elements)
        };
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
    } catch {
    }
}

function restoreSessionState() {
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || data.v !== 1) return false;

        const restoredElements = serializeElementsForSession(data.elements);
        const restoredState = data.state && typeof data.state === 'object' ? data.state : null;
        const restoredScale = restoredState ? Number(restoredState.scale) : NaN;
        const restoredOffsetX = restoredState ? Number(restoredState.offsetX) : NaN;
        const restoredOffsetY = restoredState ? Number(restoredState.offsetY) : NaN;

        if (Array.isArray(data.elements)) elements = restoredElements;

        if (isFinite(restoredScale)) state.scale = clamp(restoredScale, 0.5, 5000);
        if (isFinite(restoredOffsetX)) state.offsetX = restoredOffsetX;
        if (isFinite(restoredOffsetY)) state.offsetY = restoredOffsetY;

        return true;
    } catch {
        return false;
    }
}

function scheduleDrawDebounced() {
    if (pendingDrawTimeoutId) window.clearTimeout(pendingDrawTimeoutId);
    pendingDrawTimeoutId = window.setTimeout(() => {
        pendingDrawTimeoutId = 0;
        draw();
    }, DRAW_DEBOUNCE_MS);
    scheduleSessionSave();
}

function scheduleDrawFrame() {
    if (pendingDrawFrameId) return;
    pendingDrawFrameId = window.requestAnimationFrame(() => {
        pendingDrawFrameId = 0;
        draw();
    });
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function hslToHex(h, s, l) {
    const hh = ((h % 360) + 360) % 360;
    const ss = clamp(s, 0, 100) / 100;
    const ll = clamp(l, 0, 100) / 100;

    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = ll - c / 2;

    let r = 0, g = 0, b = 0;
    if (hh < 60) { r = c; g = x; b = 0; }
    else if (hh < 120) { r = x; g = c; b = 0; }
    else if (hh < 180) { r = 0; g = c; b = x; }
    else if (hh < 240) { r = 0; g = x; b = c; }
    else if (hh < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex) {
    const value = String(hex || '').trim();
    const match = /^#([0-9a-fA-F]{6})$/.exec(value);
    if (!match) return null;
    const int = parseInt(match[1], 16);
    return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255
    };
}

function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 'rgba(59,130,246,0.3)';
    const a = clamp(alpha, 0, 1);
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

function srgbToLinear(channel) {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(l1, l2) {
    const L1 = Math.max(l1, l2);
    const L2 = Math.min(l1, l2);
    return (L1 + 0.05) / (L2 + 0.05);
}

function pickTextColor(bgHex) {
    const rgb = hexToRgb(bgHex);
    if (!rgb) return '#ffffff';
    const bgLum = relativeLuminance(rgb);
    const whiteLum = 1;
    const blackLum = 0;
    const contrastWhite = contrastRatio(bgLum, whiteLum);
    const contrastBlack = contrastRatio(bgLum, blackLum);
    return contrastBlack >= contrastWhite ? '#0f172a' : '#ffffff';
}

let colorHue = 210;
function getNextDistinctColor() {
    const used = new Set(elements.map(e => String(e.color || '').toLowerCase()));
    for (let attempt = 0; attempt < 80; attempt++) {
        colorHue = (colorHue + 137.508) % 360;
        const hex = hslToHex(colorHue, 85, 55).toLowerCase();
        if (!used.has(hex)) return hex;
    }
    return hslToHex((Math.random() * 360) | 0, 85, 55);
}

function getResolvedTheme() {
    const preference = document.documentElement.getAttribute('data-theme') || 'auto';
    if (preference === 'dark' || preference === 'light') return preference;
    const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    return mql && mql.matches ? 'dark' : 'light';
}

function getThemePalette() {
    const resolvedTheme = getResolvedTheme();
    if (resolvedTheme === 'light') {
        return {
            bg: '#f8fafc',
            gridMinor: '#e2e8f0',
            gridMajor: '#cbd5e1',
            axis: '#334155',
            label: '#0f172a'
        };
    }
    return {
        bg: '#020617',
        gridMinor: '#1e293b',
        gridMajor: '#334155',
        axis: '#94a3b8',
        label: '#cbd5e1'
    };
}

function normalizeInput(raw) {
    const lines = String(raw || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .map(line => line.replace(/\/\/.*$/g, '').trim())
        .filter(Boolean);
    return lines.join(' ')
        .replace(/π/g, 'pi')
        .replace(/θ/g, 'theta')
        .replace(/≤/g, '<=')
        .replace(/≥/g, '>=')
        .replace(/∈/g, 'in')
        .replace(/²/g, '^2')
        .replace(/³/g, '^3')
        .replace(/[–—]/g, '-')
        .trim();
}

function expandSum(expr) {
    let out = expr;
    const pattern = /sum_\{n=([^}]+)\}\^\{([^}]+)\}\s*/i;
    let match = pattern.exec(out);
    while (match) {
        const start = match.index;
        const after = start + match[0].length;
        const openParenIndex = out.indexOf('(', after);
        if (openParenIndex === -1) break;
        let depth = 0;
        let end = -1;
        for (let i = openParenIndex; i < out.length; i++) {
            const ch = out[i];
            if (ch === '(') depth++;
            if (ch === ')') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        if (end === -1) break;
        const inner = out.slice(openParenIndex + 1, end);
        const startExpr = match[1].trim();
        const endExpr = match[2].trim();
        const replacement = `(function(){let __sum=0;for(let n=${startExpr};n<=${endExpr};n++){__sum+=(${inner});}return __sum;})()`;
        out = out.slice(0, start) + replacement + out.slice(end + 1);
        match = pattern.exec(out);
    }
    return out;
}

function preprocessExpression(expr) {
    let s = normalizeInput(expr);
    s = expandSum(s);
    s = s.replace(/\bln\b/gi, 'log');
    s = s.replace(/\bsgn\b/gi, 'sign');
    s = s.replace(/\^/g, '**');
    return s;
}

function createEvaluator(expression, variables) {
    const prepared = preprocessExpression(expression);
    const fn = new Function(...variables, 'sum', 'pi', 'e', 'eps', `
        const { sin, cos, tan, asin, acos, atan, sqrt, log, exp, abs, max, min, floor, ceil, pow, sign } = Math;
        return ${prepared};
    `);
    return (vars) => fn(...variables.map((v) => vars[v]), sumHelper, Math.PI, Math.E, EPS);
}

function sumHelper(n, start, end, exprFn) {
    let total = 0;
    for (let i = start; i <= end; i++) {
        total += exprFn(i, n);
    }
    return total;
}

function evalLiteral(expr) {
    try {
        const fn = createEvaluator(expr, []);
        return fn({});
    } catch {
        return NaN;
    }
}

function parseRange(input, varName) {
    const text = normalizeInput(input);
    const regex = new RegExp(`${varName}\\s*(?:in)\\s*\\[\\s*([^\\],]+)\\s*,\\s*([^\\]]+)\\s*\\]`, 'i');
    const match = regex.exec(text);
    if (!match) return null;
    return [match[1].trim(), match[2].trim()];
}

function parsePiecewise(input) {
    const match = /\{([\s\S]+)\}/.exec(input);
    if (!match) return null;
    const body = match[1];
    const parts = body.split(';').map(part => part.trim()).filter(Boolean);
    const pieces = parts.map(part => {
        const split = part.split(/,\s*if\s*/i);
        const expr = split[0] ? split[0].trim() : '';
        const condition = split[1] ? split[1].trim() : null;
        if (!expr) return null;
        return { expr, condition };
    }).filter(Boolean);
    return pieces.length ? pieces : null;
}

function parseParametric(input) {
    const text = normalizeInput(input);
    const stop = String.raw`(?=,|;|\bx\s*[\(]?(?:t|theta)?\s*[\)]?\s*=|\by\s*[\(]?(?:t|theta)?\s*[\)]?\s*=|\bt\s*in\b|\btheta\s*in\b|$)`;
    // Accept both "x = expr" and "x(t) = expr" / "x(θ) = expr"
    const xMatch = new RegExp(String.raw`\bx\s*(?:\(\s*(?:t|theta)\s*\))?\s*=\s*(.+?)${stop}`, 'i').exec(text);
    const yMatch = new RegExp(String.raw`\by\s*(?:\(\s*(?:t|theta)\s*\))?\s*=\s*(.+?)${stop}`, 'i').exec(text);
    if (!xMatch || !yMatch) return null;
    const range = parseRange(text, 't') || parseRange(text, 'theta');
    const tMinExpr = range ? range[0] : '-10';
    const tMaxExpr = range ? range[1] : '10';
    const tMin = evalLiteral(tMinExpr);
    const tMax = evalLiteral(tMaxExpr);
    return {
        type: 'parametric',
        xExpr: xMatch[1].trim(),
        yExpr: yMatch[1].trim(),
        tMin,
        tMax
    };
}

function parsePolar(input) {
    const text = normalizeInput(input);
    const rMatch = /\br\s*=\s*([^,;]+)/i.exec(text);
    if (!rMatch) return null;
    const range = parseRange(text, 'theta') || parseRange(text, 't');
    const thetaMinExpr = range ? range[0] : '0';
    const thetaMaxExpr = range ? range[1] : '2*pi';
    const thetaMin = evalLiteral(thetaMinExpr);
    const thetaMax = evalLiteral(thetaMaxExpr);
    return {
        type: 'polar',
        rExpr: rMatch[1].trim(),
        thetaMin,
        thetaMax
    };
}

function parseConic(input) {
    const text = normalizeInput(input);

    const circleMatch = /^\s*x\s*\^\s*2\s*\+\s*y\s*\^\s*2\s*=\s*(.+)\s*$/i.exec(text);
    if (circleMatch) {
        const r2 = evalLiteral(circleMatch[1].trim());
        if (isFinite(r2) && r2 > 0) {
            const r = Math.sqrt(r2);
            return {
                type: 'segments',
                segments: [{ type: 'parametric', xExpr: `(${r})*cos(t)`, yExpr: `(${r})*sin(t)`, tMin: 0, tMax: Math.PI * 2 }]
            };
        }
    }

    const ellipseMatch = /^\s*\(?\s*x\s*\^\s*2\s*\/\s*([^+]+?)\s*\)?\s*\+\s*\(?\s*y\s*\^\s*2\s*\/\s*([^=]+?)\s*\)?\s*=\s*1\s*$/i.exec(text);
    if (ellipseMatch) {
        const aDen = evalLiteral(ellipseMatch[1].replace(/[()]/g, '').trim());
        const bDen = evalLiteral(ellipseMatch[2].replace(/[()]/g, '').trim());
        if (isFinite(aDen) && isFinite(bDen) && aDen > 0 && bDen > 0) {
            const a = Math.sqrt(aDen);
            const b = Math.sqrt(bDen);
            return {
                type: 'segments',
                segments: [{ type: 'parametric', xExpr: `(${a})*cos(t)`, yExpr: `(${b})*sin(t)`, tMin: 0, tMax: Math.PI * 2 }]
            };
        }
    }

    const hyperMatch = /^\s*x\s*\^\s*2(?:\s*\/\s*([^\-]+?))?\s*-\s*y\s*\^\s*2(?:\s*\/\s*([^=]+?))?\s*=\s*1\s*$/i.exec(text);
    if (hyperMatch) {
        const aDen = hyperMatch[1] ? evalLiteral(hyperMatch[1].replace(/[()]/g, '').trim()) : 1;
        const bDen = hyperMatch[2] ? evalLiteral(hyperMatch[2].replace(/[()]/g, '').trim()) : 1;
        if (isFinite(aDen) && isFinite(bDen) && aDen > 0 && bDen > 0) {
            const a = Math.sqrt(aDen);
            const b = Math.sqrt(bDen);
            const tMin = -3;
            const tMax = 3;
            const cosh = '(exp(t)+exp(-t))/2';
            const sinh = '(exp(t)-exp(-t))/2';
            return {
                type: 'segments',
                segments: [
                    { type: 'parametric', xExpr: `(${a})*(${cosh})`, yExpr: `(${b})*(${sinh})`, tMin, tMax },
                    { type: 'parametric', xExpr: `-(${a})*(${cosh})`, yExpr: `(${b})*(${sinh})`, tMin, tMax }
                ]
            };
        }
    }

    return null;
}

function parseImplicit(input) {
    const text = normalizeInput(input);
    if (/^\s*r\s*=/.test(text)) return null;
    if (!text.includes('=')) return null;
    const eqIndex = text.indexOf('=');
    const left = text.slice(0, eqIndex).trim();
    const right = text.slice(eqIndex + 1).trim();
    if (!left || !right) return null;

    // If both sides are free of x and y, this is not a planar equation
    const hasXY = (s) => /\bx\b/i.test(s) || /\by\b/i.test(s);
    if (!hasXY(left) && !hasXY(right)) return null;

    const isLeftJustY = /^y$/i.test(left.replace(/\s+/g, ''));
    if (isLeftJustY && !/\by\b/i.test(right)) return null;
    return { type: 'implicit', expr: `(${left})-(${right})` };
}

function parseRegion(input) {
    const text = normalizeInput(input);
    if (!text.includes('(x,y):')) return null;
    const blocks = [...text.matchAll(/\{\(x,y\):([^}]+)\}/g)];
    if (!blocks.length) return null;
    const rects = [];
    for (const block of blocks) {
        const conditions = block[1].split(',').map(part => part.trim()).filter(Boolean);
        let xMin = -Infinity;
        let xMax = Infinity;
        let yMin = -Infinity;
        let yMax = Infinity;
        for (const cond of conditions) {
            const rangeMatch = /([^<>=]+)<=\s*([xy])\s*<=([^<>=]+)/i.exec(cond);
            if (rangeMatch) {
                const a = evalLiteral(rangeMatch[1].trim());
                const variable = rangeMatch[2].toLowerCase();
                const b = evalLiteral(rangeMatch[3].trim());
                if (variable === 'x') { xMin = a; xMax = b; }
                if (variable === 'y') { yMin = a; yMax = b; }
                continue;
            }
            const lowerMatch = /([xy])\s*>=\s*([^<>=]+)/i.exec(cond);
            if (lowerMatch) {
                const variable = lowerMatch[1].toLowerCase();
                const a = evalLiteral(lowerMatch[2].trim());
                if (variable === 'x') xMin = a; else yMin = a;
                continue;
            }
            const upperMatch = /([xy])\s*<=\s*([^<>=]+)/i.exec(cond);
            if (upperMatch) {
                const variable = upperMatch[1].toLowerCase();
                const b = evalLiteral(upperMatch[2].trim());
                if (variable === 'x') xMax = b; else yMax = b;
            }
        }
        if (isFinite(xMin) && isFinite(xMax) && isFinite(yMin) && isFinite(yMax)) {
            rects.push({ xMin, xMax, yMin, yMax });
        }
    }
    return rects.length ? { type: 'region', rects } : null;
}

function parseSegments(input) {
    const text = normalizeInput(input);
    const parts = text.split(';').map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const segments = [];
    for (const part of parts) {
        const piece = part.includes(':') ? part.split(':').slice(1).join(':').trim() : part;
        const parsed = parseParametric(piece);
        if (parsed) segments.push(parsed);
    }
    return segments.length ? { type: 'segments', segments } : null;
}

function compileExpression(input) {
    const text = normalizeInput(input);
    if (!text) return { type: 'invalid' };
    const region = parseRegion(text);
    if (region) return region;
    const segments = parseSegments(text);
    if (segments) {
        return {
            type: 'segments',
            segments: segments.segments.map(segment => ({
                type: 'parametric',
                xFn: createEvaluator(segment.xExpr, ['t']),
                yFn: createEvaluator(segment.yExpr, ['t']),
                tMin: segment.tMin,
                tMax: segment.tMax
            }))
        };
    }
    const polar = parsePolar(text);
    if (polar) {
        return {
            type: 'polar',
            rFn: createEvaluator(polar.rExpr, ['theta']),
            thetaMin: polar.thetaMin,
            thetaMax: polar.thetaMax
        };
    }
    const parametric = parseParametric(text);
    if (parametric) {
        return {
            type: 'parametric',
            xFn: createEvaluator(parametric.xExpr, ['t']),
            yFn: createEvaluator(parametric.yExpr, ['t']),
            tMin: parametric.tMin,
            tMax: parametric.tMax
        };
    }

    const conic = parseConic(text);
    if (conic) {
        return {
            type: 'segments',
            segments: conic.segments.map(segment => ({
                type: 'parametric',
                xFn: createEvaluator(segment.xExpr, ['t']),
                yFn: createEvaluator(segment.yExpr, ['t']),
                tMin: segment.tMin,
                tMax: segment.tMax
            }))
        };
    }
    const implicit = parseImplicit(text);
    if (implicit) {
        return {
            type: 'implicit',
            fn: createEvaluator(implicit.expr, ['x', 'y'])
        };
    }

    let expr = text.replace(/^\s*y\s*=\s*/i, '').trim();
    const piecewise = parsePiecewise(expr);
    if (piecewise) {
        const compiled = piecewise.map(piece => ({
            exprFn: createEvaluator(piece.expr, ['x']),
            condFn: piece.condition ? createEvaluator(piece.condition, ['x']) : null
        }));
        return {
            type: 'function',
            fn: (x) => {
                for (const part of compiled) {
                    if (!part.condFn || part.condFn({ x })) return part.exprFn({ x });
                }
                return NaN;
            }
        };
    }
    const fn = createEvaluator(expr, ['x']);
    return { type: 'function', fn: (x) => fn({ x }) };
}

function init() {
    initThemeSettings();
    resizeCanvas(false);
    restoreSessionState();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('pagehide', saveSessionState);
    renderElementsList();

    window.addEventListener('app:themechange', () => {
        draw();
    });

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleZoom, { passive: false });

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleMouseUp);

    draw();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => draw());
    }
}

const SHOW_AXIS_COORDS_KEY = 'graficador.showAxisCoords.v1';
const SHOW_REF_COORDS_KEY = 'graficador.showRefCoords.v1';
const SHOW_REF_POINTS_KEY = 'graficador.showRefPoints.v1';
let showAxisCoords = false;
let showRefCoords = false;
let showRefPoints = false;

function loadBoolKey(key) {
    try { return sessionStorage.getItem(key) === 'true'; } catch { return false; }
}
function saveBoolKey(key, val) {
    try { sessionStorage.setItem(key, val ? 'true' : 'false'); } catch {}
}

window.onShowAxisCoordsChange = (checked) => {
    showAxisCoords = !!checked;
    saveBoolKey(SHOW_AXIS_COORDS_KEY, showAxisCoords);
    scheduleDrawFrame();
};
window.onShowRefCoordsChange = (checked) => {
    showRefCoords = !!checked;
    saveBoolKey(SHOW_REF_COORDS_KEY, showRefCoords);
    scheduleDrawFrame();
};
window.onShowRefPointsChange = (checked) => {
    showRefPoints = !!checked;
    saveBoolKey(SHOW_REF_POINTS_KEY, showRefPoints);
    scheduleDrawFrame();
};

function initThemeSettings() {
    const inputs = Array.from(document.querySelectorAll('input[name="theme-preference"]'));
    if (inputs.length === 0) return;

    const currentPreference = (window.App && window.App.Theme && window.App.Theme.getThemePreference)
        ? window.App.Theme.getThemePreference()
        : 'auto';

    for (const input of inputs) {
        input.checked = input.value === currentPreference;
        input.addEventListener('change', () => {
            if (!input.checked) return;
            if (!window.App || !window.App.Theme || !window.App.Theme.setThemePreference) return;
            window.App.Theme.setThemePreference(input.value);
        });
    }

    showAxisCoords = loadBoolKey(SHOW_AXIS_COORDS_KEY);
    showRefCoords = loadBoolKey(SHOW_REF_COORDS_KEY);
    showRefPoints = loadBoolKey(SHOW_REF_POINTS_KEY);
    const axisCheckbox = document.getElementById('show-axis-coords');
    if (axisCheckbox) axisCheckbox.checked = showAxisCoords;
    const refCheckbox = document.getElementById('show-ref-coords');
    if (refCheckbox) refCheckbox.checked = showRefCoords;
    const refPointsCheckbox = document.getElementById('show-ref-points');
    if (refPointsCheckbox) refPointsCheckbox.checked = showRefPoints;
}

function resizeCanvas(shouldDraw = true) {
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    if (state.offsetX === 0 && state.offsetY === 0 && canvas.width > 0) {
        state.offsetX = canvas.width / 2;
        state.offsetY = canvas.height / 2;
    }
    if (shouldDraw !== false) draw();
}

window.resetView = () => {
    state.scale = 40;
    state.offsetX = canvas.width / 2;
    state.offsetY = canvas.height / 2;
    draw();
    scheduleSessionSave();
};

window.confirmClear = () => {
    document.getElementById('confirm-modal').classList.remove('hidden');
};

window.executeClear = () => {
    elements = [];
    renderElementsList();
    draw();
    closeModal('confirm-modal');
    addElement('function');
    scheduleSessionSave();
};

window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

window.addElement = (type) => {
    closeModal('type-selector-modal');
    const nextColor = getNextDistinctColor();
    if (type === 'function') {
        elements.push({ id: Date.now(), type: 'function', content: '', color: nextColor, visible: true });
    } else {
        const centerX = screenToWorldX(canvas.width / 2);
        const centerY = (state.offsetY - (canvas.height / 2)) / state.scale;
        elements.push({ id: Date.now(), type: 'text', content: 'Etiqueta', x: centerX, y: centerY, color: nextColor, visible: true });
    }
    renderElementsList();
    draw();
    scheduleSessionSave();
};

function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const clickedText = elements.find(el => {
        if (el.type !== 'text' || !el.visible) return false;
        const sx = worldToScreenX(el.x);
        const sy = worldToScreenY(el.y);
        const width = ctx.measureText(el.content).width + 24;
        return (mx >= sx && mx <= sx + width && my >= sy - 14 && my <= sy + 14);
    });

    if (clickedText) {
        state.draggingElementId = clickedText.id;
        canvas.style.cursor = 'move';
    } else {
        state.isDraggingCanvas = true;
        canvas.style.cursor = 'grabbing';
    }
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
}

function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    document.getElementById('coord-x').textContent = screenToWorldX(mx).toFixed(2);
    document.getElementById('coord-y').textContent = ((state.offsetY - my) / state.scale).toFixed(2);

    if (state.draggingElementId !== null) {
        const elIndex = elements.findIndex(e => e.id === state.draggingElementId);
        if (elIndex !== -1) {
            elements[elIndex].x = screenToWorldX(mx);
            elements[elIndex].y = (state.offsetY - my) / state.scale;
            scheduleDrawFrame();
        }
        return;
    }

    if (state.isDraggingCanvas) {
        const rawDx = e.clientX - state.lastMouseX;
        const rawDy = e.clientY - state.lastMouseY;
        const dx = clamp(rawDx, -80, 80) * PAN_SENSITIVITY;
        const dy = clamp(rawDy, -80, 80) * PAN_SENSITIVITY;
        state.offsetX += dx;
        state.offsetY += dy;
        scheduleDrawFrame();
    }
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
}

function handleMouseUp() {
    state.isDraggingCanvas = false;
    state.draggingElementId = null;
    canvas.style.cursor = 'crosshair';
    scheduleSessionSave();
}

function handleTouchStart(e) {
    const touch = e.touches[0];
    handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
}
function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function handleZoom(e) {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = screenToWorldX(mouseX);
    const worldY = (state.offsetY - mouseY) / state.scale;

    if (e.deltaY < 0) state.scale *= (1 + zoomIntensity);
    else state.scale *= (1 - zoomIntensity);

    state.scale = Math.max(0.5, Math.min(state.scale, 5000));
    state.offsetX = mouseX - (worldX * state.scale);
    state.offsetY = mouseY + (worldY * state.scale);
    scheduleDrawFrame();
    scheduleSessionSave();
}

let implicitRenderToken = 0;
let implicitRenderFrameId = 0;
let implicitCanvas = null;
let implicitCtx = null;
let implicitJobs = [];
let implicitTextElements = [];
let implicitMarkerElements = [];

function cancelImplicitRender() {
    implicitRenderToken += 1;
    if (implicitRenderFrameId) {
        window.cancelAnimationFrame(implicitRenderFrameId);
        implicitRenderFrameId = 0;
    }
    implicitJobs = [];
}

function ensureImplicitCanvas() {
    if (!implicitCanvas) {
        implicitCanvas = document.createElement('canvas');
        implicitCtx = implicitCanvas.getContext('2d');
    }
    if (implicitCanvas.width !== canvas.width) implicitCanvas.width = canvas.width;
    if (implicitCanvas.height !== canvas.height) implicitCanvas.height = canvas.height;
    implicitCtx.clearRect(0, 0, implicitCanvas.width, implicitCanvas.height);
}

function createImplicitJob(compiled, color) {
    const fn = compiled.fn;
    const stepPx = state.scale < 20 ? 2 : state.scale < 50 ? 3 : 4;
    const stepWorld = stepPx / state.scale;
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    const minY = screenToWorldY(canvas.height);
    const maxY = screenToWorldY(0);
    return {
        fn,
        color,
        stepWorld,
        minX,
        maxX,
        minY,
        maxY,
        x: minX,
        y: minY
    };
}

function advanceImplicitJob(job) {
    job.y += job.stepWorld;
    if (job.y >= job.maxY) {
        job.y = job.minY;
        job.x += job.stepWorld;
    }
    return job.x < job.maxX;
}

function runImplicitRender(token) {
    if (token !== implicitRenderToken) return;
    if (!implicitJobs.length) return;

    const start = performance.now();
    const budgetMs = 10;
    while (implicitJobs.length && (performance.now() - start) < budgetMs) {
        const job = implicitJobs[0];
        implicitCtx.strokeStyle = job.color;
        implicitCtx.lineWidth = 1.5;
        implicitCtx.beginPath();
        let iterations = 0;
        while ((performance.now() - start) < budgetMs && iterations < 2500) {
            if (job.x >= job.maxX) break;
            const x = job.x;
            const y = job.y;
            const s = job.stepWorld;

            let f00 = NaN;
            let f10 = NaN;
            let f01 = NaN;
            let f11 = NaN;
            try {
                f00 = job.fn({ x, y });
                f10 = job.fn({ x: x + s, y });
                f01 = job.fn({ x, y: y + s });
                f11 = job.fn({ x: x + s, y: y + s });
            } catch {
                advanceImplicitJob(job);
                iterations += 1;
                continue;
            }
            if (![f00, f10, f01, f11].every(isFinite)) {
                advanceImplicitJob(job);
                iterations += 1;
                continue;
            }

            const points = [];
            if (f00 * f10 < 0) points.push(interpolateEdge(x, y, x + s, y, f00, f10));
            if (f10 * f11 < 0) points.push(interpolateEdge(x + s, y, x + s, y + s, f10, f11));
            if (f01 * f11 < 0) points.push(interpolateEdge(x, y + s, x + s, y + s, f01, f11));
            if (f00 * f01 < 0) points.push(interpolateEdge(x, y, x, y + s, f00, f01));

            if (points.length === 2) {
                implicitCtx.moveTo(worldToScreenX(points[0].x), worldToScreenY(points[0].y));
                implicitCtx.lineTo(worldToScreenX(points[1].x), worldToScreenY(points[1].y));
            } else if (points.length === 4) {
                implicitCtx.moveTo(worldToScreenX(points[0].x), worldToScreenY(points[0].y));
                implicitCtx.lineTo(worldToScreenX(points[1].x), worldToScreenY(points[1].y));
                implicitCtx.moveTo(worldToScreenX(points[2].x), worldToScreenY(points[2].y));
                implicitCtx.lineTo(worldToScreenX(points[3].x), worldToScreenY(points[3].y));
            }

            advanceImplicitJob(job);
            iterations += 1;
        }
        implicitCtx.stroke();
        if (job.x >= job.maxX) implicitJobs.shift();
    }

    ctx.drawImage(implicitCanvas, 0, 0);
    implicitTextElements.forEach(drawTextMarker);
    implicitMarkerElements.forEach(({ intersections, color }) => drawIntersectionMarkers(intersections, color));

    if (!implicitJobs.length) {
        implicitRenderFrameId = 0;
        return;
    }
    implicitRenderFrameId = window.requestAnimationFrame(() => runImplicitRender(token));
}

function draw() {
    cancelImplicitRender();
    const palette = getThemePalette();
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const step = calculateStep(state.scale);
    drawGrid(step);
    drawAxes(step);

    const implicitQueue = [];
    elements.filter(e => e.type === 'function' && e.visible).forEach((el) => drawGraphElement(el, implicitQueue));
    const textEls = elements.filter(e => e.type === 'text' && e.visible);

    elements.filter(e => e.type === 'function' && e.visible).forEach((el) => {
        if (!el.content.trim()) return;
        const compiled = getCompiledElement(el);
        if (!compiled) return;
        if (compiled.type === 'function') {
            drawIntersectionMarkers(findCartesianIntersections(compiled.fn), el.color);
            drawKeyReferencePoints(compiled.fn, el.color);
        } else if (compiled.type === 'parametric' || compiled.type === 'segments') {
            drawIntersectionMarkers(findParametricAxisIntersections(compiled), el.color);
        } else if (compiled.type === 'polar') {
            drawIntersectionMarkers(findPolarAxisIntersections(compiled), el.color);
        }
    });

    textEls.forEach(drawTextMarker);

    if (implicitQueue.length) {
        ensureImplicitCanvas();
        implicitJobs = implicitQueue.map(({ compiled, color }) => createImplicitJob(compiled, color));
        implicitTextElements = textEls;
        implicitMarkerElements = implicitQueue.map(({ compiled, color }) => ({
            intersections: findImplicitAxisIntersections(compiled.fn),
            color
        }));
        const token = implicitRenderToken;
        implicitRenderFrameId = window.requestAnimationFrame(() => runImplicitRender(token));
    }
}

function getCompiledElement(el) {
    if (!el._compiled || el._compiled.source !== el.content) {
        try {
            el._compiled = { source: el.content, data: compileExpression(el.content) };
        } catch {
            el._compiled = { source: el.content, data: { type: 'invalid' } };
        }
    }
    return el._compiled.data;
}

function drawGraphElement(el, implicitQueue) {
    if (!el.content.trim()) return;
    const compiled = getCompiledElement(el);
    if (!compiled || compiled.type === 'invalid') return;
    if (compiled.type === 'function') return drawCartesianFunction(compiled, el.color);
    if (compiled.type === 'parametric') return drawParametric(compiled, el.color);
    if (compiled.type === 'polar') return drawPolar(compiled, el.color);
    if (compiled.type === 'implicit') {
        if (Array.isArray(implicitQueue)) implicitQueue.push({ compiled, color: el.color });
        return;
    }
    if (compiled.type === 'segments') return compiled.segments.forEach(segment => drawParametric(segment, el.color));
    if (compiled.type === 'region') return drawRegion(compiled, el.color);
}

function drawCartesianFunction(compiled, color) {
    const fn = compiled.fn;
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    let isDrawing = false;
    let lastScreenY = null;
    for (let px = 0; px < canvas.width; px += 2) {
        const worldX = screenToWorldX(px);
        let worldY = NaN;
        try { worldY = fn(worldX); } catch { worldY = NaN; }
        if (!isFinite(worldY)) { isDrawing = false; lastScreenY = null; continue; }
        const screenY = worldToScreenY(worldY);
        if (lastScreenY !== null && Math.abs(screenY - lastScreenY) > canvas.height) {
            isDrawing = false; ctx.stroke(); ctx.beginPath();
        }
        if (!isDrawing) { ctx.moveTo(px, screenY); isDrawing = true; }
        else { ctx.lineTo(px, screenY); }
        lastScreenY = screenY;
    }
    ctx.stroke();
}

function bisect(fn, a, b, fa, fb) {
    for (let iter = 0; iter < 60; iter++) {
        const mid = (a + b) / 2;
        let fm;
        try { fm = fn(mid); } catch { return null; }
        if (!isFinite(fm)) return null;
        if (Math.abs(b - a) < 1e-10) return mid;
        if (fa * fm <= 0) { b = mid; fb = fm; }
        else { a = mid; fa = fm; }
    }
    return (a + b) / 2;
}

function findCartesianIntersections(fn) {
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    const SAMPLES = 600;
    const step = (maxX - minX) / SAMPLES;
    const MAX_ROOTS = 15;
    const xIntercepts = [];

    // Pre-sample all values
    const xs = new Float64Array(SAMPLES + 1);
    const ys = new Float64Array(SAMPLES + 1);
    for (let i = 0; i <= SAMPLES; i++) {
        xs[i] = minX + i * step;
        try { ys[i] = fn(xs[i]); } catch { ys[i] = NaN; }
    }

    // Pass 1: sign-change roots (odd multiplicity)
    for (let i = 0; i < SAMPLES && xIntercepts.length < MAX_ROOTS; i++) {
        if (!isFinite(ys[i]) || !isFinite(ys[i + 1])) continue;
        if (ys[i] * ys[i + 1] >= 0) continue;
        const root = bisect(fn, xs[i], xs[i + 1], ys[i], ys[i + 1]);
        if (root === null || !isFinite(root)) continue;
        if (!xIntercepts.some(p => Math.abs(p.x - root) < step * 0.5)) {
            xIntercepts.push({ x: root, y: 0, tangent: false });
        }
    }

    // Pass 2: tangent zeros (even multiplicity — touches but does not cross)
    // Condition: local minimum of |f| where the minimum is much smaller than
    // its neighbors (scale-invariant: aym*8 < ayl+ayr).
    for (let i = 1; i < SAMPLES && xIntercepts.length < MAX_ROOTS; i++) {
        const ayl = Math.abs(ys[i - 1]);
        const aym = Math.abs(ys[i]);
        const ayr = Math.abs(ys[i + 1]);
        if (!isFinite(ayl) || !isFinite(aym) || !isFinite(ayr)) continue;
        if (aym >= ayl || aym >= ayr) continue;       // not a local min
        if (aym * 8 >= ayl + ayr) continue;           // not sharp enough
        if (xIntercepts.some(p => Math.abs(p.x - xs[i]) < step * 2)) continue;
        // Parabolic interpolation to refine x
        const denom = ayl - 2 * aym + ayr;
        const xTouch = Math.abs(denom) > 1e-30
            ? xs[i] - step * (ayr - ayl) / (2 * denom)
            : xs[i];
        xIntercepts.push({ x: xTouch, y: 0, tangent: true });
    }

    let yIntercept = null;
    const originScreenX = worldToScreenX(0);
    if (originScreenX >= 0 && originScreenX <= canvas.width) {
        try {
            const yVal = fn(0);
            if (isFinite(yVal)) yIntercept = { x: 0, y: yVal };
        } catch {}
    }

    return { xIntercepts, yIntercept };
}

function findParametricAxisIntersections(compiled) {
    const segs = compiled.type === 'segments' ? compiled.segments
               : compiled.type === 'parametric' ? [compiled]
               : [];
    const allPoints = [];
    const SAMPLES = 500;
    const DEDUP = 1e-3;

    for (const seg of segs) {
        if (!seg.xFn || !seg.yFn || !isFinite(seg.tMin) || !isFinite(seg.tMax)) continue;
        const { xFn, yFn, tMin, tMax } = seg;
        const dt = (tMax - tMin) / SAMPLES;
        let prevT = tMin;
        let prevX, prevY;
        try { prevX = xFn({ t: tMin }); prevY = yFn({ t: tMin }); } catch { continue; }
        if (!isFinite(prevX)) prevX = NaN;
        if (!isFinite(prevY)) prevY = NaN;

        const AX_EPS = 1e-9;

        // Check start/end boundary points that land exactly on an axis
        const checkBoundaryPoint = (bx, by) => {
            if (!isFinite(bx) || !isFinite(by)) return;
            if (Math.abs(by) <= AX_EPS && !allPoints.some(p => Math.abs(p.x - bx) < DEDUP && Math.abs(p.y) < DEDUP))
                allPoints.push({ x: bx, y: 0, tangent: false });
            if (Math.abs(bx) <= AX_EPS && !allPoints.some(p => Math.abs(p.x) < DEDUP && Math.abs(p.y - by) < DEDUP))
                allPoints.push({ x: 0, y: by, tangent: false });
        };
        checkBoundaryPoint(prevX, prevY);        // tMin

        for (let i = 1; i <= SAMPLES; i++) {
            const t = tMin + i * dt;
            let cx, cy;
            try { cx = xFn({ t }); cy = yFn({ t }); } catch { cx = NaN; cy = NaN; }

            // X-axis crossing: y changes sign
            if (isFinite(prevY) && isFinite(cy) && prevY * cy < 0) {
                const tRoot = bisect((tt) => yFn({ t: tt }), prevT, t, prevY, cy);
                if (tRoot !== null) {
                    let rx;
                    try { rx = xFn({ t: tRoot }); } catch { rx = NaN; }
                    if (isFinite(rx) && !allPoints.some(p => Math.abs(p.x - rx) < DEDUP && Math.abs(p.y) < DEDUP)) {
                        allPoints.push({ x: rx, y: 0, tangent: false });
                    }
                }
            }

            // Y-axis crossing: x changes sign
            if (isFinite(prevX) && isFinite(cx) && prevX * cx < 0) {
                const tRoot = bisect((tt) => xFn({ t: tt }), prevT, t, prevX, cx);
                if (tRoot !== null) {
                    let ry;
                    try { ry = yFn({ t: tRoot }); } catch { ry = NaN; }
                    if (isFinite(ry) && !allPoints.some(p => Math.abs(p.x) < DEDUP && Math.abs(p.y - ry) < DEDUP)) {
                        allPoints.push({ x: 0, y: ry, tangent: false });
                    }
                }
            }

            prevT = t; prevX = cx; prevY = cy;
        }

        // tMax boundary
        checkBoundaryPoint(prevX, prevY);
    }
    return { xIntercepts: allPoints, yIntercept: null };
}

function findPolarAxisIntersections(compiled) {
    const { rFn, thetaMin, thetaMax } = compiled;
    if (!isFinite(thetaMin) || !isFinite(thetaMax)) return { xIntercepts: [], yIntercept: null };
    const SAMPLES = 500;
    const DEDUP = 1e-3;
    const dt = (thetaMax - thetaMin) / SAMPLES;
    const allPoints = [];

    const xAt = (theta) => { try { const r = rFn({ theta }); return isFinite(r) ? r * Math.cos(theta) : NaN; } catch { return NaN; } };
    const yAt = (theta) => { try { const r = rFn({ theta }); return isFinite(r) ? r * Math.sin(theta) : NaN; } catch { return NaN; } };

    const AX_EPS = 1e-9;
    const checkBoundaryPolar = (bx, by) => {
        if (!isFinite(bx) || !isFinite(by)) return;
        if (Math.abs(by) <= AX_EPS && !allPoints.some(p => Math.abs(p.x - bx) < DEDUP && Math.abs(p.y) < DEDUP))
            allPoints.push({ x: bx, y: 0, tangent: false });
        if (Math.abs(bx) <= AX_EPS && !allPoints.some(p => Math.abs(p.x) < DEDUP && Math.abs(p.y - by) < DEDUP))
            allPoints.push({ x: 0, y: by, tangent: false });
    };

    let prevT = thetaMin;
    let prevX = xAt(thetaMin);
    let prevY = yAt(thetaMin);
    checkBoundaryPolar(prevX, prevY);    // thetaMin

    for (let i = 1; i <= SAMPLES; i++) {
        const theta = thetaMin + i * dt;
        const cx = xAt(theta);
        const cy = yAt(theta);

        if (isFinite(prevY) && isFinite(cy) && prevY * cy < 0) {
            const tRoot = bisect(yAt, prevT, theta, prevY, cy);
            if (tRoot !== null) {
                const rx = xAt(tRoot);
                if (isFinite(rx) && !allPoints.some(p => Math.abs(p.x - rx) < DEDUP && Math.abs(p.y) < DEDUP)) {
                    allPoints.push({ x: rx, y: 0, tangent: false });
                }
            }
        }

        if (isFinite(prevX) && isFinite(cx) && prevX * cx < 0) {
            const tRoot = bisect(xAt, prevT, theta, prevX, cx);
            if (tRoot !== null) {
                const ry = yAt(tRoot);
                if (isFinite(ry) && !allPoints.some(p => Math.abs(p.x) < DEDUP && Math.abs(p.y - ry) < DEDUP)) {
                    allPoints.push({ x: 0, y: ry, tangent: false });
                }
            }
        }

        prevT = theta; prevX = cx; prevY = cy;
    }

    checkBoundaryPolar(prevX, prevY);    // thetaMax
    return { xIntercepts: allPoints, yIntercept: null };
}

function findImplicitAxisIntersections(fn) {
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    const minY = screenToWorldY(canvas.height);
    const maxY = screenToWorldY(0);
    const SAMPLES = 600;
    const MAX_ROOTS = 15;
    const DEDUP = 1e-3;
    const allPoints = [];

    // X-axis intersections: sample f(x, 0)
    const stepX = (maxX - minX) / SAMPLES;
    const fxSlice = (x) => { try { return fn({ x, y: 0 }); } catch { return NaN; } };
    let prevFx = fxSlice(minX);
    for (let i = 1; i <= SAMPLES && allPoints.length < MAX_ROOTS; i++) {
        const x = minX + i * stepX;
        const fx = fxSlice(x);
        if (isFinite(prevFx) && isFinite(fx) && prevFx * fx < 0) {
            const root = bisect(fxSlice, x - stepX, x, prevFx, fx);
            if (root !== null && isFinite(root)) {
                if (!allPoints.some(p => Math.abs(p.x - root) < DEDUP && Math.abs(p.y) < DEDUP))
                    allPoints.push({ x: root, y: 0, tangent: false });
            }
        }
        prevFx = fx;
    }

    // Y-axis intersections: sample f(0, y)
    const stepY = (maxY - minY) / SAMPLES;
    const fySlice = (y) => { try { return fn({ x: 0, y }); } catch { return NaN; } };
    let prevFy = fySlice(minY);
    for (let i = 1; i <= SAMPLES && allPoints.length < MAX_ROOTS * 2; i++) {
        const y = minY + i * stepY;
        const fy = fySlice(y);
        if (isFinite(prevFy) && isFinite(fy) && prevFy * fy < 0) {
            const root = bisect(fySlice, y - stepY, y, prevFy, fy);
            if (root !== null && isFinite(root)) {
                if (!allPoints.some(p => Math.abs(p.x) < DEDUP && Math.abs(p.y - root) < DEDUP))
                    allPoints.push({ x: 0, y: root, tangent: false });
            }
        }
        prevFy = fy;
    }

    return { xIntercepts: allPoints, yIntercept: null };
}

function formatCoord(n) {
    if (!isFinite(n)) return '?';
    if (Math.abs(n) < 1e-9) return '0';
    return parseFloat(n.toFixed(4)).toString();
}

function drawIntersectionMarkers(intersections, color) {
    const { xIntercepts, yIntercept } = intersections;
    const isDark = getResolvedTheme() === 'dark';

    const allPoints = [...xIntercepts];
    if (yIntercept) {
        const alreadyPresent = allPoints.some(
            p => Math.abs(p.x - yIntercept.x) < 1e-6 && Math.abs(p.y - yIntercept.y) < 1e-6
        );
        if (!alreadyPresent) allPoints.push(yIntercept);
    }

    if (!allPoints.length) return;

    ctx.save();
    ctx.font = "bold 11px 'Inter', ui-sans-serif, system-ui, sans-serif";

    for (const pt of allPoints) {
        const sx = worldToScreenX(pt.x);
        const sy = worldToScreenY(pt.y);

        if (sx < -30 || sx > canvas.width + 30 || sy < -30 || sy > canvas.height + 30) continue;

        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        if (pt.tangent) {
            // Tangent root (touches axis): hollow circle with colored border
            ctx.fillStyle = isDark ? '#020617' : '#f8fafc';
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        } else {
            // Crossing root: solid filled circle
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = isDark ? '#f8fafc' : '#0f172a';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        if (showAxisCoords) {
            const label = `(${formatCoord(pt.x)}, ${formatCoord(pt.y)})`;
            const tw = ctx.measureText(label).width;
            const ph = 7;
            const bw = tw + ph * 2;
            const bh = 20;

            let lx = sx + 9;
            let ly = sy - bh - 8;
            if (lx + bw > canvas.width - 5) lx = sx - bw - 9;
            if (ly < 5) ly = sy + 10;
            if (lx < 5) lx = 5;

            const bgColor = isDark ? 'rgba(2,6,23,0.9)' : 'rgba(255,255,255,0.93)';
            const textColor = isDark ? '#e2e8f0' : '#0f172a';

            ctx.fillStyle = bgColor;
            ctx.beginPath();
            ctx.roundRect(lx, ly, bw, bh, 4);
            ctx.fill();

            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = textColor;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, lx + ph, ly + bh / 2);
        }
    }

    ctx.restore();
}

function numericalDerivative(fn, x) {
    const h = 1e-5;
    try {
        const yp = fn(x + h);
        const ym = fn(x - h);
        if (!isFinite(yp) || !isFinite(ym)) return NaN;
        return (yp - ym) / (2 * h);
    } catch { return NaN; }
}

function numericalSecondDerivative(fn, x) {
    const h = 1e-5;
    try {
        const yp = fn(x + h);
        const y0 = fn(x);
        const ym = fn(x - h);
        if (!isFinite(yp) || !isFinite(y0) || !isFinite(ym)) return NaN;
        return (yp - 2 * y0 + ym) / (h * h);
    } catch { return NaN; }
}

function findCriticalPoints(fn) {
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    const SAMPLES = 500;
    const step = (maxX - minX) / SAMPLES;
    const MAX_POINTS = 20;
    const results = [];
    let prevX = minX;
    let prevD = numericalDerivative(fn, prevX);
    for (let i = 1; i <= SAMPLES && results.length < MAX_POINTS; i++) {
        const x = minX + i * step;
        const d = numericalDerivative(fn, x);
        if (isFinite(prevD) && isFinite(d) && prevD * d < 0) {
            let a = prevX, b = x, fa = prevD;
            for (let iter = 0; iter < 50; iter++) {
                const mid = (a + b) / 2;
                if (Math.abs(b - a) < 1e-10) break;
                const fm = numericalDerivative(fn, mid);
                if (!isFinite(fm)) break;
                if (fa * fm <= 0) { b = mid; } else { a = mid; fa = fm; }
            }
            const cx = (a + b) / 2;
            if (!results.some(p => Math.abs(p.x - cx) < step * 0.5)) {
                let cy;
                try { cy = fn(cx); } catch { cy = NaN; }
                if (isFinite(cy)) {
                    const d2 = numericalSecondDerivative(fn, cx);
                    const kind = isFinite(d2) && d2 < 0 ? 'max' : 'min';
                    results.push({ x: cx, y: cy, kind });
                }
            }
        }
        prevX = x;
        prevD = d;
    }
    return results;
}

function findInflectionPoints(fn) {
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    const SAMPLES = 500;
    const step = (maxX - minX) / SAMPLES;
    const MAX_POINTS = 20;
    const results = [];
    let prevX = minX;
    let prevD2 = numericalSecondDerivative(fn, prevX);
    for (let i = 1; i <= SAMPLES && results.length < MAX_POINTS; i++) {
        const x = minX + i * step;
        const d2 = numericalSecondDerivative(fn, x);
        if (isFinite(prevD2) && isFinite(d2) && prevD2 * d2 < 0) {
            let a = prevX, b = x, fa = prevD2;
            for (let iter = 0; iter < 50; iter++) {
                const mid = (a + b) / 2;
                if (Math.abs(b - a) < 1e-10) break;
                const fm = numericalSecondDerivative(fn, mid);
                if (!isFinite(fm)) break;
                if (fa * fm <= 0) { b = mid; } else { a = mid; fa = fm; }
            }
            const ix = (a + b) / 2;
            if (!results.some(p => Math.abs(p.x - ix) < step * 0.5)) {
                let iy;
                try { iy = fn(ix); } catch { iy = NaN; }
                if (isFinite(iy)) results.push({ x: ix, y: iy });
            }
        }
        prevX = x;
        prevD2 = d2;
    }
    return results;
}

function drawRefLabel(sx, sy, label, color, isDark, preferSide) {
    const tw = ctx.measureText(label).width;
    const ph = 7;
    const bw = tw + ph * 2;
    const bh = 20;
    let lx, ly;
    if (preferSide === 'above') { lx = sx - bw / 2; ly = sy - bh - 10; }
    else if (preferSide === 'below') { lx = sx - bw / 2; ly = sy + 10; }
    else { lx = sx + 9; ly = sy - bh / 2; }
    if (lx < 5) lx = 5;
    if (lx + bw > canvas.width - 5) lx = canvas.width - bw - 5;
    if (ly < 5) ly = sy + 10;
    if (ly + bh > canvas.height - 5) ly = sy - bh - 5;
    const bgColor = isDark ? 'rgba(2,6,23,0.9)' : 'rgba(255,255,255,0.93)';
    const textColor = isDark ? '#e2e8f0' : '#0f172a';
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(lx, ly, bw, bh, 4);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + ph, ly + bh / 2);
}

function drawKeyReferencePoints(fn, color) {
    if (!showRefPoints) return;
    const criticals = findCriticalPoints(fn);
    const inflections = findInflectionPoints(fn);
    if (!criticals.length && !inflections.length) return;
    const isDark = getResolvedTheme() === 'dark';
    ctx.save();
    ctx.font = "bold 11px 'Inter', ui-sans-serif, system-ui, sans-serif";
    // Critical points: filled square (■)
    for (const pt of criticals) {
        const sx = worldToScreenX(pt.x);
        const sy = worldToScreenY(pt.y);
        if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
        const r = 4.5;
        ctx.fillStyle = color;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
        ctx.strokeStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx - r, sy - r, r * 2, r * 2);
        if (showRefCoords) drawRefLabel(sx, sy, `(${formatCoord(pt.x)}, ${formatCoord(pt.y)})`, color, isDark, pt.kind === 'max' ? 'above' : 'below');
    }
    // Inflection points: diamond (◇)
    for (const pt of inflections) {
        const sx = worldToScreenX(pt.x);
        const sy = worldToScreenY(pt.y);
        if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
        const r = 5;
        ctx.beginPath();
        ctx.moveTo(sx, sy - r);
        ctx.lineTo(sx + r, sy);
        ctx.lineTo(sx, sy + r);
        ctx.lineTo(sx - r, sy);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (showRefCoords) drawRefLabel(sx, sy, `(${formatCoord(pt.x)}, ${formatCoord(pt.y)})`, color, isDark, 'right');
    }
    ctx.restore();
}

function drawParametric(compiled, color) {
    const xFn = compiled.xFn;
    const yFn = compiled.yFn;
    const tMin = compiled.tMin;
    const tMax = compiled.tMax;
    if (!isFinite(tMin) || !isFinite(tMax)) return;
    const range = tMax - tMin;
    const steps = Math.max(200, Math.min(2000, Math.floor(canvas.width)));
    const step = range / steps;
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    let isDrawing = false;
    for (let i = 0; i <= steps; i++) {
        const t = tMin + (step * i);
        let x = NaN;
        let y = NaN;
        try { x = xFn({ t }); y = yFn({ t }); } catch { x = NaN; y = NaN; }
        if (!isFinite(x) || !isFinite(y)) { isDrawing = false; continue; }
        const sx = worldToScreenX(x);
        const sy = worldToScreenY(y);
        if (!isDrawing) { ctx.moveTo(sx, sy); isDrawing = true; }
        else { ctx.lineTo(sx, sy); }
    }
    ctx.stroke();
}

function drawPolar(compiled, color) {
    const rFn = compiled.rFn;
    const tMin = compiled.thetaMin;
    const tMax = compiled.thetaMax;
    if (!isFinite(tMin) || !isFinite(tMax)) return;
    const range = tMax - tMin;
    const steps = Math.max(200, Math.min(2000, Math.floor(canvas.width)));
    const step = range / steps;
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    let isDrawing = false;
    for (let i = 0; i <= steps; i++) {
        const theta = tMin + (step * i);
        let r = NaN;
        try { r = rFn({ theta }); } catch { r = NaN; }
        if (!isFinite(r)) { isDrawing = false; continue; }
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        const sx = worldToScreenX(x);
        const sy = worldToScreenY(y);
        if (!isDrawing) { ctx.moveTo(sx, sy); isDrawing = true; }
        else { ctx.lineTo(sx, sy); }
    }
    ctx.stroke();
}

function drawImplicit(compiled, color) {
    const fn = compiled.fn;
    const stepPx = state.scale < 20 ? 2 : state.scale < 50 ? 3 : 4;
    const stepWorld = stepPx / state.scale;
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    const minY = screenToWorldY(canvas.height);
    const maxY = screenToWorldY(0);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    for (let x = minX; x < maxX; x += stepWorld) {
        for (let y = minY; y < maxY; y += stepWorld) {
            let f00 = fn({ x, y });
            let f10 = fn({ x: x + stepWorld, y });
            let f01 = fn({ x, y: y + stepWorld });
            let f11 = fn({ x: x + stepWorld, y: y + stepWorld });
            if (![f00, f10, f01, f11].every(isFinite)) continue;
            const points = [];
            if (f00 * f10 < 0) points.push(interpolateEdge(x, y, x + stepWorld, y, f00, f10));
            if (f10 * f11 < 0) points.push(interpolateEdge(x + stepWorld, y, x + stepWorld, y + stepWorld, f10, f11));
            if (f01 * f11 < 0) points.push(interpolateEdge(x, y + stepWorld, x + stepWorld, y + stepWorld, f01, f11));
            if (f00 * f01 < 0) points.push(interpolateEdge(x, y, x, y + stepWorld, f00, f01));
            if (points.length === 2) {
                ctx.beginPath();
                ctx.moveTo(worldToScreenX(points[0].x), worldToScreenY(points[0].y));
                ctx.lineTo(worldToScreenX(points[1].x), worldToScreenY(points[1].y));
                ctx.stroke();
            } else if (points.length === 4) {
                ctx.beginPath();
                ctx.moveTo(worldToScreenX(points[0].x), worldToScreenY(points[0].y));
                ctx.lineTo(worldToScreenX(points[1].x), worldToScreenY(points[1].y));
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(worldToScreenX(points[2].x), worldToScreenY(points[2].y));
                ctx.lineTo(worldToScreenX(points[3].x), worldToScreenY(points[3].y));
                ctx.stroke();
            }
        }
    }
}

function interpolateEdge(x1, y1, x2, y2, f1, f2) {
    const t = f1 / (f1 - f2);
    return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
}

function drawRegion(compiled, color) {
    const fill = hexToRgba(color, 0.25);
    const stroke = hexToRgba(color, 0.85);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    for (const rect of compiled.rects) {
        const x1 = worldToScreenX(rect.xMin);
        const x2 = worldToScreenX(rect.xMax);
        const y1 = worldToScreenY(rect.yMin);
        const y2 = worldToScreenY(rect.yMax);
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        ctx.fillRect(left, top, width, height);
        ctx.strokeRect(left, top, width, height);
    }
}

function drawTextMarker(el) {
    const sx = worldToScreenX(el.x);
    const sy = worldToScreenY(el.y);
    ctx.font = "bold 12px 'Inter', ui-sans-serif, system-ui, sans-serif";
    const textWidth = ctx.measureText(el.content).width;
    const padding = 12;
    const boxHeight = 28;
    const boxWidth = textWidth + (padding * 2);

    const textColor = pickTextColor(el.color);

    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
    ctx.fillStyle = el.color;
    ctx.beginPath();
    ctx.roundRect(sx, sy - (boxHeight / 2), boxWidth, boxHeight, 8);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.content, sx + padding, sy);

    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = textColor;
    ctx.fill();
}

function renderElementsList() {
    const container = document.getElementById('elements-container');
    container.innerHTML = '';
    elements.forEach((el, index) => {
        const div = document.createElement('div');
        div.className = `bg-slate-800 p-2 rounded border-l-4 border-slate-700 mb-2 flex items-center gap-2`;
        div.style.borderLeftColor = el.color;
        let inputHtml = el.type === 'function'
            ? `<input type="text" value="${el.content}" oninput="updateContent(${index}, this.value)" class="flex-1 bg-slate-900 border-none text-slate-200 text-sm h-8 px-2 rounded font-mono focus:ring-1 focus:ring-blue-500 outline-none" placeholder="y = sin(x) | x = cos(t), y = sin(t), t in [0, 2*pi]">`
            : `<input type="text" value="${el.content}" oninput="updateContent(${index}, this.value)" class="flex-1 bg-slate-900 border-none text-slate-200 text-sm h-8 px-2 rounded font-sans focus:ring-1 focus:ring-emerald-500 outline-none" placeholder="Etiqueta...">`;

        div.innerHTML = `
            <div class="flex flex-col gap-1 w-full">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-slate-500 font-bold uppercase">${el.type === 'function' ? 'FUNC' : 'LBL'}</span>
                    <div class="flex gap-3">
                        <input type="color" value="${el.color}" oninput="setElementColor(${index}, this.value)" class="color-swatch" aria-label="Color">
                        <button onclick="toggleVisibility(${index})"><i class="fa-solid ${el.visible ? 'fa-eye' : 'fa-eye-slash'} text-xs text-slate-400"></i></button>
                        <button onclick="removeElement(${index})"><i class="fa-solid fa-times text-xs text-slate-400 hover:text-red-400"></i></button>
                    </div>
                </div>
                ${inputHtml}
            </div>
        `;
        container.appendChild(div);
    });
}

window.updateContent = (i, val) => { elements[i].content = val; delete elements[i]._compiled; scheduleDrawDebounced(); };
window.removeElement = (i) => { elements.splice(i, 1); renderElementsList(); scheduleDrawFrame(); scheduleSessionSave(); };
window.toggleVisibility = (i) => { elements[i].visible = !elements[i].visible; renderElementsList(); scheduleDrawFrame(); scheduleSessionSave(); };
window.setElementColor = (i, color) => {
    if (!elements[i]) return;
    const value = String(color || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
    elements[i].color = value;
    renderElementsList();
    scheduleDrawFrame();
    scheduleSessionSave();
};
window.zoomIn = () => { state.scale *= 1.2; scheduleDrawFrame(); scheduleSessionSave(); };
window.zoomOut = () => { state.scale *= 0.8; scheduleDrawFrame(); scheduleSessionSave(); };
window.downloadGraph = downloadGraph;

function drawImplicitToContext(targetCtx, compiled, color) {
    const fn = compiled.fn;
    const stepPx = state.scale < 20 ? 2 : state.scale < 50 ? 3 : 4;
    const stepWorld = stepPx / state.scale;
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    const minY = screenToWorldY(canvas.height);
    const maxY = screenToWorldY(0);
    targetCtx.lineWidth = 1.5;
    targetCtx.strokeStyle = color;
    for (let x = minX; x < maxX; x += stepWorld) {
        for (let y = minY; y < maxY; y += stepWorld) {
            let f00 = NaN;
            let f10 = NaN;
            let f01 = NaN;
            let f11 = NaN;
            try {
                f00 = fn({ x, y });
                f10 = fn({ x: x + stepWorld, y });
                f01 = fn({ x, y: y + stepWorld });
                f11 = fn({ x: x + stepWorld, y: y + stepWorld });
            } catch {
                continue;
            }
            if (![f00, f10, f01, f11].every(isFinite)) continue;
            const points = [];
            if (f00 * f10 < 0) points.push(interpolateEdge(x, y, x + stepWorld, y, f00, f10));
            if (f10 * f11 < 0) points.push(interpolateEdge(x + stepWorld, y, x + stepWorld, y + stepWorld, f10, f11));
            if (f01 * f11 < 0) points.push(interpolateEdge(x, y + stepWorld, x + stepWorld, y + stepWorld, f01, f11));
            if (f00 * f01 < 0) points.push(interpolateEdge(x, y, x, y + stepWorld, f00, f01));
            if (points.length === 2) {
                targetCtx.beginPath();
                targetCtx.moveTo(worldToScreenX(points[0].x), worldToScreenY(points[0].y));
                targetCtx.lineTo(worldToScreenX(points[1].x), worldToScreenY(points[1].y));
                targetCtx.stroke();
            } else if (points.length === 4) {
                targetCtx.beginPath();
                targetCtx.moveTo(worldToScreenX(points[0].x), worldToScreenY(points[0].y));
                targetCtx.lineTo(worldToScreenX(points[1].x), worldToScreenY(points[1].y));
                targetCtx.stroke();
                targetCtx.beginPath();
                targetCtx.moveTo(worldToScreenX(points[2].x), worldToScreenY(points[2].y));
                targetCtx.lineTo(worldToScreenX(points[3].x), worldToScreenY(points[3].y));
                targetCtx.stroke();
            }
        }
    }
}

function drawGraphElementSync(el) {
    if (!el.content.trim()) return;
    const compiled = getCompiledElement(el);
    if (!compiled || compiled.type === 'invalid') return;
    if (compiled.type === 'function') return drawCartesianFunction(compiled, el.color);
    if (compiled.type === 'parametric') return drawParametric(compiled, el.color);
    if (compiled.type === 'polar') return drawPolar(compiled, el.color);
    if (compiled.type === 'implicit') return drawImplicitToContext(ctx, compiled, el.color);
    if (compiled.type === 'segments') return compiled.segments.forEach(segment => drawParametric(segment, el.color));
    if (compiled.type === 'region') return drawRegion(compiled, el.color);
}

function renderExportFrame() {
    cancelImplicitRender();
    const palette = getThemePalette();
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const step = calculateStep(state.scale);
    drawGrid(step);
    drawAxes(step);

    const functionEls = elements.filter(e => e.type === 'function' && e.visible);
    const textEls = elements.filter(e => e.type === 'text' && e.visible);

    functionEls.forEach(drawGraphElementSync);

    functionEls.forEach((el) => {
        if (!el.content.trim()) return;
        const compiled = getCompiledElement(el);
        if (!compiled) return;
        if (compiled.type === 'function') {
            drawIntersectionMarkers(findCartesianIntersections(compiled.fn), el.color);
            drawKeyReferencePoints(compiled.fn, el.color);
        } else if (compiled.type === 'parametric' || compiled.type === 'segments') {
            drawIntersectionMarkers(findParametricAxisIntersections(compiled), el.color);
        } else if (compiled.type === 'polar') {
            drawIntersectionMarkers(findPolarAxisIntersections(compiled), el.color);
        }
    });

    textEls.forEach(drawTextMarker);
}

function downloadGraph() {
    renderExportFrame();
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.download = `graficador_${stamp}.png`;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function calculateStep(scale) {
    let step = 1;
    if (scale < 10) step = 5; if (scale < 4) step = 10; if (scale < 2) step = 20; if (scale < 0.5) step = 50;
    if (scale > 80) step = 0.5; if (scale > 150) step = 0.1;
    return step;
}
function drawGrid(step) {
    const palette = getThemePalette();
    const { width, height } = canvas;
    const { scale, offsetX, offsetY } = state;
    const startX = -offsetX / scale; const endX = (width - offsetX) / scale;
    const minWorldY = (offsetY - height) / scale; const maxWorldY = offsetY / scale;
    ctx.lineWidth = 1;
    for (let x = Math.floor(startX / step) * step; x <= endX; x += step) {
        const screenX = worldToScreenX(x);
        ctx.beginPath(); ctx.strokeStyle = (Math.abs(x % (step * 5)) < 0.001) ? palette.gridMajor : palette.gridMinor;
        ctx.moveTo(screenX, 0); ctx.lineTo(screenX, height); ctx.stroke();
    }
    for (let y = Math.floor(minWorldY / step) * step; y <= maxWorldY; y += step) {
        const screenY = worldToScreenY(y);
        ctx.beginPath(); ctx.strokeStyle = (Math.abs(y % (step * 5)) < 0.001) ? palette.gridMajor : palette.gridMinor;
        ctx.moveTo(0, screenY); ctx.lineTo(width, screenY); ctx.stroke();
    }
}
function drawAxes(step) {
    const palette = getThemePalette();
    const { width, height } = canvas;
    const { scale, offsetX, offsetY } = state;
    ctx.lineWidth = 2; ctx.strokeStyle = palette.axis; ctx.fillStyle = palette.label;
    ctx.font = "10px 'Inter', ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const originY = worldToScreenY(0); const originX = worldToScreenX(0);

    if (originY >= -20 && originY <= height + 20) { ctx.beginPath(); ctx.moveTo(0, originY); ctx.lineTo(width, originY); ctx.stroke(); }
    const startX = -offsetX / scale; const endX = (width - offsetX) / scale;
    for (let x = Math.floor(startX / step) * step; x <= endX; x += step) {
        if (Math.abs(x) < 0.001) continue;
        const screenX = worldToScreenX(x);
        ctx.beginPath(); ctx.moveTo(screenX, originY - 3); ctx.lineTo(screenX, originY + 3); ctx.stroke();
        let labelY = originY + 6; if (originY < 0) labelY = 6; if (originY > height - 20) labelY = height - 16;
        ctx.fillText(formatNumber(x), screenX, labelY);
    }
    if (originX >= -20 && originX <= width + 20) { ctx.beginPath(); ctx.moveTo(originX, 0); ctx.lineTo(originX, height); ctx.stroke(); }
    const minWorldY = (offsetY - height) / scale; const maxWorldY = offsetY / scale;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = Math.floor(minWorldY / step) * step; y <= maxWorldY; y += step) {
        if (Math.abs(y) < 0.001) continue;
        const screenY = worldToScreenY(y);
        ctx.beginPath(); ctx.moveTo(originX - 3, screenY); ctx.lineTo(originX + 3, screenY); ctx.stroke();
        let labelX = originX - 6; if (originX < 30) labelX = 30; if (originX > width) labelX = width - 10;
        ctx.fillText(formatNumber(y), labelX, screenY);
    }
}
function formatNumber(n) { return Number.isInteger(n) ? n.toString() : n.toFixed(1).replace(/\.0$/, ''); }
function worldToScreenX(wx) { return (wx * state.scale) + state.offsetX; }
function worldToScreenY(wy) { return state.offsetY - (wy * state.scale); }
function screenToWorldX(sx) { return (sx - state.offsetX) / state.scale; }
function screenToWorldY(sy) { return (state.offsetY - sy) / state.scale; }

init();
