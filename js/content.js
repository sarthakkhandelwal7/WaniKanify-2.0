// cache keys
var VOCAB_KEY            = "wanikanify_vocab";
var SRS_KEY              = "wanikanify_srs";
var API_KEY              = "wanikanify_apiKey";
var CUST_VOCAB_KEY       = "wanikanify_customvocab";
var GOOG_VOCAB_KEY       = "wanikanify_googleVocabKey";
var GOOG_VOCAB_META_KEY  = "wanikanify_googleVocab_meta";
var AUDIO_KEY            = "wanikanify_audio";
var REMOVENUMBERS_KEY    = "wanikanify_removeNumbers";

// filter map
var FILTER_MAP = {
    "apprentice":  (subject) => subject.data.srs_stage >= 1 && subject.data.srs_stage <= 4,
    "guru":        (subject) => subject.data.srs_stage >= 5 && subject.data.srs_stage <= 6,
    "master":      (subject) => subject.data.srs_stage == 7,
    "enlighten":   (subject) => subject.data.srs_stage == 8,
    "burned":      (subject) => subject.data.srs_stage == 9,
};

// ------------------------------------------------------------------------------------------------
// The main program driver.
// main : Object ->
function main(cache_local) {
    chrome.storage.sync.get([API_KEY, SRS_KEY, CUST_VOCAB_KEY, GOOG_VOCAB_META_KEY, AUDIO_KEY, REMOVENUMBERS_KEY], async function(cache_sync) {
        var apiKey = cache_sync[API_KEY];
        if (!apiKey) {
            console.error("No API key provided! Please use the options page to specify your API key.");
        }
        var vocabDictionary = {};
        await importWaniKaniVocab(vocabDictionary, cache_sync, cache_local, apiKey);
        importGoogleVocab(vocabDictionary, cache_local, cache_sync);
        importCustomVocab(vocabDictionary, cache_local, cache_sync);
        vocabDictionary = numberRemoval(vocabDictionary, cache_local, cache_sync);

        var dictionaryCallback = buildDictionaryCallback(
            cache_local,
            cache_sync,
            vocabDictionary,
            cache_local.wanikanify_vocab,
            cache_local.wanikanify_googleVocabKey,
            cache_sync.wanikanify_customvocab
        );

        $("body *:not(noscript):not(script):not(style)").replaceText(/\b(\S+?)\b/g, dictionaryCallback);

        // After text replacement, add event listeners
        // Add this after the replaceText call in main

        var audio_settings = cache_sync[AUDIO_KEY];
        var audio_on = true;
        var audio_on_click = false;
        if (audio_settings) {
            audio_on = audio_settings.on;
            audio_on_click = audio_settings.clicked;
        }

        var wk_vocab_list = {};
        if (cache_local.wanikanify_vocab) {
            wk_vocab_list = cache_local.wanikanify_vocab.vocabList;
        }

        var gc = {};
        if (cache_local.wanikanify_googleVocabKey) {
            gc = cache_local.wanikanify_googleVocabKey.collections;
        }

        $(".wanikanified").each(function() {
            var element = this;
            var en = element.getAttribute("data-en");
            var jp = element.getAttribute("data-jp");
            var url = element.getAttribute("data-url");

            // Single click handler that handles both toggle and audio
            element.addEventListener("click", function() {
                // Toggle the text
                var t = this.title;
                this.title = this.innerHTML;
                this.innerHTML = t;
                
                // Play audio if enabled and set to click mode
                if (audio_on && audio_on_click) {
                    var msg = new SpeechSynthesisUtterance();
                    msg.text = url;
                    msg.lang = 'ja-JP';
                    window.speechSynthesis.speak(msg);
                }
            });

            // Mouseover/mouseout handlers for hover audio
            if (audio_on && !audio_on_click) {
                var timer1;
                element.addEventListener("mouseover", function() {
                    timer1 = setTimeout(function() {
                        var msg = new SpeechSynthesisUtterance();
                        msg.text = url;
                        msg.lang = 'ja-JP';
                        window.speechSynthesis.speak(msg);
                    }, 700);
                });
                element.addEventListener("mouseout", function() {
                    clearTimeout(timer1);
                });
            }
        });
    });
}


