const Meta = imports.gi.Meta;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Gdk = imports.gi.Gdk;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const SignalManager = imports.misc.signalManager;
const {globalLogger: logger} = require('src/logger');
const {ScreenWatcher} = require('src/screen-watcher');
const {callSafely} = require('src/utils');
const {saveWindowState, restoreWindowState} = require('src/window-utils');

class BackToMonitorExtension {
    constructor(meta) {
        this._meta = meta;
        this._windowsSavedStates = new Map();
        this._monitorDisconnectedWindows = new Map();
    }

    enable() {
        const rrScreen = CinnamonDesktop.RRScreen.new(Gdk.Screen.get_default());
        this._screenWatcher = new ScreenWatcher(global.screen, rrScreen);
        this._screenWatcher.register();

        this._signalManager = new SignalManager.SignalManager(null);
        this._signalManager.connect(this._screenWatcher, 'output-disconnected', this._onOutputDisconnected);
        this._signalManager.connect(this._screenWatcher, 'output-connected', this._onOutputConnected);
        this._signalManager.connect(this._screenWatcher, 'monitor-unloaded', this._onMonitorUnloaded);
        this._signalManager.connect(this._screenWatcher, 'monitor-loaded', this._onMonitorLoaded);
        this._signalManager.connect(global.screen, 'window-removed', this._onWindowRemoved);
    }

    disable() {
        if (this._screenWatcher) {
            this._screenWatcher.unregister();
        }

        if (this._signalManager) {
            this._signalManager.disconnectAllSignals();
        }
    }

    _onOutputDisconnected = (_, {outputName, pos, monitorIndex}) => {
        const time = Date.now();

        const disconnectedWindows = new Set();
        this._monitorDisconnectedWindows.set(outputName, disconnectedWindows);

        for (const metaWindow of global.display.list_windows(0)) {
            if (metaWindow.get_monitor() !== monitorIndex) {
                continue;
            }

            if (true && metaWindow.can_move()) {
                // TODO: Add an option to disable state save (globally or for some outputs)
                const windowState = callSafely(() => saveWindowState(metaWindow));
                if (windowState) {
                    // Transform x and y to relative positions
                    windowState.x -= pos.x;
                    windowState.y -= pos.y;

                    // Save
                    // logger.log(`Save '${metaWindow.get_title()}': ${JSON.stringify(windowState)}`); // TODO: Log this?
                    let savedStates = this._windowsSavedStates.get(metaWindow);
                    if (!savedStates) {
                        this._windowsSavedStates.set(metaWindow, (savedStates = new Map()));
                    }
                    savedStates.set(outputName, {windowState, time});
                }
            }

            disconnectedWindows.add(metaWindow);
        }
    };

    _onOutputConnected = (_, {outputName, pos, monitorIndex}) => {
        this._monitorDisconnectedWindows.delete(outputName);
    };

    _onMonitorUnloaded = (_, {outputName, pos, monitorIndex}) => {
        const disconnectedWindows = this._monitorDisconnectedWindows.get(outputName);
        if (disconnectedWindows) {
            this._monitorDisconnectedWindows.delete(outputName);

            for (const metaWindow of disconnectedWindows) {
                if (true && metaWindow.can_minimize()) {
                    // TODO: Add an option to disable auto-minimize (globally or for some outputs)
                    metaWindow.minimize();
                }
            }
        }
    };

    _onMonitorLoaded = (_, {outputName, pos, monitorIndex}) => {
        const time = Date.now();

        for (const [metaWindow, savedStates] of this._windowsSavedStates.entries()) {
            let state = savedStates.get(outputName);
            if (state) {
                // Cleanup this state and all younger states
                savedStates.delete(outputName);
                for (const [k, otherState] of savedStates.entries()) {
                    if (otherState.time >= state.time) {
                        savedStates.delete(k);
                    }
                }

                // Transform x and y to absolute positions
                const windowState = state.windowState;
                windowState.x += pos.x;
                windowState.y += pos.y;

                // Restore
                logger.log(`Restore '${metaWindow.get_title()}': ${JSON.stringify(windowState)}`);
                callSafely(() => restoreWindowState(metaWindow, windowState));
            }
        }
    };

    _onWindowRemoved = (_, metaWindow) => {
        // Free saved states memory
        this._windowsSavedStates.delete(metaWindow);
        for (const disconnectedWindows of this._monitorDisconnectedWindows.values()) {
            disconnectedWindows.delete(metaWindow);
        }
    };
}

module.exports = {BackToMonitorExtension};
