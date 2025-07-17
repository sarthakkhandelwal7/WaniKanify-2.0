var executed = {}

// Initialize extension settings on install/startup
chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason === "install" || details.reason === "update") {
        // Initialize blacklist if it doesn't exist
        chrome.storage.sync.get(['wanikanify_blackList'], function(items) {
            if (!items.wanikanify_blackList) {
                // Set default blacklist with essential blocked patterns
                chrome.storage.sync.set({"wanikanify_blackList": []}, function() {
                    console.log("WaniKanify: Initialized empty blacklist");
                });
            }
        });
    }
});

// Injects JS into the tab.
// executeScripts : Object ->
function executeScripts(tab) {
    chrome.tabs.get(tab, function(details) {
        chrome.storage.sync.get(['wanikanify_blackList'], function(items) {

            function isBlackListed(details, items) {
                var url = details.url;
                var blackList = items.wanikanify_blackList;
                blackList.push("chrome://","chrome-extension://");
                if (blackList) {
                    if (blackList.length == 0) {
                        return false;
                    } else {
                        var matcher = new RegExp(blackList.map(function(val) { return '('+val+')';}).join('|'));
                        return matcher.test(url);
                    }
                }
                return false;
            }

            if (!isBlackListed(details, items)) {
                // Inject scripts in sequence using Manifest V3 scripting API
                chrome.scripting.executeScript({
                    target: { tabId: tab },
                    files: ["js/jquery.js"]
                }).then(() => {
                    return chrome.scripting.executeScript({
                        target: { tabId: tab },
                        files: ["js/replaceText.js"]
                    });
                }).then(() => {
                    return chrome.scripting.executeScript({
                        target: { tabId: tab },
                        files: ["js/content.js"]
                    });
                }).then(() => {
                    executed[tab] = "jp";
                }).catch((error) => {
                    console.error("Error injecting scripts:", error);
                });
            } else {
                console.log("WaniKanify blacklisted on this site!");
            }
        });
    });
}

// Removes the executed status from the map on loads.
// clearStatus : Object ->
function clearStatus(tab, change) {
    if (change.status === 'complete') {
        delete executed[tab];
    }
}

// Named function for adding/removing the callback
// loadOnUpdated : Object, String ->
function loadOnUpdated(tab, change) {
    if (change.status === 'complete') {
        delete executed[tab];
        executeScripts(tab);
    }
}

// Toggles the 'wanikanified' elements already on the page.
// setLanguage : String ->
function setLanguage(lang, tabId) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(lang) {
            // Use vanilla JavaScript instead of jQuery
            var elements = document.querySelectorAll(".wanikanified");
            
            for (var i = 0; i < elements.length; i++) {
                var element = elements[i];
                
                // Check if the element is currently showing Japanese or English
                var dataJp = element.getAttribute('data-jp');
                var dataEn = element.getAttribute('data-en');
                
                if (lang === 'jp') {
                    // Set to Japanese
                    element.innerHTML = dataJp;
                    element.title = dataEn;
                } else {
                    // Set to English
                    element.innerHTML = dataEn;
                    element.title = dataJp;
                }
            }
        },
        args: [lang]
    }).catch((error) => {
        console.error("Error in setLanguage:", error);
    });
}

// Function for handling browser button clicks.
// buttonClicked : Object ->
function buttonClicked(tab) {
    var lang = executed[tab.id];
    if (lang) {
        lang = (lang == "jp" ? "en" : "jp");
        executed[tab.id] = lang;
        setLanguage(lang, tab.id);
    } else {
        executeScripts(tab.id);
    }
}

async function getApiKey() {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(["wanikanify_apiKey"], (items) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(items.wanikanify_apiKey);
            }
        });
    });
}

async function testWaniKaniApi(apiKey) {
    const headers = {Authorization: `Bearer ${apiKey}`};
    const response = await fetch('https://api.wanikani.com/v2/' + 'user', {headers});
    const json = await response.json();
    
    let result = json.data;
    if(json.pages == null) {
        console.log("Test: No json page data returned from api");
    } else {
        if (json.pages.next_url) {
            const question_mark = json.pages.next_url.indexOf('?ids');
            let resulting_url = json.pages.next_url
            if (question_mark != -1) {
                const gibberish_end = resulting_url.indexOf('&');
                const first_half = resulting_url.substring(0, question_mark + 1);
                const second_half = resulting_url.substring(gibberish_end)
                resulting_url = first_half + second_half
            }
            result = result.concat(await repeatPaginatedRequest(resulting_url, apiKey));
        }
    }

    console.log("testWaniKaniApi function completed");
    return result;
}

async function repeatPaginatedRequest(url, apiKey) {
    const headers = {Authorization: `Bearer ${apiKey}`};
    const response = await fetch(url, {headers});
    const json = await response.json();

    let result = json.data;
    if(json.pages == null) {
        console.log("No json page data returned from api");
    } else {
        if (json.pages.next_url) {
            const question_mark = json.pages.next_url.indexOf('?ids');
            let resulting_url = json.pages.next_url
            if (question_mark != -1) {
                const gibberish_end = resulting_url.indexOf('&');
                const first_half = resulting_url.substring(0, question_mark + 1);
                const second_half = resulting_url.substring(gibberish_end)
                resulting_url = first_half + second_half
            }
            result = result.concat(await repeatPaginatedRequest(resulting_url, apiKey));
        }
    }

    return result;
}

