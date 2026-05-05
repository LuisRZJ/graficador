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
const axisResetButton = document.getElementById('axis-reset-button');

let state = {
    scaleX: 40,
    scaleY: 40,
    offsetX: 0,
    offsetY: 0,
    isDraggingCanvas: false,
    draggingElementId: null,
    isAxisScaling: false,
    axisScaleMode: null,
    axisScaleStartX: 40,
    axisScaleStartY: 40,
    axisScalePointerStart: 0,
    axisScaleMoved: false,
    lastMouseX: 0,
    lastMouseY: 0
};

let elements = [
    { id: 1, type: 'function', content: 'sin(x)', color: '#3b82f6', visible: true },
    { id: 2, type: 'text', content: 'Zona Compra', x: 2, y: 1.5, color: '#10b981', visible: true }
];

const EPS = 1e-3;
const PAN_SENSITIVITY = 0.6;
const AXIS_GRAB_DISTANCE_PX = 14;
const AXIS_SCALE_SENSITIVITY = 0.01;
const MIN_SCALE = 0.5;
const MAX_SCALE = 5000;

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
                // Keep legacy scale for backward compatibility with old sessions.
                scale: (state.scaleX + state.scaleY) / 2,
                scaleX: state.scaleX,
                scaleY: state.scaleY,
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
        const restoredScaleX = restoredState ? Number(restoredState.scaleX) : NaN;
        const restoredScaleY = restoredState ? Number(restoredState.scaleY) : NaN;
        const restoredScale = restoredState ? Number(restoredState.scale) : NaN;
        const restoredOffsetX = restoredState ? Number(restoredState.offsetX) : NaN;
        const restoredOffsetY = restoredState ? Number(restoredState.offsetY) : NaN;

        if (Array.isArray(data.elements)) elements = restoredElements;

        if (isFinite(restoredScaleX)) state.scaleX = clamp(restoredScaleX, MIN_SCALE, MAX_SCALE);
        if (isFinite(restoredScaleY)) state.scaleY = clamp(restoredScaleY, MIN_SCALE, MAX_SCALE);
        if (!isFinite(restoredScaleX) && !isFinite(restoredScaleY) && isFinite(restoredScale)) {
            const safe = clamp(restoredScale, MIN_SCALE, MAX_SCALE);
            state.scaleX = safe;
            state.scaleY = safe;
        }
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
        .replace(/\\left/gi, '')
        .replace(/\\right/gi, '')
        .replace(/\\log/gi, 'log')
        .replace(/\\ln/gi, 'ln')
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

    // Also support function-style sigma notation: sum(expr, n, start, end)
    // Run a few passes so nested sums can be expanded from inside out.
    let prev = '';
    let guard = 0;
    while (out !== prev && guard < 8) {
        prev = out;
        out = rewriteFunctionStyleSumOnce(out);
        guard++;
    }

    return out;
}

function rewriteFunctionStyleSumOnce(expr) {
    let out = '';
    let i = 0;
    const lowerExpr = expr.toLowerCase();

    while (i < expr.length) {
        const idx = lowerExpr.indexOf('sum', i);
        if (idx === -1) {
            out += expr.slice(i);
            break;
        }

        const prev = expr[idx - 1];
        const next = expr[idx + 3];
        if (isIdentifierCharacter(prev) || isIdentifierCharacter(next)) {
            out += expr.slice(i, idx + 3);
            i = idx + 3;
            continue;
        }

        let cursor = idx + 3;
        while (cursor < expr.length && /\s/.test(expr[cursor])) cursor++;
        if (expr[cursor] !== '(') {
            out += expr.slice(i, idx + 3);
            i = idx + 3;
            continue;
        }

        const closeParen = findMatchingDelimiter(expr, cursor, '(', ')');
        if (closeParen === -1) {
            out += expr.slice(i);
            break;
        }

        out += expr.slice(i, idx);

        const argsText = expr.slice(cursor + 1, closeParen);
        const args = splitTopLevelArguments(argsText);
        if (args.length === 4) {
            const bodyExpr = args[0].trim();
            const indexVar = args[1].trim();
            const startExpr = args[2].trim();
            const endExpr = args[3].trim();
            const isValidIndex = /^[A-Za-z_][A-Za-z0-9_]*$/.test(indexVar);

            if (bodyExpr && startExpr && endExpr && isValidIndex) {
                out += `(function(){let __sum=0;for(let ${indexVar}=${startExpr};${indexVar}<=${endExpr};${indexVar}++){__sum+=(${bodyExpr});}return __sum;})()`;
            } else {
                out += expr.slice(idx, closeParen + 1);
            }
        } else {
            out += expr.slice(idx, closeParen + 1);
        }

        i = closeParen + 1;
    }

    return out;
}

const IMPLICIT_MUL_FUNCTION_NAMES = new Set([
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'sqrt', 'log', 'log10', 'log2', 'exp', 'abs',
    'max', 'min', 'floor', 'ceil', 'pow', 'sign',
    'sum', 'logbase'
]);

const IMPLICIT_MUL_SYMBOL_NAMES = new Set([
    'x', 'y', 't', 'n', 'theta', 'pi', 'e', 'eps'
]);

function tokenizeForImplicitMultiplication(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];

        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        if (ch === '(') {
            tokens.push({ type: 'openParen', value: ch });
            i++;
            continue;
        }
        if (ch === ')') {
            tokens.push({ type: 'closeParen', value: ch });
            i++;
            continue;
        }

        const numberMatch = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(expr.slice(i));
        if (numberMatch) {
            tokens.push({ type: 'number', value: numberMatch[0] });
            i += numberMatch[0].length;
            continue;
        }

        const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i));
        if (idMatch) {
            tokens.push({ type: 'identifier', value: idMatch[0] });
            i += idMatch[0].length;
            continue;
        }

        tokens.push({ type: 'operator', value: ch });
        i++;
    }
    return tokens;
}

function shouldInsertImplicitMultiplication(prevToken, nextToken) {
    const prevCanEndFactor = prevToken.type === 'number'
        || prevToken.type === 'identifier'
        || prevToken.type === 'closeParen';
    const nextCanStartFactor = nextToken.type === 'number'
        || nextToken.type === 'identifier'
        || nextToken.type === 'openParen';

    if (!prevCanEndFactor || !nextCanStartFactor) return false;

    if (prevToken.type === 'identifier' && nextToken.type === 'openParen') {
        const prevName = String(prevToken.value || '').toLowerCase();
        if (IMPLICIT_MUL_FUNCTION_NAMES.has(prevName)) return false;
        if (!IMPLICIT_MUL_SYMBOL_NAMES.has(prevName)) return false;
    }

    return true;
}

function insertImplicitMultiplication(expr) {
    const tokens = tokenizeForImplicitMultiplication(expr);
    if (tokens.length < 2) return expr;

    const out = [tokens[0].value];
    for (let i = 1; i < tokens.length; i++) {
        const prev = tokens[i - 1];
        const curr = tokens[i];
        if (shouldInsertImplicitMultiplication(prev, curr)) {
            out.push('*');
        }
        out.push(curr.value);
    }
    return out.join('');
}

function isIdentifierCharacter(ch) {
    return !!ch && /[A-Za-z0-9_]/.test(ch);
}