// ------------------------------------------------------------------------------------------------
// Helper Functions

function hasWhiteSpace(s) {
    return s.indexOf(' ') >= 0;
}

// ------------------------------------------------------------------------------------------------
async function importWaniKaniVocab(vocabDictionary, cache_sync, cache_local, apiKey) {
    var waniKaniVocabList = await tryCacheOrWaniKani(cache_local, apiKey);
    if (waniKaniVocabList && waniKaniVocabList.length > 0) {
        var filteredList = filterVocabList(waniKaniVocabList, getFilters(cache_sync));
        var d = toDictionary(filteredList);
        // This could be slow...
        for (key in d) {
            vocabDictionary[key] = d[key];
        }
    }
}

// ------------------------------------------------------------------------------------------------
// Dump in the custom vocabulary words, overriding the wanikani entries.
function importCustomVocab(vocabDictionary, cache_local, cache_sync) {
    var ENTRY_DELIM = "\n";
    var ENG_JAP_COMBO_DELIM = ";";
    var ENG_VOCAB_DELIM = ",";
    var customVocab = cache_sync[CUST_VOCAB_KEY];
    if (!customVocab || customVocab.length == 0) {
        return;
    }

    // Explode entire list into sets of englishwords and japanese combinations.
    var splitList = customVocab.split(ENTRY_DELIM);
    
    if (!splitList) {
        return;
    }
    for (var i = 0; i < splitList.length; ++i) {
        // Explode each entry into english words and Kanji.
        var splitEntry = splitList[i].split(ENG_JAP_COMBO_DELIM);
        if (!splitEntry) {
            continue;
        }
        var untrimmedSplitEntry = splitEntry[1];
        if (untrimmedSplitEntry) {
            var kanjiVocabWord = untrimmedSplitEntry.trim();
            for (var j = 0; j < splitEntry.length; ++j) {
                var splitEnglishWords = splitEntry[0].split(ENG_VOCAB_DELIM);
                if (!splitEnglishWords) {
                    continue;
                }
                for (var k = 0; k < splitEnglishWords.length; ++k) {
                    // If it already exists, it gets replaced.
                    var engWordUntrimmed = splitEnglishWords[k];
                    if (engWordUntrimmed) {
                        var engVocabWord = engWordUntrimmed.trim();
                        vocabDictionary[engVocabWord] = kanjiVocabWord;
                    }
                }
            }
        }
    }
}

// this will not catch numbers with delimeters other than "." (like for example "1,000")
    function isNumeric(str) { 
        return !isNaN(str) &&
            !isNaN(parseFloat(str))
    }

// ------------------------------------------------------------------------------------------------
// Remove numbers from dictionary
function numberRemoval(vocabDictionary, cache_local, cache_sync) {
    var removeNumbers_settings = cache_sync[REMOVENUMBERS_KEY];
    if(removeNumbers_settings == "No") {
        return vocabDictionary;
    }

    return  Object.fromEntries(
        Object.entries(vocabDictionary).filter(x => !isNumeric(x[0]))
        );
}

// ------------------------------------------------------------------------------------------------
// Get the correct delimeter for this sheet/key combo.
function getDelim(meta_data_collection, spreadsheet_collection_key, sheet_name) {
    for (var i = 0; i < meta_data_collection.length; ++i) {
        if (meta_data_collection[i].spreadsheet_collection_key == spreadsheet_collection_key &&
            meta_data_collection[i].sheet_name == sheet_name) {
                return meta_data_collection[i].delim;
        }
    }
    console.error("Could not find key/sheet combo in metadata for: " + spreadsheet_collection_key + " " + sheet_name);
    return ",";
}