async function getCachedVocab() {
    return await new Promise((resolve, reject) => {
        chrome.storage.local.get(["cachedWaniKaniVocab", "cacheCreationDate"], (cachedData) => {
            // check if data is no older than an hour (could be made configurable later, if there is demand for it)
            if (cachedData?.cachedWaniKaniVocab && (new Date() - cachedData.cacheCreationDate ) < 60 * 60 * 1000){
                resolve(cachedData.cachedWaniKaniVocab);
            }
            resolve(null);
        });
    });
}

async function setCachedVocab(subjects) {
    return await new Promise((resolve, reject) => {
        chrome.storage.local.set({ cachedWaniKaniVocab: subjects, cacheCreationDate: Date.now()});
    });
}

async function getVocabListFromWaniKani(apiKey) {

    // try to load vocab from cache
    const cache = await getCachedVocab();

    if (cache)
    {
        return cache;
    }

    // Request all user vocabulary assignments: https://docs.api.wanikani.com/20170710/#get-all-assignments
    const assignments = await repeatPaginatedRequest('https://api.wanikani.com/v2/assignments?subject_types=vocabulary', apiKey);
    // Request all study materials to find out about meaning synonyms: https://docs.api.wanikani.com/20170710/#study-materials
    const studyMaterials = await repeatPaginatedRequest('https://api.wanikani.com/v2/study_materials?subject_types=vocabulary', apiKey);

    // Create a map from the user's assignment subjects to a list of data that we need
    const progress = assignments.reduce((list, assignment) => {
        material = studyMaterials.find((material) => material.data.subject_id == assignment.data.subject_id);

        list[assignment.data.subject_id] = {
            srs_stage: assignment.data.srs_stage,
            synonyms: material ? material.data.meaning_synonyms : [],
        };
        return list;
    }, {});

    // Request all vocabulary subjects the user has already learned: https://docs.api.wanikani.com/20170710/#get-all-subjects
    let subjectIdList = Object.keys(progress).map(x => +x);

    // manually paginate to keep the query string small (the Ids parameter will otherwise cause issues if it gets too long)
    // avoid wanikani pagination (batchSize 1000)
    const batchSize = 999;
    let batch = [];
    let subjects = [];
    do {
        batch = subjectIdList.slice(0, batchSize);
        subjectIdList = subjectIdList.slice(batchSize);
        subjects = subjects.concat(await repeatPaginatedRequest(`https://api.wanikani.com/v2/subjects?types=vocabulary&ids=${batch.join(',')}`, apiKey));
    } while (batch.length > 0)

    // Augment the subjects by adding the user's current SRS progress
    subjects = subjects.map((subject) => {
        subject.data = { ...subject.data, ...progress[subject.id] };
        return subject;
    });

    //trim out unnecessary data, like mnemonics and such (otherwise 5MB wont be enough to cache it and the unlimited Storage permission will be required)
    subjects = subjects.map(x => ( {data: { auxiliary_meanings: x.data.auxiliary_meanings, characters: x.data.characters, meanings: x.data.meanings, synonyms: x.data.synonyms, srs_stage: x.data.srs_stage}} ))

    // cache waniKani vocab
    setCachedVocab(subjects);

    return subjects;
}

chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.type === "fetchVocab") {
            getApiKey()
                .then(getVocabListFromWaniKani)
                .then(sendResponse);
            return true;
        }
        if (request.type === "fetchUserObject") {
            console.log("Message \"testWkApi\" recieved");
            getApiKey()
                .then(testWaniKaniApi)
                .then(sendResponse);
            return true;
        }
    }
);

// Always execute scripts when the action is clicked.
chrome.action.onClicked.addListener(buttonClicked);

// Always listen for loads or reloads to clear from the cache
chrome.tabs.onUpdated.addListener(clearStatus);

// Add a listener for storage changes. We may need to disable "auto" running.
chrome.storage.onChanged.addListener(function(changes, store) {
    var load = changes.wanikanify_runOn;
    if (load) {
        if (load.newValue == "onUpdated") {
            chrome.tabs.onUpdated.addListener(loadOnUpdated);
        } else {
            chrome.tabs.onUpdated.removeListener(loadOnUpdated);
        }
    }
});

function toggleAutoLoad(info, tab) {
    chrome.storage.sync.get("wanikanify_runOn", function(items) {
        var load = items.wanikanify_runOn;
        var flip = (load == "onUpdated") ? "onClick" : "onUpdated";
        chrome.storage.sync.set({"wanikanify_runOn":flip}, function() {
            var title = (flip == "onClick") ? "Enable autoload" : "Disable autoload";
            chrome.contextMenus.update("wanikanify_context_menu", {title:title});
        });
    });
}

// Check the storage. We may already be in "auto" mode.
chrome.storage.sync.get(["wanikanify_runOn","wanikanify_apiKey"], function(items) {
    var context = {
        id: "wanikanify_context_menu",
        contexts: ["all"],
        onclick: toggleAutoLoad
    };

    var load = items.wanikanify_runOn;
    if (load == "onUpdated") {
        chrome.tabs.onUpdated.addListener(loadOnUpdated);
        context.title = "Disable autoload";
    } else {
        context.title = "Enable autoload";
    }
    // Display AutoLoad Right Click Options Menu
    //chrome.contextMenus.create(context);

    if (!items.wanikanify_apiKey) {
        chrome.action.setPopup({popup:"popup.html"});
    }
});
