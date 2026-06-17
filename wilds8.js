// ==UserScript==
// @name         Visca Tools (Organized & Readable)
// @namespace    http://tampermonkey.net/
// @version      2.0.7
// @description  Fully organized version of ViscaTools for Discord
// @author       You
// @match        https://discord.com/*
// @run-at       document-idle
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js
// @require      https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/forge/1.3.1/forge.min.js
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // SECTION 1: UTILITIES & CRYPTO (ForgeJS Wrapper)
    // ==========================================
    const CryptoUtils = {
        /**
         * Encrypts a token using AES-GCM with PBKDF2 key derivation.
         * @param {string} token - The Discord token to encrypt.
         * @param {string} password - The password for encryption.
         * @returns {string|null} Base64 encoded encrypted string or null on error.
         */
        encryptToken: async (token, password) => {
            try {
                const forge = window.forge;
                if (!forge) throw new Error("Forge library not loaded");

                const salt = forge.random.getBytesSync(16);
                const iv = forge.random.getBytesSync(12);
                
                // Derive key using PBKDF2
                const key = forge.pkcs5.pbkdf2(password, salt, 100000, 32, forge.md.sha256.create());
                
                // Create Cipher
                const cipher = forge.cipher.createCipher('AES-GCM', key);
                cipher.start({ iv: iv, tagLength: 128 });
                cipher.update(forge.util.createBuffer(token, 'utf8'));
                cipher.finish();

                const encrypted = cipher.output.getBytes();
                const tag = cipher.mode.tag.getBytes();
                
                // Combine Salt + IV + Tag + Encrypted Data
                return forge.util.encode64(salt + iv + tag + encrypted);
            } catch (e) {
                console.error("[ViscaTools] Encryption failed:", e);
                return null;
            }
        },

        /**
         * Finds a module in Discord's Webpack cache.
         * @param {function} filter - Filter function to identify the module.
         * @returns {object|null} The found module or null.
         */
        findModule: (filter) => {
            if (!window.webpackChunkdiscord_app) return null;
            
            // Push a dummy chunk to get access to the require function
            const wpRequire = window.webpackChunkdiscord_app.push([
                [Symbol()], {}, req => req
            ]);
            
            const cache = wpRequire.c;
            if (!cache) return null;

            for (const id in cache) {
                if (cache.hasOwnProperty(id)) {
                    const m = cache[id].exports;
                    if (m && typeof m === "object" && filter(m)) {
                        return m;
                    }
                }
            }
            return null;
        }
    };

    // ==========================================
    // SECTION 2: CORE MANAGER (Discord API Interaction)
    // ==========================================
    class ViscaManager {
        constructor() {
            this.token = null;
            this.api = null;
            this.dispatcher = null;
            this.loaded = false;
        }

        async init() {
            if (this.loaded) return;

            // Find essential Discord modules
            const fluxDispatcher = CryptoUtils.findModule(m => m.dispatch && m.subscribe);
            const apiModule = CryptoUtils.findModule(m => m.get && m.post && m.patch);
            const authStore = CryptoUtils.findModule(m => m.getToken && typeof m.getToken === 'function');

            if (fluxDispatcher && apiModule && authStore) {
                this.dispatcher = fluxDispatcher;
                this.api = apiModule;
                this.token = authStore.getToken();
                this.loaded = true;
                console.log("[ViscaTools] Core initialized successfully.");
            } else {
                console.warn("[ViscaTools] Failed to initialize core modules. Retrying...");
                setTimeout(() => this.init(), 1000);
            }
        }

        getToken() {
            if (!this.token) {
                const authStore = CryptoUtils.findModule(m => m.getToken && typeof m.getToken === 'function');
                if (authStore) this.token = authStore.getToken();
            }
            return this.token;
        }

        async getQuests() {
            if (!this.api) await this.init();
            try {
                const res = await this.api.get({ url: "/quests/@me" });
                return res?.body?.quests || [];
            } catch (e) {
                console.error("[ViscaTools] Failed to fetch quests:", e);
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
                console.error(`[ViscaTools] Failed to enroll quest ${questId}:`, e);
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
                console.error(`[ViscaTools] Failed to claim quest ${questId}:`, e);
                return false;
            }
        }
    }

    const manager = new ViscaManager();

    // ==========================================
    // SECTION 3: UI COMPONENTS (React + Tailwind)
    // ==========================================
    const { useState, useEffect } = React;
    const { jsx, jsxs } = React.createElement; // Fallback for JSX runtime

    // --- Toast Notification Component ---
    const Toast = ({ message, type }) => {
        if (!message) return null;
        const bgClass = type === 'error' ? 'bg-red-500/90 border-red-400' : 'bg-emerald-500/90 border-emerald-400';
        
        return jsx('div', {
            className: `fixed top-24 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 rounded-full text-white text-xs font-bold shadow-lg backdrop-blur-md border animate-fade-in-down ${bgClass}`,
            children: message
        });
    };

    // --- Main Panel Component ---
    const ViscaPanel = () => {
        const [isDark, setIsDark] = useState(true);
        const [toast, setToast] = useState({ msg: '', type: 'success' });
        const [loading, setLoading] = useState(false);
        const [isOpen, setIsOpen] = useState(true);

        // Helper to show toast messages
        const showToast = (msg, type = 'success') => {
            setToast({ msg, type });
            setTimeout(() => setToast({ msg: '', type: 'success' }), 3000);
        };

        // Helper to handle button actions with loading state
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

        // Define Buttons and their Actions
        const actions = [
            {
                id: 'copy-token',
                label: "Copy Token",
                icon: "🔑",
                fn: async () => {
                    const token = manager.getToken();
                    if (token) {
                        await navigator.clipboard.writeText(token);
                        return true;
                    }
                    throw new Error("Token not found");
                },
                success: "Token copied to clipboard!",
                error: "Failed to copy token."
            },
            {
                id: 'enroll-all',
                label: "Enroll All Quests",
                icon: "",
                fn: async () => {
                    const quests = await manager.getQuests();
                    const pending = quests.filter(q => !q.userStatus?.enrolledAt);
                    if (pending.length === 0) throw new Error("No pending quests found.");
                    
                    let count = 0;
                    for (const q of pending) {
                        if (await manager.enrollQuest(q.id)) count++;
                    }
                    return count > 0;
                },
                success: "Enrolled all pending quests!",
                error: "No quests were enrolled."
            },
            {
                id: 'claim-all',
                label: "Claim All Rewards",
                icon: "🎁",
                fn: async () => {
                    const quests = await manager.getQuests();
                    const claimable = quests.filter(q => q.userStatus?.completedAt && !q.userStatus?.claimedAt);
                    if (claimable.length === 0) throw new Error("No claimable rewards found.");

                    let count = 0;
                    for (const q of claimable) {
                        if (await manager.claimQuest(q.id)) count++;
                    }
                    return count > 0;
                },
                success: "Claimed all available rewards!",
                error: "No rewards were claimed."
            },
            {
                id: 'copy-enc-token',
                label: "Copy Encrypted Token",
                icon: "🔒",
                fn: async () => {
                    const token = manager.getToken();
                    if (!token) throw new Error("Token not found");
                    // Note: You might want to prompt for a password here in a real UI
                    const password = "default_password"; 
                    const enc = await CryptoUtils.encryptToken(token, password);
                    if (enc) {
                        await navigator.clipboard.writeText(enc);
                        return true;
                    }
                    throw new Error("Encryption failed");
                },
                success: "Encrypted token copied!",
                error: "Failed to encrypt token."
            }
        ];

        // Theme Classes
        const theme = isDark ? {
            bg: 'bg-[#1a1a38]/80',
            border: 'border-white/10',
            text: 'text-white',
            subText: 'text-gray-400',
            btnBg: 'bg-white/5 hover:bg-white/10',
            btnBorder: 'border-white/10 hover:border-indigo-400/50',
            btnText: 'text-gray-200 hover:text-indigo-300',
            glow: 'shadow-[0_0_20px_rgba(99,102,241,0.2)]'
        } : {
            bg: 'bg-white/80',
            border: 'border-black/10',
            text: 'text-slate-800',
            subText: 'text-slate-500',
            btnBg: 'bg-black/5 hover:bg-black/10',
            btnBorder: 'border-black/10 hover:border-indigo-500/50',
            btnText: 'text-slate-700 hover:text-indigo-600',
            glow: 'shadow-[0_0_20px_rgba(0,0,0,0.1)]'
        };

        return jsxs('div', {
            className: `fixed top-6 right-6 z-[99998] w-80 p-5 rounded-2xl border backdrop-blur-xl transition-all duration-500 ${theme.bg} ${theme.border} ${theme.text} ${theme.glow}`,
            children: [
                // Toast
                jsx(Toast, { message: toast.msg, type: toast.type }),

                // Header
                jsxs('div', { className: "flex justify-between items-center mb-6 pb-4 border-b border-current/10", children: [
                    jsxs('div', { className: "flex flex-col", children: [
                        jsx('span', { className: "font-black text-lg tracking-tighter uppercase", children: "Visca Tools" }),
                        jsx('span', { className: `text-[10px] font-bold ${theme.subText} uppercase tracking-widest`, children: "V2.0 Premium" })
                    ]}),
                    jsx('button', { 
                        onClick: () => setIsDark(!isDark),
                        className: `p-2 rounded-lg transition-all ${theme.btnBg} ${theme.btnBorder}`,
                        children: isDark ? "☀️" : "🌙"
                    })
                ]}),

                // Buttons Grid
                jsx('div', { className: "flex flex-col gap-3", children: 
                    actions.map((act) => 
                        jsx('button', {
                            key: act.id,
                            onClick: () => handleAction(act.fn, act.success, act.error),
                            disabled: loading,
                            className: `w-full py-3 px-4 rounded-xl border text-xs font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between group ${theme.btnBg} ${theme.btnBorder} ${theme.btnText}`,
                            children: jsxs('div', { className: "flex items-center gap-3", children: [
                                jsx('span', { className: "text-lg", children: act.icon }),
                                jsx('span', { children: act.label }),
                                loading && jsx('svg', { className: "animate-spin h-4 w-4 ml-auto", viewBox: "0 0 24 24", children: [
                                    jsx('circle', { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4", fill: "none" }),
                                    jsx('path', { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" })
                                ]})
                            ]})
                        }, act.id)
                    )
                }),

                // Footer
                jsx('div', { className: "mt-6 pt-4 border-t border-current/10 text-[10px] opacity-40 text-center", children: "Made with ❤️ by Visca Team" })
            ]
        });
    };

    // ==========================================
    // SECTION 4: INJECTION LOGIC
    // ==========================================
    const injectUI = () => {
        if (document.getElementById('visca-tools-root')) return;

        // Create Root Container
        const root = document.createElement('div');
        root.id = 'visca-tools-root';
        root.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647; pointer-events: none;';
        
        // Attach Shadow DOM for style isolation
        const shadow = root.attachShadow({ mode: 'open' });
        const appContainer = document.createElement('div');
        appContainer.id = 'app-inner';
        appContainer.style.pointerEvents = 'auto';
        shadow.appendChild(appContainer);

        // Inject Global Styles (Tailwind-like utilities & Animations)
        const style = document.createElement('style');
        style.textContent = `
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font-primary, sans-serif); }
            button { cursor: pointer; border: none; outline: none; background: transparent; }
            .animate-fade-in-down { animation: fadeInDown 0.3s ease-out forwards; }
            @keyframes fadeInDown { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
        `;
        shadow.appendChild(style);

        document.body.appendChild(root);

        // Render React App
        if (typeof React !== 'undefined' && typeof ReactDOM !== 'undefined') {
            ReactDOM.render(jsx(ViscaPanel, {}), appContainer);
        } else {
            console.error("[ViscaTools] React not found. Waiting for libraries...");
            // Retry logic could be added here if needed
        }
    };

    // Initialize when Discord is ready
    const checkDiscordReady = setInterval(() => {
        if (window.webpackChunkdiscord_app && document.body && window.forge) {
            clearInterval(checkDiscordReady);
            manager.init().then(injectUI);
        }
    }, 500);

})();