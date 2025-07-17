# WaniKanify 2.0 - Manifest V3 Migration

## Changes Made

### 1. manifest.json

-   Updated `manifest_version` from 2 to 3
-   Replaced `background.scripts` with `background.service_worker`
-   Replaced `browser_action` with `action`
-   Added `scripting` permission for dynamic script injection
-   Moved host permissions to `host_permissions` array

### 2. js/background.js

-   Removed jQuery dependency (service workers can't use external libraries)
-   Replaced `chrome.tabs.executeScript` with `chrome.scripting.executeScript`
-   Updated `chrome.browserAction.onClicked` to `chrome.action.onClicked`
-   Updated `chrome.browserAction.setPopup` to `chrome.action.setPopup`
-   Updated script injection to use Promise-based API

### 3. js/popup.js

-   Updated `chrome.browserAction.setPopup` to `chrome.action.setPopup`

### 4. js/options.js

-   Updated `chrome.browserAction.setPopup` to `chrome.action.setPopup`

## Key Differences in Manifest V3

1. **Service Workers**: Background scripts are now service workers and can't access DOM or use external libraries
2. **Scripting API**: Dynamic script injection now uses `chrome.scripting.executeScript` instead of `chrome.tabs.executeScript`
3. **Action API**: `browser_action` is now `action`
4. **Permissions**: Host permissions are now separate from regular permissions
5. **Promise-based APIs**: Many APIs now return promises instead of using callbacks

## Testing

To test the extension:

1. Load it as an unpacked extension in Chrome
2. Navigate to a website with English text
3. Click the extension icon to activate WaniKanify
4. Verify that Japanese vocabulary words are replaced with kanji

## Compatibility

This extension now works with Chrome versions that support Manifest V3 (Chrome 88+).
The extension is no longer compatible with Manifest V2 browsers.
