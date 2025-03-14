ko.expressionRewriting = (() => {
    var
/*
        javaScriptReservedWords = ["true", "false", "null", "undefined"],

    // Matches something that can be assigned to--either an isolated identifier or something ending with a property accessor
    // This is designed to be simple and avoid false negatives, but could produce false positives (e.g., a+b.c).
    // This also will not properly handle nested brackets (e.g., obj1[obj2['prop']]; see #911).
        javaScriptAssignmentTarget = /^(?:[$_a-z][$\w]*|(.+)(\.\s*[$_a-z][$\w]*|\[.+\]))$/i,

        getWriteableValue = expression => {
            if (javaScriptReservedWords.includes(expression))
                return false;
            var match = expression.match(javaScriptAssignmentTarget);
            return match === null ? false : match[1] ? ('Object(' + match[1] + ')' + match[2]) : expression;
        },
*/
    // The following regular expressions will be used to split an object-literal string into tokens

        specials = ',"\'`{}()/:[\\]',    // These characters have special meaning to the parser and must not appear in the middle of a token, except as part of a string.
        // Create the actual regular expression by or-ing the following regex strings. The order is important.
        bindingToken = RegExp([
            // These match strings, either with double quotes, single quotes, or backticks
            '"(?:\\\\.|[^"])*"',
            "'(?:\\\\.|[^'])*'",
            "`(?:\\\\.|[^`])*`",
            // Match C style comments
            "/\\*(?:[^*]|\\*+[^*/])*\\*+/",
            // Match C++ style comments
            "//.*\n",
            // Match a regular expression (text enclosed by slashes), but will also match sets of divisions
            // as a regular expression (this is handled by the parsing loop below).
            '/(?:\\\\.|[^/])+/w*',
            // Match text (at least two characters) that does not contain any of the above special characters,
            // although some of the special characters are allowed to start it (all but the colon and comma).
            // The text can contain spaces, but leading or trailing spaces are skipped.
            '[^\\s:,/][^' + specials + ']*[^\\s' + specials + ']',
            // Match any non-space character not matched already. This will match colons and commas, since they're
            // not matched by "everyThingElse", but will also match any other single character that wasn't already
            // matched (for example: in "a: 1, b: 2", each of the non-space characters will be matched by oneNotSpace).
            '[^\\s]'
        ].join('|'), 'g'),

        // Match end of previous token to determine whether a slash is a division or regex.
        divisionLookBehind = /[\])"'A-Za-z0-9_$]+$/,
        keywordRegexLookBehind = {'in':1,'return':1,'typeof':1},

        preProcessBindings = bindingsStringOrKeyValueArray => {
            // Trim leading and trailing spaces from the string
            var str = ko.utils.stringTrim(bindingsStringOrKeyValueArray);

            // Trim braces '{' surrounding the whole object literal
            if (str.charCodeAt(0) === 123) str = str.slice(1, -1);

            // Add a newline to correctly match a C++ style comment at the end of the string and
            // add a comma so that we don't need a separate code block to deal with the last item
            str += "\n,";

            // Split into tokens
            var result = [], toks = str.match(bindingToken), key, values = [], depth = 0;

            if (toks.length > 1) {
                var i = 0, tok;
                while ((tok = toks[i++])) {
                    var c = tok.charCodeAt(0);
                    // A comma signals the end of a key/value pair if depth is zero
                    if (c === 44) { // ","
                        if (depth <= 0) {
                            if (key && values.length) {
                                // Values are wrapped in a function so that each value can be accessed independently
                                result.push("'" + key + "':()=>(" + values.join('') + ")");
                            }
                            key = depth = 0;
                            values = [];
                            continue;
                        }
                    // Simply skip the colon that separates the name and value
                    } else if (c === 58) { // ":"
                        if (!depth && !key && values.length === 1) {
                            key = values.pop();
                            continue;
                        }
                    // Comments: skip them
                    } else if (c === 47 && tok.length > 1 && (tok.charCodeAt(1) === 47 || tok.charCodeAt(1) === 42)) {  // "//" or "/*"
                        continue;
                    // A set of slashes is initially matched as a regular expression, but could be division
                    } else if (c === 47 && i && tok.length > 1) {  // "/"
                        // Look at the end of the previous token to determine if the slash is actually division
                        var match = toks[i-1].match(divisionLookBehind);
                        if (match && !keywordRegexLookBehind[match[0]]) {
                            // The slash is actually a division punctuator; re-parse the remainder of the string (not including the slash)
                            str = str.slice(str.indexOf(tok) + 1);
                            toks = str.match(bindingToken);
                            i = -1;
                            // Continue with just the slash
                            tok = '/';
                        }
                    // Increment depth for parentheses, braces, and brackets so that interior commas are ignored
                    } else if (c === 40 || c === 123 || c === 91) { // '(', '{', '['
                        ++depth;
                    } else if (c === 41 || c === 125 || c === 93) { // ')', '}', ']'
                        --depth;
                    // The key will be the first token; if it's a string, trim the quotes
                    } else if (!key && !values.length && (c === 34 || c === 39)) { // '"', "'"
                        tok = tok.slice(1, -1);
                    }
                    values.push(tok);
                }
                if (depth > 0) {
                    throw Error("Unbalanced parentheses, braces, or brackets");
                }
            }

            result.push("'$data':()=>$data");

            return result.join(",");
        };

    return {
        preProcessBindings: preProcessBindings,

        keyValueArrayContainsKey: (keyValueArray, key) =>
            -1 < keyValueArray.findIndex(v => v['key'] == key),

        // Internal, private KO utility for updating model properties from within bindings
        // element:             the HTML element it belongs to
        // property:            If the property being updated is (or might be) an observable, pass it here
        //                      If it turns out to be a writable observable, it will be written to directly
        // allBindings:         An object with a get method to retrieve bindings in the current execution context.
        //                      This will be searched for a '_ko_property_writers' property in case you're writing to a non-observable
        // key:                 The key identifying the property to be written. Example: for { hasFocus: myValue }, write to 'myValue' by specifying the key 'hasFocus'
        // value:               The value to be written
        // checkIfDifferent:    If true, and if the property being written is a writable observable, the value will only be written if
        //                      it is !== existing value on that writable observable
        writeValueToProperty: (element, property, allBindings, key, value, checkIfDifferent) => {
            if (!property || !ko.isObservable(property)) {
                console.log(`"${key}" should contain observable in ${element.outerHTML.replace(/>.+/,'>')}`);
//                ko.dataFor(element).key = value;
                allBindings.get('$data')[key] = value;
            } else if (ko.isWriteableObservable(property) && (!checkIfDifferent || property.peek() !== value)) {
                property(value);
            }
        }
    };
})();