// ------------------------------------------------------------------------------------------------
function importGoogleVocab(vocabDictionary, cache_local, cache_sync) {
    var googleVocab = cache_local[GOOG_VOCAB_KEY];
    if (!googleVocab || googleVocab.collections.length == 0) {
        return;
    }

    var metaData = cache_sync[GOOG_VOCAB_META_KEY];
    if (!metaData) {
        return;
    }

    // We have multiple collections.
    // Each collection can contain multiple sheets.
    // Each sheet contains multiple entries of english words -> japanese mappings.
    // Each entry needs to be split up into multiple synonyms.
    var collections = googleVocab.collections;
    // For each collection.
    for (spreadsheet_collection_key in collections) {
        var sheets = collections[spreadsheet_collection_key];
        // For each sheet in that collection.
        for (sheet_name in sheets) {
            var delim = getDelim(metaData["meta_data_collection"], spreadsheet_collection_key, sheet_name);
            // For each entry in that sheet.
            for (var i = 0; i < sheets[sheet_name].length; ++i) {
                var entry = sheets[sheet_name][i];
                var splitEnglishWords = entry.eng.split(delim);
                // For each english synonym.
                for (k = 0; k < splitEnglishWords.length; k++) {
                    var eng_word = splitEnglishWords[k].trim();
                    var jap_word = entry.jap.trim();
                    if (eng_word.length == 0 || jap_word.length == 0)
                        continue;
                    vocabDictionary[eng_word] = jap_word;
                }
            }
        }
    }
}

// ------------------------------------------------------------------------------------------------
// Returns the filters to use for vocab filtering
// getFilters: Object -> [Function]
function getFilters(cache_sync) {
    var options = cache_sync[SRS_KEY];
    if (options) {
        return filters = options.map(function(obj, index) {
            return FILTER_MAP[obj];
        });
    }
    return [];
}

// ------------------------------------------------------------------------------------------------
// Returns a dictionary from String -> String.
// tryCacheOrWaniKani : Object, String -> Object
async function tryCacheOrWaniKani(cache_local, apiKey) {
    // returns true if the given date is over an hour old.
    function isExpired(date) {
        var then = new Date(date);
        var now = new Date();
        return (Math.abs(now - then) > 3600000);
    }

    var hit = cache_local[VOCAB_KEY];
    if (hit && hit.vocabList) {
        if (!hit.inserted || isExpired(hit.inserted)) {
            await tryWaniKani(apiKey);
        }
        return hit.vocabList;
    }

    return tryWaniKani(apiKey);
}

// ------------------------------------------------------------------------------------------------
// Returns a [Object] of vocabulary words from WaniKani
// tryWaniKani : String -> [Object]
async function tryWaniKani(apiKey) {
    if (!apiKey) {
        console.error("No API key provided! Please use the options page to specify your API key.");
        return [];
    }

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "fetchVocab" }, (vocabList) => {
            const error = chrome.runtime.lastError;
            if (error) {
                console.error(error.message);
                reject(error);
            } else {
                //console.log(vocabList);
                resolve(vocabList);
            }
        });
    });
}

// ------------------------------------------------------------------------------------------------
// Caches a given [Object] of vocabulary words with an inserted date
// cacheVocabList: [Object] ->
function cacheVocabList(vocabList) {
    var obj = {};
    obj[VOCAB_KEY] = {
        "inserted": (new Date()).toJSON(),
        "vocabList": vocabList
    };

    chrome.storage.local.set(obj);
}

// ------------------------------------------------------------------------------------------------
// Filters the given [Object] of vocabulary words with the given list of filters.
// filterVocabList : [Object], [Function] -> [Object]
function filterVocabList(vocabList, filters) {
    return vocabList.filter(function(obj) {
        for (var i = 0; i < filters.length; i++) {
            if (filters[i](obj)) {
                return true;
            }
        }
        return false;
    });
}

// ------------------------------------------------------------------------------------------------
// Converts a list of vocab words to a dictionary.
// toDictionary : [Object] -> Object
function toDictionary(list) {
    var dict = {};
    list.forEach((vocab) => {
        const primaryMeanings = vocab.data.meanings.map(val => val.meaning);
        const auxiliaryMeanings = vocab.data.auxiliary_meanings.filter(val => val.type == 'whitelist').map(val => val.meaning);
        
        [...primaryMeanings, ...auxiliaryMeanings, ...vocab.data.synonyms].forEach((meaning) => {
            dict[meaning.toLowerCase()] = vocab.data.characters;
        });
    });

    return dict;
}

