// ==UserScript==
// @name         Visca Tools (Clean & Organized)
// @namespace    http://tampermonkey.net/
// @version      2.0.7
// @description  Clean version of Visca Tools for Discord Quests & Tokens
// @author       TRK
// @match        https://discord.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. UTILITIES & ENCRYPTION
    // ==========================================
    const Utils = {
        encryptToken: async (token, password) => {
            try {
                // Note: This assumes forge.js or similar crypto lib is available globally 
                // as per the original minified code structure.
                const salt = window.forge.random.getBytesSync(16);
                const iv = window.forge.random.getBytesSync(12);
                const key = window.forge.pkcs5.pbkdf2(password, salt, 100000, 32, window.forge.md.sha256.create());
                const cipher = window.forge.cipher.createCipher('AES-GCM', key);
                cipher.start({ iv: iv, tagLength: 128 });
                cipher.update(window.forge.util.createBuffer(token, 'utf8'));
                cipher.finish();
                
                const encrypted = cipher.output.getBytes();
                const tag = cipher.mode.tag.getBytes();
                return window.forge.util.encode64(salt + iv + tag + encrypted);
            } catch (e) {
                console.error("Encryption failed:", e);
                return null;
            }
        },

        // Helper to find modules in Discord's webpack
        findModule: (filter) => {
            const wpRequire = window.webpackChunkdiscord_app.push([
                [Symbol()], {}, req => req
            ]);
            const cache = wpRequire.c;
            if (!cache) return null;
            
            for (const id in cache) {
                if (cache.hasOwnProperty(id)) {
                    const m = cache[id].exports;
                    if (m && typeof m === "object" && filter(m)) return m;
                }
            }
            return null;
        }
    };

    // ==========================================
    // 2. CORE MANAGER CLASS
    // ==========================================
    class ViscaManager {
        constructor() {
            this.token = null;
            this.api = null;
            this.loaded = false;
        }

        async init() {
            if (this.loaded) return;
            
            // Find essential Discord modules
            const fluxDispatcher = Utils.findModule(m => m.dispatch && m.subscribe);
            const apiModule = Utils.findModule(m => m.get && m.post && m.patch);
            
            if (fluxDispatcher && apiModule) {
                this.dispatcher = fluxDispatcher;
                this.api = apiModule;
                this.loaded = true;
                console.log("[ViscaTools] Core initialized successfully.");
            } else {
                console.warn("[ViscaTools] Failed to initialize core modules.");
            }
        }

        getToken() {
            if (this.token) return this.token;
            const authStore = Utils.findModule(m => m.getToken && typeof m.getToken === 'function');
            if (authStore) {
                this.token = authStore.getToken();
                return this.token;
            }
            return null;
        }

        async getQuests() {
            if (!this.api) await this.init();
            try {
                const res = await this.api.get({ url: "/quests/@me" });
                return res?.body?.quests || [];
            } catch (e) {
                console.error("Failed to fetch quests:", e);
                return [];
            }
        }

        async enrollQuest(questId) {
            if (!this.api) await this.init();
            try {
                const res = await this.api.post({
                    url: `/quests/${questId}/enroll`,
                    body: { location: 11, is_targeted: false }
                });
                return !!res?.body?.enrolled_at;
            } catch (e) {
                console.error(`Failed to enroll quest ${questId}:`, e);
                return false;
            }
        }

        async claimQuest(questId) {
            if (!this.api) await this.init();
            try {
                const res = await this.api.post({
                    url: `/quests/${questId}/claim-reward`,
                    body: { platform: 0, location: 11, is_targeted: false }
                });
                return !!res?.body?.claimed_at;
            } catch (e) {
                console.error(`Failed to claim quest ${questId}:`, e);
                return false;
            }
        }
    }

    const manager = new ViscaManager();

    // ==========================================
    // 3. UI COMPONENTS (React)
    // ==========================================
    const { useState, useEffect } = React;
    const { jsx, jsxs } = ReactJSXRuntime || React.createElement; // Fallback handling

    // Simple Toast Component
    const Toast = ({ message, type }) => {
        if (!message) return null;
        const bg = type === 'error' ? 'bg-red-500' : 'bg-emerald-500';
        return jsx('div', {
            className: `fixed top-24 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 rounded-full text-white text-xs font-bold shadow-lg animate-fade-in ${bg}`,
            children: message
        });
    };

    // Main Panel Component
    const ViscaPanel = () => {
        const [isDark, setIsDark] = useState(true);
        const [toast, setToast] = useState({ msg: '', type: 'success' });
        const [loading, setLoading] = useState(false);

        const showToast = (msg, type = 'success') => {
            setToast({ msg, type });
            setTimeout(() => setToast({ msg: '', type: 'success' }), 3000);
        };

        const handleAction = async (actionFn, successMsg, errorMsg) => {
            setLoading(true);
            try {
                const result = await actionFn();
                if (result) showToast(successMsg, 'success');
                else showToast(errorMsg || 'Action failed', 'error');
            } catch (err) {
                showToast(err.message || 'Unexpected error', 'error');
            } finally {
                setLoading(false);
            }
        };

        const actions = [
            {
                label: "Copy Token",
                fn: async () => {
                    const token = manager.getToken();
                    if (token) {
                        await navigator.clipboard.writeText(token);
                        return true;
                    }
                    throw new Error("Token not found");
                },
                success: "Token copied!"
            },
            {
                label: "Enroll All Quests",
                fn: async () => {
                    const quests = await manager.getQuests();
                    const pending = quests.filter(q => !q.userStatus?.enrolledAt);
                    if (pending.length === 0) throw new Error("No pending quests");
                    
                    let count = 0;
                    for (const q of pending) {
                        if (await manager.enrollQuest(q.id)) count++;
                    }
                    return count > 0;
                },
                success: "Enrolled all pending quests!",
                error: "No quests enrolled."
            },
            {
                label: "Claim All Quests",
                fn: async () => {
                    const quests = await manager.getQuests();
                    const claimable = quests.filter(q => q.userStatus?.completedAt && !q.userStatus?.claimedAt);
                    if (claimable.length === 0) throw new Error("No claimable quests");

                    let count = 0;
                    for (const q of claimable) {
                        if (await manager.claimQuest(q.id)) count++;
                    }
                    return count > 0;
                },
                success: "Claimed all rewards!",
                error: "No rewards claimed."
            }
        ];

        // Theme classes
        const theme = isDark ? {
            bg: 'bg-[#1a1a38]', border: 'border-[#35334e]', text: 'text-white', btn: 'bg-[#222144] hover:bg-[#3e3b68]'
        } : {
            bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-800', btn: 'bg-slate-100 hover:bg-slate-200'
        };

        return jsxs('div', {
            className: `fixed top-6 right-6 z-[99998] w-72 p-4 rounded-2xl border shadow-2xl backdrop-blur-md transition-all duration-300 ${theme.bg} ${theme.border} ${theme.text}`,
            children: [
                jsx(Toast, { message: toast.msg, type: toast.type }),
                
                // Header
                jsxs('div', { className: "flex justify-between items-center mb-4 pb-2 border-b border-current/10", children: [
                    jsx('span', { className: "font-black text-sm tracking-wider uppercase", children: "Visca Tools" }),
                    jsx('button', { 
                        onClick: () => setIsDark(!isDark),
                        className: "p-1.5 rounded-lg opacity-70 hover:opacity-100 transition-opacity",
                        children: isDark ? "☀️" : "🌙"
                    })
                ]}),

                // Buttons Grid
                jsx('div', { className: "flex flex-col gap-2", children: 
                    actions.map((act, i) => 
                        jsx('button', {
                            onClick: () => handleAction(act.fn, act.success, act.error),
                            disabled: loading,
                            className: `w-full py-2.5 px-3 rounded-xl text-xs font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${theme.btn}`,
                            children: act.label
                        }, i)
                    )
                }),

                // Footer
                jsx('div', { className: "mt-4 pt-2 border-t border-current/10 text-[10px] opacity-40 text-center", children: "v2.0.7 • Clean Edition" })
            ]
        });
    };

    // ==========================================
    // 4. INJECTION LOGIC
    // ==========================================
    const injectUI = () => {
        if (document.getElementById('visca-tools-root')) return;

        const root = document.createElement('div');
        root.id = 'visca-tools-root';
        root.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647; pointer-events: none;';
        
        const shadow = root.attachShadow({ mode: 'open' });
        const appContainer = document.createElement('div');
        appContainer.id = 'app-inner';
        appContainer.style.pointerEvents = 'auto';
        shadow.appendChild(appContainer);

        // Inject Tailwind-like styles if needed, or rely on Discord's existing classes
        // For this clean version, we use inline styles and standard CSS classes 
        // that should work within Shadow DOM if we add a style tag, 
        // but for simplicity, we assume basic CSS works or add minimal reset.
        const style = document.createElement('style');
        style.textContent = `
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font-primary); }
            button { cursor: pointer; border: none; outline: none; }
            .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
            @keyframes fadeIn { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
        `;
        shadow.appendChild(style);

        document.body.appendChild(root);

        // Render React App
        if (typeof React !== 'undefined' && typeof ReactDOM !== 'undefined') {
            ReactDOM.render(jsx(ViscaPanel, {}), appContainer);
        } else {
            console.error("[ViscaTools] React not found. Waiting...");
            // Retry logic could be added here
        }
    };

    // Initialize when Discord is ready
    const checkDiscordReady = setInterval(() => {
        if (window.webpackChunkdiscord_app && document.body) {
            clearInterval(checkDiscordReady);
            manager.init().then(injectUI);
        }
    }, 500);

})();