function findMatchingDelimiter(text, startIndex, openChar, closeChar) {
    let depth = 0;
    for (let i = startIndex; i < text.length; i++) {
        const ch = text[i];
        if (ch === openChar) depth++;
        if (ch === closeChar) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function splitTopLevelArguments(text) {
    const args = [];
    let start = 0;
    let depthParen = 0;
    let depthBracket = 0;
    let depthBrace = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') depthParen++;
        else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
        else if (ch === '[') depthBracket++;
        else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
        else if (ch === '{') depthBrace++;
        else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
        else if (ch === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
            args.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    args.push(text.slice(start).trim());
    return args.filter((arg) => arg.length > 0);
}

function rewriteLogSubscriptNotation(expr) {
    let out = '';
    let i = 0;

    while (i < expr.length) {
        const idx = expr.indexOf('log_', i);
        if (idx === -1) {
            out += expr.slice(i);
            break;
        }

        const prev = expr[idx - 1];
        if (isIdentifierCharacter(prev)) {
            out += expr.slice(i, idx + 4);
            i = idx + 4;
            continue;
        }

        out += expr.slice(i, idx);
        let cursor = idx + 4;
        while (cursor < expr.length && /\s/.test(expr[cursor])) cursor++;

        let baseExpr = '';
        if (expr[cursor] === '{') {
            const closeBase = findMatchingDelimiter(expr, cursor, '{', '}');
            if (closeBase === -1) {
                out += expr.slice(idx, cursor + 1);
                i = cursor + 1;
                continue;
            }
            baseExpr = expr.slice(cursor + 1, closeBase).trim();
            cursor = closeBase + 1;
        } else {
            const token = /^[+-]?\d+(?:\.\d+)?|^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(cursor));
            if (!token) {
                out += expr.slice(idx, idx + 4);
                i = idx + 4;
                continue;
            }
            baseExpr = token[0].trim();
            cursor += token[0].length;
        }

        while (cursor < expr.length && /\s/.test(expr[cursor])) cursor++;
        if (expr[cursor] !== '(' || !baseExpr) {
            out += expr.slice(idx, cursor);
            i = cursor;
            continue;
        }

        const closeArg = findMatchingDelimiter(expr, cursor, '(', ')');
        if (closeArg === -1) {
            out += expr.slice(idx, cursor + 1);
            i = cursor + 1;
            continue;
        }

        const valueExpr = expr.slice(cursor + 1, closeArg).trim();
        if (!valueExpr) {
            out += expr.slice(idx, closeArg + 1);
            i = closeArg + 1;
            continue;
        }

        out += `logBase((${baseExpr}),(${valueExpr}))`;
        i = closeArg + 1;
    }

    return out;
}

function rewriteTwoArgumentLogCalls(expr) {
    let out = '';
    let i = 0;

    while (i < expr.length) {
        const idx = expr.indexOf('log', i);
        if (idx === -1) {
            out += expr.slice(i);
            break;
        }

        const prev = expr[idx - 1];
        const next = expr[idx + 3];
        if (isIdentifierCharacter(prev) || isIdentifierCharacter(next)) {
            out += expr.slice(i, idx + 3);
            i = idx + 3;
            continue;
        }

        let cursor = idx + 3;
        while (cursor < expr.length && /\s/.test(expr[cursor])) cursor++;
        if (expr[cursor] !== '(') {
            out += expr.slice(i, idx + 3);
            i = idx + 3;
            continue;
        }

        const closeParen = findMatchingDelimiter(expr, cursor, '(', ')');
        if (closeParen === -1) {
            out += expr.slice(i, idx + 3);
            i = idx + 3;
            continue;
        }

        out += expr.slice(i, idx);
        const inner = expr.slice(cursor + 1, closeParen);
        const args = splitTopLevelArguments(inner);
        if (args.length === 2) {
            out += `logBase((${args[0]}),(${args[1]}))`;
        } else {
            out += `log(${inner})`;
        }
        i = closeParen + 1;
    }

    return out;
}

function logBaseHelper(base, value) {
    const b = Number(base);
    const v = Number(value);
    if (!isFinite(b) || !isFinite(v)) return NaN;
    if (b <= 0 || v <= 0) return NaN;
    if (Math.abs(b - 1) < EPS) return NaN;
    return Math.log(v) / Math.log(b);
}

function preprocessExpression(expr) {
    let s = normalizeInput(expr);
    s = s.replace(/\bln\b/gi, 'log');
    s = s.replace(/\bsgn\b/gi, 'sign');
    s = rewriteLogSubscriptNotation(s);
    s = rewriteTwoArgumentLogCalls(s);
    s = insertImplicitMultiplication(s);
    s = expandSum(s);
    s = s.replace(/\^/g, '**');
    return s;
}

function createEvaluator(expression, variables) {
    const prepared = preprocessExpression(expression);
    const fn = new Function(...variables, 'sum', 'pi', 'e', 'eps', 'logBase', `
        const { sin, cos, tan, asin, acos, atan, sqrt, log, log10, log2, exp, abs, max, min, floor, ceil, pow, sign } = Math;
        return ${prepared};
    `);
    return (vars) => fn(...variables.map((v) => vars[v]), sumHelper, Math.PI, Math.E, EPS, logBaseHelper);
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
    const text = String(input || '').trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    const match = /^\{([\s\S]+)\}$/.exec(text);
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

function inferParametricVariable(xExpr, yExpr, hint) {
    const hinted = String(hint || '').toLowerCase();
    if (hinted === 'theta' || hinted === 't') return hinted;
    const body = `${xExpr || ''} ${yExpr || ''}`;
    const hasTheta = /\btheta\b/i.test(body);
    const hasT = /\bt\b/i.test(body);
    if (hasTheta && !hasT) return 'theta';
    return 't';
}

function parseParametricTuple(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith('(')) return null;

    const closeIndex = findMatchingDelimiter(trimmed, 0, '(', ')');
    if (closeIndex <= 0) return null;

    const tupleBody = trimmed.slice(1, closeIndex);
    const tupleArgs = splitTopLevelArguments(tupleBody);
    if (tupleArgs.length !== 2) return null;

    const tail = trimmed.slice(closeIndex + 1).trim();
    if (tail && !/^[,;]?\s*(?:t|theta)\s*in\s*\[/i.test(tail)) return null;

    const xExpr = tupleArgs[0].trim();
    const yExpr = tupleArgs[1].trim();
    if (!xExpr || !yExpr) return null;

    const paramVar = inferParametricVariable(xExpr, yExpr);
    const range = parseRange(trimmed, paramVar) || parseRange(trimmed, paramVar === 't' ? 'theta' : 't');
    const tMinExpr = range ? range[0] : '0';
    const tMaxExpr = range ? range[1] : '2*pi';
    const tMin = evalLiteral(tMinExpr);
    const tMax = evalLiteral(tMaxExpr);

    return {
        type: 'parametric',
        xExpr,
        yExpr,
        paramVar,
        tMin,
        tMax
    };
}

function parseParametric(input) {
    const text = normalizeInput(input);
    const tupleParametric = parseParametricTuple(text);
    if (tupleParametric) return tupleParametric;

    const stop = String.raw`(?=,|;|\bx\s*[\(]?(?:t|theta)?\s*[\)]?\s*=|\by\s*[\(]?(?:t|theta)?\s*[\)]?\s*=|\bt\s*in\b|\btheta\s*in\b|$)`;
    // Accept both "x = expr" and "x(t) = expr" / "x(θ) = expr"
    const xMatch = new RegExp(String.raw`\bx\s*(?:\(\s*(t|theta)\s*\))?\s*=\s*(.+?)${stop}`, 'i').exec(text);
    const yMatch = new RegExp(String.raw`\by\s*(?:\(\s*(t|theta)\s*\))?\s*=\s*(.+?)${stop}`, 'i').exec(text);
    if (!xMatch || !yMatch) return null;
    const xExpr = xMatch[2].trim();
    const yExpr = yMatch[2].trim();
    const paramVar = inferParametricVariable(xExpr, yExpr, xMatch[1] || yMatch[1]);
    const range = parseRange(text, paramVar) || parseRange(text, paramVar === 't' ? 'theta' : 't');
    const tMinExpr = range ? range[0] : '-10';
    const tMaxExpr = range ? range[1] : '10';
    const tMin = evalLiteral(tMinExpr);
    const tMax = evalLiteral(tMaxExpr);
    return {
        type: 'parametric',
        xExpr,
        yExpr,
        paramVar,
        tMin,
        tMax
    };
}

function compileParametricDefinition(definition) {
    const paramVar = String(definition?.paramVar || 't').toLowerCase() === 'theta' ? 'theta' : 't';
    const xEvaluator = createEvaluator(definition.xExpr, [paramVar]);
    const yEvaluator = createEvaluator(definition.yExpr, [paramVar]);
    return {
        type: 'parametric',
        xFn: ({ t }) => xEvaluator({ [paramVar]: t }),
        yFn: ({ t }) => yEvaluator({ [paramVar]: t }),
        tMin: definition.tMin,
        tMax: definition.tMax
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

function findStandaloneEquals(text) {
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '=') continue;
        const prev = text[i - 1] || '';
        const next = text[i + 1] || '';
        if (prev === '<' || prev === '>' || prev === '=' || prev === '!') continue;
        if (next === '=' || next === '>') continue;
        return i;
    }
    return -1;
}

function parseImplicit(input) {
    const text = normalizeInput(input);
    if (/^\s*r\s*=/.test(text)) return null;
    const eqIndex = findStandaloneEquals(text);
    if (eqIndex === -1) return null;
    const left = text.slice(0, eqIndex).trim();
    const right = text.slice(eqIndex + 1).trim();
    if (!left || !right) return null;

    // If both sides are free of x and y, this is not a planar equation
    const hasXY = (s) => /\bx\b/i.test(s) || /\by\b/i.test(s);
    if (!hasXY(left) && !hasXY(right)) return null;

    const isLeftFunctionOfX = /^\s*[a-z_][a-z0-9_]*\s*\(\s*x\s*\)\s*$/i.test(left);
    if (isLeftFunctionOfX) return null;

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

function parseAuxiliaryAsymptote(input) {
    const text = normalizeInput(input);
    const prefix = /^(?:as[ií]ntota|asymptote|aux(?:iliar)?)\s*:?\s*/i;
    if (!prefix.test(text)) return null;

    const body = text
        .replace(prefix, '')
        .replace(/^(?:vertical|horizontal|oblicua|oblique)\s*:?\s*/i, '')
        .trim();
    if (!body) return { type: 'invalid' };

    const verticalMatch = /^x\s*=\s*(.+)$/i.exec(body);
    if (verticalMatch) {
        const x = evalLiteral(verticalMatch[1].trim());
        return isFinite(x)
            ? { type: 'aux-asymptote', kind: 'vertical', x }
            : { type: 'invalid' };
    }

    const yMatch = /^y\s*=\s*(.+)$/i.exec(body);
    if (yMatch) {
        const expr = yMatch[1].trim();
        if (!expr) return { type: 'invalid' };

        if (!/\bx\b/i.test(expr)) {
            const y = evalLiteral(expr);
            if (isFinite(y)) return { type: 'aux-asymptote', kind: 'horizontal', y };
        }

        try {
            const fn = createEvaluator(expr, ['x']);
            return { type: 'aux-asymptote', kind: 'line', fn };
        } catch {
            return { type: 'invalid' };
        }
    }

    return { type: 'invalid' };
}

function parseAttractor(text) {
    // Pattern 1: clifford(a, b, c, d)
    const cliffordMatch = /^\s*clifford\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*,\s*([^,)]+)\s*,\s*([^,)]+)\s*\)\s*$/i.exec(text);
    if (cliffordMatch) {
        const a = cliffordMatch[1].trim();
        const b = cliffordMatch[2].trim();
        const c = cliffordMatch[3].trim();
        const d = cliffordMatch[4].trim();
        return {
            xNextExpr: `sin((${a})*y)+(${c})*cos((${a})*x)`,
            yNextExpr: `sin((${b})*x)+(${d})*cos((${b})*y)`
        };
    }
    // Pattern 2: x_new=expr, y_new=expr  or  x_{n+1}=expr, y_{n+1}=expr
    const newMatch = /^\s*x(?:_new|_\{?n\+1\}?)\s*=\s*(.+?)\s*,\s*y(?:_new|_\{?n\+1\}?)\s*=\s*(.+?)\s*$/i.exec(text);
    if (newMatch) {
        return {
            xNextExpr: newMatch[1].trim(),
            yNextExpr: newMatch[2].trim()
        };
    }
    return null;
}

function compileExpression(input) {
    const text = normalizeInput(input);
    if (!text) return { type: 'invalid' };

    const auxiliaryAsymptote = parseAuxiliaryAsymptote(text);
    if (auxiliaryAsymptote) return auxiliaryAsymptote;

    const region = parseRegion(text);
    if (region) return region;
    const segments = parseSegments(text);
    if (segments) {
        return {
            type: 'segments',
            segments: segments.segments.map(segment => compileParametricDefinition(segment))
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
        return compileParametricDefinition(parametric);
    }

    const conic = parseConic(text);
    if (conic) {
        return {
            type: 'segments',
            segments: conic.segments.map(segment => compileParametricDefinition(segment))
        };
    }
    const attractor = parseAttractor(text);
    if (attractor) {
        return {
            type: 'attractor',
            xNextFn: createEvaluator(attractor.xNextExpr, ['x', 'y']),
            yNextFn: createEvaluator(attractor.yNextExpr, ['x', 'y']),
            x0: 0.1,
            y0: 0.1,
            iterations: 200000
        };
    }

    const implicit = parseImplicit(text);
    if (implicit) {
        return {
            type: 'implicit',
            fn: createEvaluator(implicit.expr, ['x', 'y'])
        };
    }

    let expr = text
        .replace(/^\s*y\s*=\s*/i, '')
        .replace(/^\s*[a-z_][a-z0-9_]*\s*\(\s*x\s*\)\s*=\s*/i, '')
        .trim();
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
const SHOW_AUTO_ASYMPTOTES_KEY = 'graficador.showAutoAsymptotes.v1';
let showAxisCoords = false;
let showRefCoords = false;
let showRefPoints = false;
let showAutoAsymptotes = true;

function loadBoolKey(key, defaultValue = false) {
    try {
        const value = sessionStorage.getItem(key);
        if (value === null) return !!defaultValue;
        return value === 'true';
    } catch {
        return !!defaultValue;
    }
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
window.onShowAutoAsymptotesChange = (checked) => {
    showAutoAsymptotes = !!checked;
    saveBoolKey(SHOW_AUTO_ASYMPTOTES_KEY, showAutoAsymptotes);
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

    showAxisCoords = loadBoolKey(SHOW_AXIS_COORDS_KEY, false);
    showRefCoords = loadBoolKey(SHOW_REF_COORDS_KEY, false);
    showRefPoints = loadBoolKey(SHOW_REF_POINTS_KEY, false);
    showAutoAsymptotes = loadBoolKey(SHOW_AUTO_ASYMPTOTES_KEY, true);
    const axisCheckbox = document.getElementById('show-axis-coords');
    if (axisCheckbox) axisCheckbox.checked = showAxisCoords;
    const refCheckbox = document.getElementById('show-ref-coords');
    if (refCheckbox) refCheckbox.checked = showRefCoords;
    const refPointsCheckbox = document.getElementById('show-ref-points');
    if (refPointsCheckbox) refPointsCheckbox.checked = showRefPoints;
    const asymptotesCheckbox = document.getElementById('show-auto-asymptotes');
    if (asymptotesCheckbox) asymptotesCheckbox.checked = showAutoAsymptotes;
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
    state.scaleX = 40;
    state.scaleY = 40;
    state.offsetX = canvas.width / 2;
    state.offsetY = canvas.height / 2;
    draw();
    scheduleSessionSave();
    setAxisResetButtonVisible(false);
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

function setAxisResetButtonVisible(isVisible) {
    if (!axisResetButton) return;
    axisResetButton.classList.toggle('hidden', !isVisible);
    axisResetButton.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
}

function getAxisGrabMode(mx, my) {
    const yAxisScreenX = worldToScreenX(0);
    const xAxisScreenY = worldToScreenY(0);
    const yAxisVisible = yAxisScreenX >= -AXIS_GRAB_DISTANCE_PX && yAxisScreenX <= canvas.width + AXIS_GRAB_DISTANCE_PX;
    const xAxisVisible = xAxisScreenY >= -AXIS_GRAB_DISTANCE_PX && xAxisScreenY <= canvas.height + AXIS_GRAB_DISTANCE_PX;

    const nearYAxis = yAxisVisible && Math.abs(mx - yAxisScreenX) <= AXIS_GRAB_DISTANCE_PX;
    const nearXAxis = xAxisVisible && Math.abs(my - xAxisScreenY) <= AXIS_GRAB_DISTANCE_PX;

    if (!nearXAxis && !nearYAxis) return null;
    if (nearXAxis && nearYAxis) {
        return Math.abs(my - xAxisScreenY) <= Math.abs(mx - yAxisScreenX) ? 'x-axis' : 'y-axis';
    }
    return nearXAxis ? 'x-axis' : 'y-axis';
}

function startAxisScalingInteraction(mode, clientX, clientY) {
    state.isAxisScaling = true;
    state.axisScaleMode = mode;
    state.axisScaleStartX = state.scaleX;
    state.axisScaleStartY = state.scaleY;
    state.axisScalePointerStart = mode === 'x-axis' ? clientX : clientY;
    state.axisScaleMoved = false;
    canvas.style.cursor = mode === 'x-axis' ? 'ew-resize' : 'ns-resize';
}

window.addElement = (type) => {
    closeModal('type-selector-modal');
    const nextColor = getNextDistinctColor();
    if (type === 'function') {
        elements.push({ id: Date.now(), type: 'function', content: '', color: nextColor, visible: true });
    } else {
        const centerX = screenToWorldX(canvas.width / 2);
        const centerY = screenToWorldY(canvas.height / 2);
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
        const axisMode = getAxisGrabMode(mx, my);
        if (axisMode) {
            startAxisScalingInteraction(axisMode, e.clientX, e.clientY);
        } else {
            state.isDraggingCanvas = true;
            canvas.style.cursor = 'grabbing';
        }
    }
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
}

function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    document.getElementById('coord-x').textContent = screenToWorldX(mx).toFixed(2);
    document.getElementById('coord-y').textContent = screenToWorldY(my).toFixed(2);

    if (state.isAxisScaling && state.axisScaleMode) {
        const pointer = state.axisScaleMode === 'x-axis' ? e.clientX : e.clientY;
        const delta = state.axisScaleMode === 'x-axis'
            ? (pointer - state.axisScalePointerStart)
            : (state.axisScalePointerStart - pointer);
        const nextScale = clamp(
            (state.axisScaleMode === 'x-axis' ? state.axisScaleStartX : state.axisScaleStartY)
            * Math.exp(delta * AXIS_SCALE_SENSITIVITY),
            MIN_SCALE,
            MAX_SCALE
        );
        if (state.axisScaleMode === 'x-axis') {
            if (Math.abs(nextScale - state.scaleX) > 1e-9) {
                state.scaleX = nextScale;
                state.axisScaleMoved = true;
                scheduleDrawFrame();
            }
        } else if (Math.abs(nextScale - state.scaleY) > 1e-9) {
            state.scaleY = nextScale;
            state.axisScaleMoved = true;
            scheduleDrawFrame();
        }
        return;
    }

    if (state.draggingElementId !== null) {
        const elIndex = elements.findIndex(e => e.id === state.draggingElementId);
        if (elIndex !== -1) {
            elements[elIndex].x = screenToWorldX(mx);
            elements[elIndex].y = screenToWorldY(my);
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
    } else {
        const axisMode = getAxisGrabMode(mx, my);
        if (axisMode === 'x-axis') canvas.style.cursor = 'ew-resize';
        else if (axisMode === 'y-axis') canvas.style.cursor = 'ns-resize';
        else canvas.style.cursor = 'crosshair';
    }
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
}

function handleMouseUp() {
    const usedAxisScale = state.isAxisScaling && state.axisScaleMoved;

    state.isAxisScaling = false;
    state.axisScaleMode = null;
    state.axisScalePointerStart = 0;
    state.axisScaleStartX = state.scaleX;
    state.axisScaleStartY = state.scaleY;
    state.axisScaleMoved = false;
    state.isDraggingCanvas = false;
    state.draggingElementId = null;
    canvas.style.cursor = 'crosshair';

    if (usedAxisScale) {
        setAxisResetButtonVisible(true);
    }

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
    const worldY = screenToWorldY(mouseY);
    const zoomFactor = e.deltaY < 0 ? (1 + zoomIntensity) : (1 - zoomIntensity);

    state.scaleX = clamp(state.scaleX * zoomFactor, MIN_SCALE, MAX_SCALE);
    state.scaleY = clamp(state.scaleY * zoomFactor, MIN_SCALE, MAX_SCALE);
    state.offsetX = mouseX - (worldX * state.scaleX);
    state.offsetY = mouseY + (worldY * state.scaleY);
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
    const effectiveScale = Math.max(Math.min(state.scaleX, state.scaleY), MIN_SCALE);
    const stepPx = effectiveScale < 20 ? 2 : effectiveScale < 50 ? 3 : 4;
    const stepWorld = stepPx / effectiveScale;
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
    const stepX = calculateStep(state.scaleX);
    const stepY = calculateStep(state.scaleY);
    drawGrid(stepX, stepY);
    drawAxes(stepX, stepY);

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
    if (compiled.type === 'function') {
        drawCartesianFunction(compiled, el.color);
        drawFunctionAutoAsymptotes(compiled);
        return;
    }
    if (compiled.type === 'aux-asymptote') return drawAuxiliaryAsymptote(compiled);
    if (compiled.type === 'parametric') return drawParametric(compiled, el.color);
    if (compiled.type === 'polar') return drawPolar(compiled, el.color);
    if (compiled.type === 'implicit') {
        if (Array.isArray(implicitQueue)) implicitQueue.push({ compiled, color: el.color });
        return;
    }
    if (compiled.type === 'segments') return compiled.segments.forEach(segment => drawParametric(segment, el.color));
    if (compiled.type === 'region') return drawRegion(compiled, el.color);
    if (compiled.type === 'attractor') return drawAttractor(compiled, el.color);
}

function drawCartesianFunction(compiled, color) {
    const fn = compiled.fn;
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    if (!isFinite(minX) || !isFinite(maxX) || maxX <= minX) return;

    const baseStepPx = 3;
    const baseIntervals = Math.max(220, Math.floor(canvas.width / baseStepPx));
    const worldStep = (maxX - minX) / baseIntervals;
    const maxDepth = 8;
    const minWorldStep = Math.max(worldStep / Math.pow(2, maxDepth), (maxX - minX) / Math.max(canvas.width * 20, 2200));
    const jumpDeltaPx = Math.max(canvas.height * 0.55, 55);

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;

    let hasStroke = false;
    let penDown = false;
    let lastSx = 0;
    let lastSy = 0;

    const ensureMoveTo = (sx, sy) => {
        if (!penDown) {
            ctx.moveTo(sx, sy);
            penDown = true;
            lastSx = sx;
            lastSy = sy;
            return;
        }
        if (Math.abs(lastSx - sx) > 2 || Math.abs(lastSy - sy) > 2) {
            ctx.moveTo(sx, sy);
            lastSx = sx;
            lastSy = sy;
        }
    };

    const drawLineTo = (sx, sy) => {
        ctx.lineTo(sx, sy);
        hasStroke = true;
        lastSx = sx;
        lastSy = sy;
    };

    const evaluateY = (x) => evaluateCartesianFunction(fn, x);

    const traceInterval = (x0, y0, x1, y1, depth) => {
        const interval = x1 - x0;
        if (!(interval > 0)) return;

        const y0Finite = isFinite(y0);
        const y1Finite = isFinite(y1);
        if (!y0Finite || !y1Finite) {
            if (depth >= maxDepth || interval <= minWorldStep) {
                penDown = false;
                return;
            }
            const xm = (x0 + x1) / 2;
            const ym = evaluateY(xm);
            traceInterval(x0, y0, xm, ym, depth + 1);
            traceInterval(xm, ym, x1, y1, depth + 1);
            return;
        }

        const sx0 = worldToScreenX(x0);
        const sx1 = worldToScreenX(x1);
        const sy0 = worldToScreenY(y0);
        const sy1 = worldToScreenY(y1);
        const endDeltaPx = Math.abs(sy1 - sy0);

        const xm = (x0 + x1) / 2;
        const ym = evaluateY(xm);
        const ymFinite = isFinite(ym);
        const sym = ymFinite ? worldToScreenY(ym) : NaN;
        const linearMid = (sy0 + sy1) / 2;
        const midDeviationPx = ymFinite ? Math.abs(sym - linearMid) : Infinity;

        let likelyDiscontinuity = !ymFinite || midDeviationPx > Math.max(12, endDeltaPx * 0.45);
        if (!likelyDiscontinuity && endDeltaPx > jumpDeltaPx) {
            likelyDiscontinuity = true;
        }

        if (!likelyDiscontinuity) {
            const q1x = (x0 + xm) / 2;
            const q3x = (xm + x1) / 2;
            const yq1 = evaluateY(q1x);
            const yq3 = evaluateY(q3x);
            if (!isFinite(yq1) || !isFinite(yq3)) {
                likelyDiscontinuity = true;
            } else {
                const sq1 = worldToScreenY(yq1);
                const sq3 = worldToScreenY(yq3);
                const envelopeMin = Math.min(sy0, sy1, sym) - 14;
                const envelopeMax = Math.max(sy0, sy1, sym) + 14;
                if (sq1 < envelopeMin || sq1 > envelopeMax || sq3 < envelopeMin || sq3 > envelopeMax) {
                    likelyDiscontinuity = true;
                }
            }
        }

        if (likelyDiscontinuity && depth < maxDepth && interval > minWorldStep) {
            const ymSplit = ymFinite ? ym : evaluateY(xm);
            traceInterval(x0, y0, xm, ymSplit, depth + 1);
            traceInterval(xm, ymSplit, x1, y1, depth + 1);
            return;
        }

        if (likelyDiscontinuity) {
            penDown = false;
            return;
        }

        ensureMoveTo(sx0, sy0);
        drawLineTo(sx1, sy1);
    };

    let x0 = minX;
    let y0 = evaluateY(x0);
    for (let i = 1; i <= baseIntervals; i++) {
        const x1 = (i === baseIntervals) ? maxX : (minX + (i * worldStep));
        const y1 = evaluateY(x1);
        traceInterval(x0, y0, x1, y1, 0);
        x0 = x1;
        y0 = y1;
    }

    if (hasStroke) ctx.stroke();
}

function evaluateCartesianFunction(fn, x) {
    try {
        const y = fn(x);
        return isFinite(y) ? y : NaN;
    } catch {
        return NaN;
    }
}

function refineVerticalAsymptoteCandidate(fn, left, right) {
    const a = Math.min(left, right);
    const b = Math.max(left, right);
    if (!isFinite(a) || !isFinite(b) || b <= a) return null;

    let bestX = (a + b) / 2;
    let bestScore = -Infinity;
    const samples = 24;

    for (let i = 0; i <= samples; i++) {
        const x = a + ((b - a) * i) / samples;
        const y = evaluateCartesianFunction(fn, x);
        if (!isFinite(y)) return x;
        const score = Math.abs(y);
        if (score > bestScore) {
            bestScore = score;
            bestX = x;
        }
    }

    return bestX;
}

function findVerticalAsymptotes(fn, minX, maxX) {
    const span = maxX - minX;
    if (!isFinite(span) || span <= 0) return [];

    const sampleCount = Math.max(300, Math.min(1500, Math.floor(canvas.width * 1.6)));
    const step = span / sampleCount;
    const largeWorldY = Math.max((canvas.height / state.scaleY) * 1.5, 10);
    const candidates = [];
    const suppressionDistance = Math.max(step * 8, 6 / state.scaleX, 1e-4);

    let prevX = minX;
    let prevY = evaluateCartesianFunction(fn, prevX);

    for (let i = 1; i <= sampleCount; i++) {
        const x = minX + i * step;
        const y = evaluateCartesianFunction(fn, x);

        const prevFinite = isFinite(prevY);
        const currFinite = isFinite(y);
        let discontinuity = false;

        if (prevFinite !== currFinite) {
            discontinuity = true;
        } else if (prevFinite && currFinite) {
            const jump = Math.abs(y - prevY);
            if (jump > largeWorldY * 6 && Math.abs(prevY) > largeWorldY * 0.5 && Math.abs(y) > largeWorldY * 0.5) {
                discontinuity = true;
            }
            if (prevY * y < 0 && Math.abs(prevY) > largeWorldY * 1.3 && Math.abs(y) > largeWorldY * 1.3) {
                discontinuity = true;
            }
        }

        if (discontinuity) {
            const candidate = refineVerticalAsymptoteCandidate(fn, prevX, x);
            if (isFinite(candidate)) {
                const last = candidates[candidates.length - 1];
                if (!isFinite(last) || Math.abs(candidate - last) > suppressionDistance) {
                    candidates.push(candidate);
                }
            }
        }

        prevX = x;
        prevY = y;
    }

    const clusterDistance = Math.max(step * 18, 12 / state.scaleX, 1e-3);
    const verifyDelta = Math.max(step * 0.9, span * 0.001);
    const unique = [];
    const clusteredCandidates = [];

    const sorted = candidates
        .filter((candidateX) => isFinite(candidateX) && candidateX > minX && candidateX < maxX)
        .sort((a, b) => a - b);

    let cluster = [];
    const flushCluster = () => {
        if (!cluster.length) return;
        const mid = cluster[Math.floor(cluster.length / 2)];
        if (isFinite(mid)) clusteredCandidates.push(mid);
        cluster = [];
    };

    for (const candidateX of sorted) {
        if (!cluster.length) {
            cluster.push(candidateX);
            continue;
        }
        const lastInCluster = cluster[cluster.length - 1];
        if (Math.abs(candidateX - lastInCluster) <= clusterDistance) {
            cluster.push(candidateX);
        } else {
            flushCluster();
            cluster.push(candidateX);
        }
    }
    flushCluster();

    clusteredCandidates.forEach((candidateX) => {
        if (unique.some((x) => Math.abs(x - candidateX) < clusterDistance * 0.75)) return;

        const yLeft = evaluateCartesianFunction(fn, candidateX - verifyDelta);
        const yRight = evaluateCartesianFunction(fn, candidateX + verifyDelta);
        const yCenter = evaluateCartesianFunction(fn, candidateX);

        const holeLike = isFinite(yLeft)
            && isFinite(yRight)
            && Math.abs(yLeft) < largeWorldY * 0.8
            && Math.abs(yRight) < largeWorldY * 0.8
            && Math.abs(yLeft - yRight) < largeWorldY * 0.4;

        if (holeLike) return;

        const divergesNear = !isFinite(yCenter)
            || !isFinite(yLeft)
            || !isFinite(yRight)
            || (isFinite(yLeft) && Math.abs(yLeft) > largeWorldY)
            || (isFinite(yRight) && Math.abs(yRight) > largeWorldY)
            || (isFinite(yLeft) && isFinite(yRight) && Math.abs(yLeft - yRight) > largeWorldY * 8);

        if (divergesNear) unique.push(candidateX);
    });

    return unique;
}

function estimateEndLinearAsymptote(fn, minX, maxX, direction) {
    const span = Math.max(4, Math.abs(maxX - minX));
    const anchor = direction > 0 ? maxX : minX;
    const d1 = Math.max(span * 2, 12);
    const d2 = Math.max(span * 4, 24);
    const d3 = Math.max(span * 8, 48);
    const d4 = Math.max(span * 14, 84);
    const d5 = Math.max(span * 22, 132);

    const x1 = anchor + direction * d1;
    const x2 = anchor + direction * d2;
    const x3 = anchor + direction * d3;
    const x4 = anchor + direction * d4;
    const x5 = anchor + direction * d5;

    const y1 = evaluateCartesianFunction(fn, x1);
    const y2 = evaluateCartesianFunction(fn, x2);
    const y3 = evaluateCartesianFunction(fn, x3);
    const y4 = evaluateCartesianFunction(fn, x4);
    const y5 = evaluateCartesianFunction(fn, x5);
    if (![y1, y2, y3, y4, y5].every(isFinite)) return null;

    const m12 = (y2 - y1) / (x2 - x1);
    const m23 = (y3 - y2) / (x3 - x2);
    const m34 = (y4 - y3) / (x4 - x3);
    if (![m12, m23, m34].every(isFinite)) return null;

    const slopeSpread = Math.max(m12, m23, m34) - Math.min(m12, m23, m34);
    const slopeMagnitude = Math.max(Math.abs(m12), Math.abs(m23), Math.abs(m34));
    if (slopeSpread > Math.max(0.08, slopeMagnitude * 0.7)) return null;

    const m = (m23 + m34 + ((y4 - y2) / (x4 - x2))) / 3;
    const b2 = y2 - (m * x2);
    const b3 = y3 - (m * x3);
    const b4 = y4 - (m * x4);
    const bValues = [b2, b3, b4];
    const bSpread = Math.max(...bValues) - Math.min(...bValues);
    const bAvg = (b2 + b3 + b4) / 3;
    if (bSpread > Math.max(2.5, Math.abs(bAvg) * 0.35)) return null;

    const pred5 = (m * x5) + bAvg;
    const err5 = Math.abs(y5 - pred5);
    const scale5 = Math.max(1, Math.abs(y5), Math.abs(pred5));
    if (err5 > Math.max(0.35, scale5 * 0.15)) return null;

    const nearX = direction > 0 ? (maxX - span * 0.25) : (minX + span * 0.25);
    const nearY = evaluateCartesianFunction(fn, nearX);
    if (isFinite(nearY)) {
        const nearErr = Math.abs(nearY - ((m * nearX) + bAvg));
        const farErr = Math.abs(y4 - ((m * x4) + bAvg));
        if (!(farErr < nearErr * 0.9 || nearErr > 0.35)) return null;
    }

    if (Math.abs(m) < 0.03) {
        const horizontalY = (y3 + y4 + y5) / 3;
        return { type: 'horizontal', y: horizontalY };
    }

    return { type: 'oblique', m, b: bAvg };
}

function detectLinearAsymptotes(fn, minX, maxX) {
    const sideModels = [
        estimateEndLinearAsymptote(fn, minX, maxX, -1),
        estimateEndLinearAsymptote(fn, minX, maxX, 1)
    ].filter(Boolean);

    const horizontalYs = [];
    const obliqueLines = [];
    sideModels.forEach((model) => {
        if (model.type === 'horizontal' && isFinite(model.y)) horizontalYs.push(model.y);
        if (model.type === 'oblique' && isFinite(model.m) && isFinite(model.b)) obliqueLines.push({ m: model.m, b: model.b });
    });

    const uniqueHorizontal = [];
    horizontalYs.sort((a, b) => a - b).forEach((y) => {
        if (!uniqueHorizontal.some((v) => Math.abs(v - y) < 0.08)) uniqueHorizontal.push(y);
    });

    const uniqueOblique = [];
    obliqueLines.forEach((line) => {
        const exists = uniqueOblique.some((v) => {
            const similarM = Math.abs(v.m - line.m) < 0.03;
            const similarB = Math.abs(v.b - line.b) < Math.max(0.35, Math.abs(line.b) * 0.06);
            return similarM && similarB;
        });
        if (!exists) uniqueOblique.push(line);
    });

    return { horizontalYs: uniqueHorizontal, obliqueLines: uniqueOblique };
}

function getAutoAsymptotes(compiled) {
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);
    const cacheKey = `${minX.toFixed(5)}|${maxX.toFixed(5)}|${state.scaleX.toFixed(4)}|${state.scaleY.toFixed(4)}|${canvas.width}x${canvas.height}`;

    if (compiled._autoAsymptotes && compiled._autoAsymptotes.key === cacheKey) {
        return compiled._autoAsymptotes;
    }

    const verticalXs = findVerticalAsymptotes(compiled.fn, minX, maxX);
    const linear = detectLinearAsymptotes(compiled.fn, minX, maxX);
    compiled._autoAsymptotes = {
        key: cacheKey,
        verticalXs,
        horizontalYs: linear.horizontalYs,
        obliqueLines: linear.obliqueLines
    };
    return compiled._autoAsymptotes;
}

function getAsymptoteColor(kind) {
    const isDark = getResolvedTheme() === 'dark';
    const paletteDark = {
        vertical: '#fb7185',
        horizontal: '#34d399',
        oblique: '#fbbf24'
    };
    const paletteLight = {
        vertical: '#e11d48',
        horizontal: '#047857',
        oblique: '#b45309'
    };
    const palette = isDark ? paletteDark : paletteLight;
    return palette[kind] || palette.oblique;
}

function isAsymptoteOnAxis(value, axis) {
    if (!isFinite(value)) return false;
    const axisScale = axis === 'x' ? state.scaleX : state.scaleY;
    const safeScale = Math.max(axisScale, 1e-6);
    const toleranceWorld = Math.max(1e-9, 2 / safeScale);
    return Math.abs(value) <= toleranceWorld;
}

function drawVerticalGuideLines(xs, alpha = 0.75) {
    if (!Array.isArray(xs) || !xs.length) return;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = hexToRgba(getAsymptoteColor('vertical'), alpha);

    for (const x of xs) {
        if (!isFinite(x)) continue;
        const sx = worldToScreenX(x);
        if (sx < -20 || sx > canvas.width + 20) continue;
        ctx.lineWidth = isAsymptoteOnAxis(x, 'x') ? 3.2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, canvas.height);
        ctx.stroke();
    }

    ctx.restore();
}

function drawHorizontalGuideLines(ys, alpha = 0.68) {
    if (!Array.isArray(ys) || !ys.length) return;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = hexToRgba(getAsymptoteColor('horizontal'), alpha);

    for (const y of ys) {
        if (!isFinite(y)) continue;
        const sy = worldToScreenY(y);
        if (sy < -20 || sy > canvas.height + 20) continue;
        ctx.lineWidth = isAsymptoteOnAxis(y, 'y') ? 3.2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(canvas.width, sy);
        ctx.stroke();
    }

    ctx.restore();
}

function drawObliqueGuideLines(lines, alpha = 0.68) {
    if (!Array.isArray(lines) || !lines.length) return;
    const minX = screenToWorldX(0);
    const maxX = screenToWorldX(canvas.width);

    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hexToRgba(getAsymptoteColor('oblique'), alpha);

    for (const line of lines) {
        if (!line || !isFinite(line.m) || !isFinite(line.b)) continue;
        const y1 = (line.m * minX) + line.b;
        const y2 = (line.m * maxX) + line.b;
        if (!isFinite(y1) || !isFinite(y2)) continue;

        const sy1 = worldToScreenY(y1);
        const sy2 = worldToScreenY(y2);
        const bothAbove = sy1 < -120 && sy2 < -120;
        const bothBelow = sy1 > canvas.height + 120 && sy2 > canvas.height + 120;
        if (bothAbove || bothBelow) continue;

        ctx.beginPath();
        ctx.moveTo(0, sy1);
        ctx.lineTo(canvas.width, sy2);
        ctx.stroke();
    }

    ctx.restore();
}

function drawFunctionAutoAsymptotes(compiled) {
    if (!showAutoAsymptotes || !compiled || compiled.type !== 'function') return;
    const auto = getAutoAsymptotes(compiled);
    drawVerticalGuideLines(auto.verticalXs, 0.7);
    drawHorizontalGuideLines(auto.horizontalYs, 0.65);
    drawObliqueGuideLines(auto.obliqueLines, 0.65);
}

function drawAuxiliaryAsymptote(compiled) {
    if (!compiled || compiled.type !== 'aux-asymptote') return;

    const kindForColor = compiled.kind === 'vertical'
        ? 'vertical'
        : compiled.kind === 'horizontal'
            ? 'horizontal'
            : 'oblique';

    ctx.save();
    ctx.setLineDash([10, 6]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = hexToRgba(getAsymptoteColor(kindForColor), 0.85);

    if (compiled.kind === 'vertical' && isFinite(compiled.x)) {
        ctx.lineWidth = isAsymptoteOnAxis(compiled.x, 'x') ? 3.4 : 1.8;
        const sx = worldToScreenX(compiled.x);
        if (sx >= -30 && sx <= canvas.width + 30) {
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, canvas.height);
            ctx.stroke();
        }
        ctx.restore();
        return;
    }

    if (compiled.kind === 'horizontal' && isFinite(compiled.y)) {
        ctx.lineWidth = isAsymptoteOnAxis(compiled.y, 'y') ? 3.4 : 1.8;
        const sy = worldToScreenY(compiled.y);
        if (sy >= -30 && sy <= canvas.height + 30) {
            ctx.beginPath();
            ctx.moveTo(0, sy);
            ctx.lineTo(canvas.width, sy);
            ctx.stroke();
        }
        ctx.restore();
        return;
    }

    if (compiled.kind === 'line' && typeof compiled.fn === 'function') {
        const minX = screenToWorldX(0);
        const maxX = screenToWorldX(canvas.width);
        const steps = Math.max(120, Math.floor(canvas.width / 3));
        const step = (maxX - minX) / steps;
        let isDrawing = false;

        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const x = minX + i * step;
            const y = evaluateCartesianFunction(compiled.fn, x);
            if (!isFinite(y)) {
                isDrawing = false;
                continue;
            }
            const sx = worldToScreenX(x);
            const sy = worldToScreenY(y);
            if (!isDrawing) {
                ctx.moveTo(sx, sy);
                isDrawing = true;
            } else {
                ctx.lineTo(sx, sy);
            }
        }
        ctx.stroke();
    }

    ctx.restore();
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

function getReferenceStep(x) {
    const scaleX = Math.max(state.scaleX, MIN_SCALE);
    const worldPerPixelX = 1 / scaleX;
    return Math.max(1e-4, worldPerPixelX * 1.5, Math.abs(x) * 1e-6);
}

function getReferenceYTolerance() {
    return Math.max(1e-4, 2 / Math.max(state.scaleY, MIN_SCALE));
}

function numericalDerivative(fn, x) {
    const h = getReferenceStep(x);
    try {
        const yp = fn(x + h);
        const ym = fn(x - h);
        if (!isFinite(yp) || !isFinite(ym)) return NaN;
        return (yp - ym) / (2 * h);
    } catch { return NaN; }
}

function numericalSecondDerivative(fn, x) {
    const h = getReferenceStep(x);
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
    if (!isFinite(step) || step <= 0) return [];
    const MAX_POINTS = 20;
    const results = [];
    const yTolerance = getReferenceYTolerance();
    const slopeNoise = yTolerance / Math.max(step, 1e-9);
    const probeX = Math.max(step * 1.5, 4 / Math.max(state.scaleX, MIN_SCALE));
    let prevX = minX;
    let prevD = numericalDerivative(fn, prevX);
    for (let i = 1; i <= SAMPLES && results.length < MAX_POINTS; i++) {
        const x = minX + i * step;
        const d = numericalDerivative(fn, x);
        const derivativeLooksSignificant = Math.max(Math.abs(prevD), Math.abs(d)) > slopeNoise;
        if (isFinite(prevD) && isFinite(d) && prevD * d < 0 && derivativeLooksSignificant) {
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
                let yLeft;
                let yRight;
                try { cy = fn(cx); } catch { cy = NaN; }
                try { yLeft = fn(cx - probeX); } catch { yLeft = NaN; }
                try { yRight = fn(cx + probeX); } catch { yRight = NaN; }
                if (!isFinite(cy) || !isFinite(yLeft) || !isFinite(yRight)) {
                    prevX = x;
                    prevD = d;
                    continue;
                }

                const isMax = (cy - yLeft) > yTolerance && (cy - yRight) > yTolerance;
                const isMin = (yLeft - cy) > yTolerance && (yRight - cy) > yTolerance;
                if (isMax || isMin) {
                    results.push({ x: cx, y: cy, kind: isMax ? 'max' : 'min' });
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
    if (!isFinite(step) || step <= 0) return [];
    const MAX_POINTS = 20;
    const results = [];
    const yTolerance = getReferenceYTolerance();
    const curvatureNoise = yTolerance / Math.max(step * step, 1e-9);
    const probeX = Math.max(step * 2, 6 / Math.max(state.scaleX, MIN_SCALE));
    let prevX = minX;
    let prevD2 = numericalSecondDerivative(fn, prevX);
    for (let i = 1; i <= SAMPLES && results.length < MAX_POINTS; i++) {
        const x = minX + i * step;
        const d2 = numericalSecondDerivative(fn, x);
        const curvatureLooksSignificant = Math.max(Math.abs(prevD2), Math.abs(d2)) > curvatureNoise;
        if (isFinite(prevD2) && isFinite(d2) && prevD2 * d2 < 0 && curvatureLooksSignificant) {
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
                let d2Left;
                let d2Right;
                try { iy = fn(ix); } catch { iy = NaN; }
                try { d2Left = numericalSecondDerivative(fn, ix - probeX); } catch { d2Left = NaN; }
                try { d2Right = numericalSecondDerivative(fn, ix + probeX); } catch { d2Right = NaN; }
                if (!isFinite(iy) || !isFinite(d2Left) || !isFinite(d2Right)) {
                    prevX = x;
                    prevD2 = d2;
                    continue;
                }

                const changesCurvatureSide = d2Left * d2Right < 0;
                const hasVisibleCurvature = Math.max(Math.abs(d2Left), Math.abs(d2Right)) > curvatureNoise;
                if (changesCurvatureSide && hasVisibleCurvature) {
                    results.push({ x: ix, y: iy });
                }
            }
        }
        prevX = x;
        prevD2 = d2;
    }
    return results;
}

function drawRefLabel(sx, sy, label, color, isDark, preferSide, occupiedRects = null) {
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

    if (Array.isArray(occupiedRects)) {
        const overlapsExisting = occupiedRects.some((rect) => (
            lx < rect.x + rect.w + 4 &&
            lx + bw + 4 > rect.x &&
            ly < rect.y + rect.h + 4 &&
            ly + bh + 4 > rect.y
        ));
        if (overlapsExisting) return false;
        occupiedRects.push({ x: lx, y: ly, w: bw, h: bh });
    }

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
    return true;
}

function drawKeyReferencePoints(fn, color) {
    if (!showRefPoints) return;
    const criticals = findCriticalPoints(fn);
    const inflections = findInflectionPoints(fn);
    if (!criticals.length && !inflections.length) return;
    const isDark = getResolvedTheme() === 'dark';
    const usedLabelRects = [];
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
        if (showRefCoords) drawRefLabel(
            sx,
            sy,
            `(${formatCoord(pt.x)}, ${formatCoord(pt.y)})`,
            color,
            isDark,
            pt.kind === 'max' ? 'above' : 'below',
            usedLabelRects
        );
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
        if (showRefCoords) drawRefLabel(
            sx,
            sy,
            `(${formatCoord(pt.x)}, ${formatCoord(pt.y)})`,
            color,
            isDark,
            'right',
            usedLabelRects
        );
    }
    ctx.restore();
}

function drawAttractor(compiled, color) {
    const { xNextFn, yNextFn, x0, y0, iterations } = compiled;
    const W = canvas.width;
    const H = canvas.height;
    const savedAlpha = ctx.globalAlpha;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = color;
    let x = x0;
    let y = y0;
    for (let i = 0; i < iterations; i++) {
        let nx, ny;
        try {
            nx = xNextFn({ x, y });
            ny = yNextFn({ x, y });
        } catch {
            break;
        }
        x = nx;
        y = ny;
        if (!isFinite(x) || !isFinite(y)) break;
        if (i < 100) continue; // skip transient
        const sx = worldToScreenX(x);
        const sy = worldToScreenY(y);
        if (sx < -1 || sx > W + 1 || sy < -1 || sy > H + 1) continue;
        ctx.fillRect(sx - 0.5, sy - 0.5, 1, 1);
    }
    ctx.globalAlpha = savedAlpha;
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
    const effectiveScale = Math.max(Math.min(state.scaleX, state.scaleY), MIN_SCALE);
    const stepPx = effectiveScale < 20 ? 2 : effectiveScale < 50 ? 3 : 4;
    const stepWorld = stepPx / effectiveScale;
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

function escapeHtmlAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&#39;');
}

function renderElementsList() {
    const container = document.getElementById('elements-container');
    container.innerHTML = '';
    elements.forEach((el, index) => {
        const div = document.createElement('div');
        const safeContent = escapeHtmlAttribute(String(el.content ?? '').replace(/\r?\n/g, ' '));
        const safeColor = /^#[0-9a-fA-F]{6}$/.test(String(el.color || '').trim())
            ? String(el.color).trim()
            : '#3b82f6';
        div.className = `bg-slate-800 p-2 rounded border-l-4 border-slate-700 mb-2 flex items-center gap-2`;
        div.style.borderLeftColor = safeColor;
        let inputHtml = el.type === 'function'
            ? `<input type="text" value="${safeContent}" oninput="updateContent(${index}, this.value)" class="flex-1 bg-slate-900 border-none text-slate-200 text-sm h-8 px-2 rounded font-mono focus:ring-1 focus:ring-blue-500 outline-none" placeholder="y = sin(x) | y = log_{2}(x) | (sin(3t), sin(4t))">`
            : `<input type="text" value="${safeContent}" oninput="updateContent(${index}, this.value)" class="flex-1 bg-slate-900 border-none text-slate-200 text-sm h-8 px-2 rounded font-sans focus:ring-1 focus:ring-emerald-500 outline-none" placeholder="Etiqueta...">`;

        div.innerHTML = `
            <div class="flex flex-col gap-1 w-full">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-slate-500 font-bold uppercase">${el.type === 'function' ? 'FUNC' : 'LBL'}</span>
                    <div class="flex gap-3">
                        <input type="color" value="${safeColor}" oninput="setElementColor(${index}, this.value)" class="color-swatch" aria-label="Color">
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
window.zoomIn = () => {
    state.scaleX = clamp(state.scaleX * 1.2, MIN_SCALE, MAX_SCALE);
    state.scaleY = clamp(state.scaleY * 1.2, MIN_SCALE, MAX_SCALE);
    scheduleDrawFrame();
    scheduleSessionSave();
};
window.zoomOut = () => {
    state.scaleX = clamp(state.scaleX * 0.8, MIN_SCALE, MAX_SCALE);
    state.scaleY = clamp(state.scaleY * 0.8, MIN_SCALE, MAX_SCALE);
    scheduleDrawFrame();
    scheduleSessionSave();
};
window.downloadGraph = downloadGraph;

function drawImplicitToContext(targetCtx, compiled, color) {
    const fn = compiled.fn;
    const effectiveScale = Math.max(Math.min(state.scaleX, state.scaleY), MIN_SCALE);
    const stepPx = effectiveScale < 20 ? 2 : effectiveScale < 50 ? 3 : 4;
    const stepWorld = stepPx / effectiveScale;
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
    if (compiled.type === 'function') {
        drawCartesianFunction(compiled, el.color);
        drawFunctionAutoAsymptotes(compiled);
        return;
    }
    if (compiled.type === 'aux-asymptote') return drawAuxiliaryAsymptote(compiled);
    if (compiled.type === 'parametric') return drawParametric(compiled, el.color);
    if (compiled.type === 'polar') return drawPolar(compiled, el.color);
    if (compiled.type === 'implicit') return drawImplicitToContext(ctx, compiled, el.color);
    if (compiled.type === 'segments') return compiled.segments.forEach(segment => drawParametric(segment, el.color));
    if (compiled.type === 'region') return drawRegion(compiled, el.color);
    if (compiled.type === 'attractor') return drawAttractor(compiled, el.color);
}

function renderExportFrame() {
    cancelImplicitRender();
    const palette = getThemePalette();
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const stepX = calculateStep(state.scaleX);
    const stepY = calculateStep(state.scaleY);
    drawGrid(stepX, stepY);
    drawAxes(stepX, stepY);

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
function drawGrid(stepX, stepY) {
    const palette = getThemePalette();
    const { width, height } = canvas;
    const { scaleX, scaleY, offsetX, offsetY } = state;
    const startX = -offsetX / scaleX;
    const endX = (width - offsetX) / scaleX;
    const minWorldY = (offsetY - height) / scaleY;
    const maxWorldY = offsetY / scaleY;
    ctx.lineWidth = 1;
    for (let x = Math.floor(startX / stepX) * stepX; x <= endX; x += stepX) {
        const screenX = worldToScreenX(x);
        ctx.beginPath(); ctx.strokeStyle = (Math.abs(x % (stepX * 5)) < 0.001) ? palette.gridMajor : palette.gridMinor;
        ctx.moveTo(screenX, 0); ctx.lineTo(screenX, height); ctx.stroke();
    }
    for (let y = Math.floor(minWorldY / stepY) * stepY; y <= maxWorldY; y += stepY) {
        const screenY = worldToScreenY(y);
        ctx.beginPath(); ctx.strokeStyle = (Math.abs(y % (stepY * 5)) < 0.001) ? palette.gridMajor : palette.gridMinor;
        ctx.moveTo(0, screenY); ctx.lineTo(width, screenY); ctx.stroke();
    }
}
function drawAxes(stepX, stepY) {
    const palette = getThemePalette();
    const { width, height } = canvas;
    const { scaleX, scaleY, offsetX, offsetY } = state;
    ctx.lineWidth = 2; ctx.strokeStyle = palette.axis; ctx.fillStyle = palette.label;
    ctx.font = "10px 'Inter', ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const originY = worldToScreenY(0); const originX = worldToScreenX(0);

    if (originY >= -20 && originY <= height + 20) { ctx.beginPath(); ctx.moveTo(0, originY); ctx.lineTo(width, originY); ctx.stroke(); }
    const startX = -offsetX / scaleX; const endX = (width - offsetX) / scaleX;
    for (let x = Math.floor(startX / stepX) * stepX; x <= endX; x += stepX) {
        if (Math.abs(x) < 0.001) continue;
        const screenX = worldToScreenX(x);
        ctx.beginPath(); ctx.moveTo(screenX, originY - 3); ctx.lineTo(screenX, originY + 3); ctx.stroke();
        let labelY = originY + 6; if (originY < 0) labelY = 6; if (originY > height - 20) labelY = height - 16;
        ctx.fillText(formatNumber(x), screenX, labelY);
    }
    if (originX >= -20 && originX <= width + 20) { ctx.beginPath(); ctx.moveTo(originX, 0); ctx.lineTo(originX, height); ctx.stroke(); }
    const minWorldY = (offsetY - height) / scaleY; const maxWorldY = offsetY / scaleY;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = Math.floor(minWorldY / stepY) * stepY; y <= maxWorldY; y += stepY) {
        if (Math.abs(y) < 0.001) continue;
        const screenY = worldToScreenY(y);
        ctx.beginPath(); ctx.moveTo(originX - 3, screenY); ctx.lineTo(originX + 3, screenY); ctx.stroke();
        let labelX = originX - 6; if (originX < 30) labelX = 30; if (originX > width) labelX = width - 10;
        ctx.fillText(formatNumber(y), labelX, screenY);
    }
}
function formatNumber(n) { return Number.isInteger(n) ? n.toString() : n.toFixed(1).replace(/\.0$/, ''); }
function worldToScreenX(wx) { return (wx * state.scaleX) + state.offsetX; }
function worldToScreenY(wy) { return state.offsetY - (wy * state.scaleY); }
function screenToWorldX(sx) { return (sx - state.offsetX) / state.scaleX; }
function screenToWorldY(sy) { return (state.offsetY - sy) / state.scaleY; }

init();