// ------------------------------------------------------------------------------------------------
function getReading(wanikani_vocab_list, googleVocab, custom_vocab_list, vocab_to_find) {
    // Search custom vocab for the reading.
    // FIX: Make this global.
    var ENTRY_DELIM = "\n";
    var ENG_JAP_COMBO_DELIM = ";";
    var ENG_VOCAB_DELIM = ",";
    if (custom_vocab_list && custom_vocab_list.length != 0) {
        // Explode entire list into sets of englishwords and japanese combinations.
        var splitList = custom_vocab_list.split(ENTRY_DELIM);
        if (splitList) {
            for (var i = 0; i < splitList.length; ++i) {
                // Explode each entry into english words and Kanji.
                var splitEntry = splitList[i].split(ENG_JAP_COMBO_DELIM);
                if (splitEntry) {
                    var untrimmedSplitEntry = splitEntry[1];
                    if (untrimmedSplitEntry) {
                        var kanjiVocabWord = untrimmedSplitEntry.trim();
                        if (kanjiVocabWord == vocab_to_find) {
                            var reading = splitEntry[2];
                            if (reading) {
                                return reading.trim();
                            } else {
                                return kanjiVocabWord;
                            }
                        }
                    }
                }
            }
        }
    }

    // Search google spreadsheets for the reading.
    // We have multiple collections.
    // Each collection can contain multiple sheets.
    // Each sheet contains multiple entries of english words -> japanese mappings.
    // Each entry needs to be split up into multiple synonyms.
    var collections = googleVocab;
    // For each collection.
    for (spreadsheet_collection_key in collections) {
        var sheets = collections[spreadsheet_collection_key];
        // For each sheet in that collection.
        for (sheet_name in sheets) {
            // For each entry in that sheet.
            for (var i = 0; i < sheets[sheet_name].length; ++i) {
                var entry = sheets[sheet_name][i];
                var japanese_word = entry.jap;
                if (japanese_word == vocab_to_find) {
                    return entry.jap_reading;
                }
            }
        }
    }

    // Search wanikani for the reading.
    for (var i = 0; i < wanikani_vocab_list.length; ++i) {
        if (wanikani_vocab_list[i].character == vocab_to_find) {
            return wanikani_vocab_list[i].kana;
        }
    }
    return vocab_to_find;
}

// ------------------------------------------------------------------------------------------------
function fetchWaniKaniAudioURL(reading) {
    return "";
}

// ------------------------------------------------------------------------------------------------
function buildAudioUrl(kanji, reading) {
    if (!kanji)
        return "";

    var url = {};
    if (!reading) {
        url = kanji;
    } else {
        url = fetchWaniKaniAudioURL(reading);
        if (!url) {
            url = reading;
        }
    }
    return url;
}

// ------------------------------------------------------------------------------------------------
// Creates a closure on the given dictionary.
// buildDictionaryCallback : Object -> (function(String) -> String)
function buildDictionaryCallback(
    cache_local,
    cache_sync,
    vocabDictionary,
    wanikani_vocab_list,
    google_collections,
    custom_vocab) {

    var audio_settings = cache_sync[AUDIO_KEY];
    var audio_on = true;
    var audio_on_click = false;
    if (audio_settings) {
        audio_on = audio_settings.on;
        audio_on_click = audio_settings.clicked;
    }

    var wk_vocab_list = {};
    if (wanikani_vocab_list) {
        wk_vocab_list = wanikani_vocab_list.vocabList;
    }

    var gc = {};
    if (google_collections) {
        gc = google_collections.collections;
    }

    return function(str) {
        var kanji = vocabDictionary[str.toLowerCase()];
        if (!kanji)
            return str;
        var reading = getReading(wk_vocab_list, gc, custom_vocab, kanji);
        var url = buildAudioUrl(kanji, reading);
        if (!url)
            return str;


        // FIX: Lots of duplication here.
        var span = '<span class="wanikanified" title="' + str + '" data-en="' + str + '" data-jp="' + kanji + '" data-url="' + url + '">' + kanji + '<\/span>';
        
        // Add event listeners after the element is created
        // We need to return the span and add listeners separately
        // But since replaceText replaces text, we need to wrap it
        return span;
    }
}

// kick off the program
chrome.storage.local.get([VOCAB_KEY, GOOG_VOCAB_KEY], main);
