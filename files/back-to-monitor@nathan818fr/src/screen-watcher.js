const ByteArray = imports.byteArray;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const SignalManager = imports.misc.signalManager;
const Signals = imports.signals;
const {globalLogger: logger} = require('src/logger');
const {callSafely, delayQueue} = require('src/utils');

class ScreenWatcher {
    constructor(metaScreen, rrScreen) {
        this._metaScreen = metaScreen;
        this._rrScreen = rrScreen;
    }

    register() {
        this._outputsPos = new Map();
        this._pendingMonitors = new Map();
        this._signalManager = new SignalManager.SignalManager(null);

        this._loading = true;
        try {
            this._signalManager.connect(this._rrScreen, 'changed', this._onRRScreenChanged);
            this._signalManager.connect(
                this._metaScreen,
                'monitors-changed',
                delayQueue(1000, this._onMonitorsChanged)
            );

            this._onRRScreenChanged(this._rrScreen);
        } finally {
            this._loading = false;
        }
    }

    unregister() {
        if (this._signalManager) {
            this._signalManager.disconnectAllSignals();
            this._signalManager = null;
        }
    }

    _onRRScreenChanged = () => {
        // NOTE: Can't use RROutput.get_position because it requires output arguments (not available with CJS).
        // So instead call the xrandr command :'(
        const rrOutputsPos = this._captureRROutputsPosition();

        const rrOutputs = this._rrScreen.list_outputs();
        for (const rrOutput of rrOutputs) {
            const name = rrOutput.get_name();
            const pos = rrOutputsPos[name];
            const prevPos = this._outputsPos.get(name);

            if (pos) {
                this._outputsPos.set(name, pos);
                if (!prevPos && !this._loading) {
                    callSafely(() => this._onOutputConnected(name, pos));
                }
            } else if (prevPos) {
                this._outputsPos.delete(name);
                if (!this._loading) {
                    callSafely(() => this._onOutputDisconnected(name, prevPos));
                }
            }
        }
    };

    _onOutputConnected = (name, pos) => {
        const monitorIndex = this._getMonitorIndexAt(pos.x, pos.y);
        logger.log(`Output connected: ${name} (x: ${pos.x}, y: ${pos.y}, index: ${monitorIndex})`);

        const monitorChangeCancelled = this._pendingMonitors.has(name);
        if (monitorChangeCancelled) {
            this._pendingMonitors.delete(name);
        } else {
            this._pendingMonitors.set(name, {connected: true, pos});
        }

        this.emit('output-connected', {outputName: name, pos, monitorIndex, monitorChangeCancelled});
    };

    _onOutputDisconnected = (name, pos) => {
        const monitorIndex = this._getMonitorIndexAt(pos.x, pos.y);
        logger.log(`Output disconnected: ${name} (x: ${pos.x}, y: ${pos.y}, index: ${monitorIndex})`);

        const monitorChangeCancelled = this._pendingMonitors.has(name);
        if (monitorChangeCancelled) {
            this._pendingMonitors.delete(name);
        } else {
            this._pendingMonitors.set(name, {connected: false, pos});
        }

        this.emit('output-disconnected', {outputName: name, pos, monitorIndex, monitorChangeCancelled});
    };

    _onMonitorsChanged = () => {
        try {
            logger.log(
                `Monitors changed (${
                    !this._pendingMonitors.size
                        ? 'no changed outputs'
                        : `changed outputs: ${[...this._pendingMonitors.keys()].join(', ')}`
                })`
            );

            for (const [name, {connected, pos}] of this._pendingMonitors.entries()) {
                if (connected) {
                    callSafely(() => this._onMonitorLoaded(name, pos));
                } else {
                    callSafely(() => this._onMonitorUnloaded(name, pos));
                }
            }
        } finally {
            this._pendingMonitors.clear();
        }
    };

    _onMonitorLoaded = (name, pos) => {
        const monitorIndex = this._getMonitorIndexAt(pos.x, pos.y);
        logger.log(`Monitor loaded: ${name} (x: ${pos.x}, y: ${pos.y}, index: ${monitorIndex})`);

        this.emit('monitor-loaded', {outputName: name, pos, monitorIndex});
    };

    _onMonitorUnloaded = (name, pos) => {
        const monitorIndex = this._getMonitorIndexAt(pos.x, pos.y);
        logger.log(`Monitor unloaded: ${name} (x: ${pos.x}, y: ${pos.y}, index: ${monitorIndex})`);

        this.emit('monitor-unloaded', {outputName: name, pos, monitorIndex});
    };

    _captureRROutputsPosition = () => {
        let [, xrandrStdout] = GLib.spawn_command_line_sync('xrandr --current');
        xrandrStdout = xrandrStdout ? ByteArray.toString(xrandrStdout) : '';

        // See xrandr output sources: https://github.com/freedesktop/xorg-xrandr/blob/8969b3c651eaae3e3a2370ec45f4eeae9750111d/xrandr.c#L3697
        const pattern =
            /^([^ ]+) (?:connected|disconnected|unknown connection)(?: primary)? -?[0-9]+x-?[0-9]+\+(-?[0-9]+)\+(-?[0-9]+)/gm;
        const ret = {};
        for (const [_, name, x, y] of xrandrStdout.matchAll(pattern)) {
            ret[name] = {x: parseInt(x), y: parseInt(y)};
        }
        return ret;
    };

    _getMonitorIndexAt = (x, y) => {
        const rect = new Meta.Rectangle();
        rect.x = x;
        rect.y = y;
        rect.width = 1;
        rect.height = 1;
        return this._metaScreen.get_monitor_index_for_rect(rect);
    };
}

Signals.addSignalMethods(ScreenWatcher.prototype);

module.exports = {ScreenWatcher};
