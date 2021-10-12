// Constants from
// - https://github.com/linuxmint/muffin/blob/b0c3d573984f37d0c1a71c04bb5719ea7a3a8040/src/meta/common.h
// - https://github.com/linuxmint/muffin/blob/b0c3d573984f37d0c1a71c04bb5719ea7a3a8040/src/meta/window.h

const META_MAXIMIZE_HORIZONTAL = 1 << 0;
const META_MAXIMIZE_VERTICAL = 1 << 1;

const META_WINDOW_TILE_TYPE_NONE = 0;
const META_WINDOW_TILE_TYPE_TILED = 1;
const META_WINDOW_TILE_TYPE_SNAPPED = 2;

const META_TILE_NONE = 0;
const META_TILE_LEFT = 1;
const META_TILE_RIGHT = 2;
const META_TILE_ULC = 3;
const META_TILE_LLC = 4;
const META_TILE_URC = 5;
const META_TILE_LRC = 6;
const META_TILE_TOP = 7;
const META_TILE_BOTTOM = 8;
const META_TILE_MAXIMIZE = 9;

function saveWindowState(metaWindow) {
    const frameRect = _getFrameRect(metaWindow);
    const workspace = metaWindow.get_workspace();

    let tile, tileType, tileMode;
    if (
        (tileType = metaWindow.tile_type) !== META_WINDOW_TILE_TYPE_NONE &&
        (tileMode = _computeTileMode(metaWindow)) !== META_TILE_NONE
    ) {
        tile = {
            type: tileType,
            mode: tileMode,
        };
    }

    return {
        frame: {
            x: frameRect.x,
            y: frameRect.y,
            width: frameRect.width,
            height: frameRect.height,
        },
        minimized: metaWindow.minimized,
        maximized: {
            horizontally: metaWindow.maximized_horizontally,
            vertically: metaWindow.maximized_vertically,
        },
        tile,
        fullscreen: metaWindow.fullscreen,
        workspace: workspace ? workspace.index() : -1,
        onAllWorkspaces: metaWindow.is_on_all_workspaces(),
    };
}

function restoreWindowState(metaWindow, state) {
    if (metaWindow.fullscreen || state.fullscreen) {
        // Can't access to MetaWindow.make_fullscreen / MetaWindow.unmake_fullscreen
        // So fullscreen is not supported yet, skip this window
        return;
    }

    if (state.minimized) {
        // Minimize first if needed
        metaWindow.minimize();
    }

    // Always untile & unmaximize (otherwise move is impossible)
    metaWindow.tile(META_WINDOW_TILE_TYPE_NONE, false);
    metaWindow.unmaximize(META_MAXIMIZE_HORIZONTAL | META_MAXIMIZE_VERTICAL);
    metaWindow.move_frame(false, -32768, -32768); // this call fix many strange placement bugs

    if ((state.maximized.horizontally && state.maximized.vertically) || state.tile) {
        // If it is a full maximize or tile, move only (to keep the saved unmaximized width & height)
        metaWindow.move_frame(true, state.frame.x, state.frame.y);
    } else {
        // ... otherwise move and resize
        metaWindow.move_resize_frame(true, state.frame.x, state.frame.y, state.frame.width, state.frame.height);
    }

    if (state.maximized.horizontally || state.maximized.vertically) {
        // Maximize if needed
        metaWindow.maximize(
            (state.maximized.horizontally ? META_MAXIMIZE_HORIZONTAL : 0) |
                (state.maximized.vertically ? META_MAXIMIZE_VERTICAL : 0)
        );
    }

    if (state.tile) {
        // Tile if needed
        metaWindow.tile(state.tile.mode, state.tile.type === META_WINDOW_TILE_TYPE_SNAPPED);
        // TODO: Find a way to re-apply custom tile dimensions
    }

    if (!state.minimized) {
        // Unminimize at end if needed
        metaWindow.unminimize();
    }

    if (state.onAllWorkspaces) {
        metaWindow.change_workspace_by_index(-1, false, 0);
    } else if (state.workspace !== -1) {
        metaWindow.change_workspace_by_index(state.workspace, false, 0);
    }
}

function _getFrameRect(metaWindow) {
    // Can't access to MetaWindow.get_frame_rect with Muffin
    // So try our best to get the frame rect
    const rect = metaWindow.get_rect();
    const inputRect = metaWindow.get_input_rect();
    const outerRect = metaWindow.get_outer_rect();
    if (
        rect.x === inputRect.x &&
        rect.y === inputRect.y &&
        rect.width === inputRect.width &&
        rect.height === inputRect.height
    ) {
        return inputRect;
    } else {
        return outerRect;
    }
}

function _computeTileMode(metaWindow) {
    // Can't access to MetaWindow.tile_mode
    // So try our best to re-compute it (unfortunately if the window is tiled with a custom size it is possible to make mistakes)

    if (metaWindow.tile_type === META_WINDOW_TILE_TYPE_NONE) {
        return META_TILE_NONE;
    }

    const monitorIndex = metaWindow.get_monitor();
    if (monitorIndex === -1) {
        return META_TILE_NONE;
    }

    const monitorGeo = metaWindow.get_screen().get_monitor_geometry(monitorIndex);
    if (!monitorGeo) {
        return META_TILE_NONE;
    }

    let {x, y, width, height} = monitorGeo;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const tileAreas = [
        {mode: META_TILE_LEFT, x: x, y: y, width: halfWidth, height: height},
        {mode: META_TILE_RIGHT, x: x + halfWidth, y: y, width: halfWidth, height: height},
        {mode: META_TILE_ULC, x: x, y: y, width: halfWidth, height: halfHeight},
        {mode: META_TILE_LLC, x: x, y: y + halfHeight, width: halfWidth, height: halfHeight},
        {mode: META_TILE_URC, x: x + halfWidth, y: y, width: halfWidth, height: halfHeight},
        {mode: META_TILE_LRC, x: x + halfWidth, y: y + halfHeight, width: halfWidth, height: halfHeight},
        {mode: META_TILE_TOP, x: x, y: y, width: width, height: halfHeight},
        {mode: META_TILE_BOTTOM, x: x, y: y + halfHeight, width: width, height: halfHeight},
        // I don't known what META_TILE_MAXIMIZE is... Skip it for now.
    ];

    const rect = metaWindow.get_outer_rect();
    x = rect.x;
    y = rect.y;
    width = rect.width;
    height = rect.height;

    let bestIou = 0;
    let bestTileMode = META_TILE_NONE;
    for (const tileArea of tileAreas) {
        // Compute intersection area
        const iLeft = Math.max(x, tileArea.x);
        const iTop = Math.max(y, tileArea.y);
        const iRight = Math.min(x + width, tileArea.x + tileArea.width);
        const iBottom = Math.min(y + height, tileArea.y + tileArea.height);
        if (iRight < iLeft || iBottom < iTop) {
            // No intersection
            continue;
        }
        const iArea = (iRight - iLeft) * (iBottom - iTop);

        // Compute union area
        const uArea = Math.max(width * height + tileArea.width * tileArea.height - iArea, 1);

        // Compute intersection over union
        const iou = iArea / uArea;

        if (iou > bestIou) {
            bestIou = iou;
            bestTileMode = tileArea.mode;
        }
    }
    return bestTileMode;
}

module.exports = {saveWindowState, restoreWindowState};
