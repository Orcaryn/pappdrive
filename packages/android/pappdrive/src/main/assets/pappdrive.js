"use strict";
var pappdrive = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../node_modules/.pnpm/ignore@7.0.12/node_modules/ignore/index.js
  var require_ignore = __commonJS({
    "../../node_modules/.pnpm/ignore@7.0.12/node_modules/ignore/index.js"(exports, module) {
      "use strict";
      function makeArray(subject) {
        return Array.isArray(subject) ? subject : [subject];
      }
      var UNDEFINED = void 0;
      var EMPTY = "";
      var SPACE = " ";
      var ESCAPE = "\\";
      var REGEX_LITERAL_SPECIAL = /[.*+?()[\]{}^$|\\/]/;
      var BOM = "\uFEFF";
      var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
      var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
      var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
      var REGEX_SPLITALL_CRLF = /\r?\n/g;
      var DOUBLE_SLASH = "//";
      var SLASH_CODE = 47;
      var DOT_CODE = 46;
      var SLASH = "/";
      var TMP_KEY_IGNORE = "node-ignore";
      if (typeof Symbol !== "undefined") {
        TMP_KEY_IGNORE = /* @__PURE__ */ Symbol.for("node-ignore");
      }
      var KEY_IGNORE = TMP_KEY_IGNORE;
      var define = (object, key, value) => {
        Object.defineProperty(object, key, { value });
        return value;
      };
      var RETURN_FALSE = () => false;
      var cleanRangeBackSlash = (slashes) => {
        const { length } = slashes;
        return slashes.slice(0, length - length % 2);
      };
      var POSIX_CLASSES = {
        alnum: "0-9A-Za-z",
        alpha: "A-Za-z",
        blank: " \\t",
        cntrl: "\\x00-\\x1f\\x7f",
        digit: "0-9",
        graph: "!-.0-~",
        lower: "a-z",
        print: " -.0-~",
        punct: "!-.:-@\\[-`{-~",
        // git's `sane-ctype.h` classifies \v and \f as control, not space,
        //   unlike C's `isspace`
        space: " \\t\\n\\r",
        upper: "A-Z",
        xdigit: "0-9A-Fa-f"
      };
      var CLASS_MEMBERS_TO_ESCAPE = "\\]^-[";
      var escapeMember = (char) => CLASS_MEMBERS_TO_ESCAPE.indexOf(char) < 0 ? char : ESCAPE + char;
      var NON_SLASH = "(?!\\/)";
      var classSource = (negated, body) => {
        if (negated) {
          return `[^\\/${body}]`;
        }
        const source = `[${body}]`;
        return new RegExp(source).test("/") ? NON_SLASH + source : source;
      };
      var scanBracket = (pattern, start2) => {
        const { length } = pattern;
        let index = start2 + 1;
        let negated = EMPTY;
        const lead = pattern[index];
        if (lead === "!" || lead === "^") {
          negated = "^";
          index++;
        }
        let body = EMPTY;
        let prev = EMPTY;
        for (; ; ) {
          const char = pattern[index];
          if (char === UNDEFINED) {
            return null;
          }
          if (char === ESCAPE) {
            const escaped = pattern[index + 1];
            if (escaped === UNDEFINED) {
              return null;
            }
            body += escapeMember(escaped);
            prev = escaped;
            index++;
          } else if (char === "-" && prev && index + 1 < length && pattern[index + 1] !== "]") {
            index++;
            let to = pattern[index];
            if (to === ESCAPE) {
              to = pattern[index += 1];
            }
            if (prev <= to) {
              body += `-${escapeMember(to)}`;
            }
            prev = EMPTY;
          } else if (char === "[" && pattern[index + 1] === ":") {
            const nameStart = index + 2;
            let end = nameStart;
            while (end < length && pattern[end] !== "]") {
              end++;
            }
            if (end === length) {
              return null;
            }
            if (end > nameStart && pattern[end - 1] === ":") {
              const expanded = POSIX_CLASSES[pattern.slice(nameStart, end - 1)];
              if (expanded === UNDEFINED) {
                return null;
              }
              body += expanded;
              prev = EMPTY;
              index = end;
            } else {
              body += escapeMember("[");
              prev = "[";
              index = nameStart - 2;
            }
          } else {
            body += escapeMember(char);
            prev = char;
          }
          index++;
          if (pattern[index] === "]") {
            return {
              end: index,
              source: classSource(negated, body)
            };
          }
        }
      };
      var NEVER_MATCH = "[]";
      var PLACEHOLDER = "\0";
      var REGEX_RESTORE_PLACEHOLDER = new RegExp(
        `${PLACEHOLDER}(\\d+)${PLACEHOLDER}`,
        "g"
      );
      var TRAILING_WILDCARD = "\uE000";
      var TRAILING_DOUBLESTAR = "\uE001";
      var extractBrackets = (pattern) => {
        const sources = [];
        const hold = (source) => `${PLACEHOLDER}${sources.push(source) - 1}${PLACEHOLDER}`;
        const { length } = pattern;
        let out = EMPTY;
        let index = 0;
        while (index < length) {
          const char = pattern[index];
          if (char === ESCAPE) {
            const escaped = pattern[index + 1];
            if (escaped === UNDEFINED || escaped === SLASH && index + 2 === length) {
              out += hold(NEVER_MATCH);
            } else if (escaped === "*" || escaped === "[" || escaped === SPACE || escaped === ESCAPE) {
              out += pattern.slice(index, index + 2);
            } else {
              out += hold(
                REGEX_LITERAL_SPECIAL.test(escaped) ? ESCAPE + escaped : escaped
              );
            }
            index += 2;
          } else if (char === PLACEHOLDER) {
            out += hold(`[${PLACEHOLDER}]`);
            index++;
          } else if (char === "[") {
            const scanned = scanBracket(pattern, index);
            if (scanned === null) {
              out += hold(NEVER_MATCH);
              index = length;
            } else {
              out += hold(scanned.source);
              index = scanned.end + 1;
            }
          } else {
            out += char;
            index++;
          }
        }
        return {
          source: out,
          sources
        };
      };
      var DIRECT = null;
      var REGEX_INNER_SLASH = /\/(?!$)/;
      var REPLACERS = [
        // Replace (\ ) with ' '
        // Only a space: an escaped tab or other whitespace is already a literal by
        //   the time it reaches here, and a bare tab must be left as one, not turned
        //   into a space.
        // (\ ) -> ' '
        // (\\ ) -> '\\ '
        // (\\\ ) -> '\\ '
        [
          // A run of backslashes is taken whole, from its first one, so no match
          //   ever starts again inside it -- `(\\+?) ` did, which made a long run
          //   quadratic.
          /(\\+)( ?)/g,
          (_, run, space) => space ? run.slice(0, run.length - run.length % 2) + SPACE : run,
          ESCAPE + SPACE
        ],
        // Escape metacharacters
        // which is written down by users but means special for regular expressions.
        // > There are 12 characters with special meanings:
        // > - the backslash \,
        // > - the caret ^,
        // > - the dollar sign $,
        // > - the period or dot .,
        // > - the vertical bar or pipe symbol |,
        // > - the question mark ?,
        // > - the asterisk or star *,
        // > - the plus sign +,
        // > - the opening parenthesis (,
        // > - the closing parenthesis ),
        // > - and the opening square bracket [,
        // > - the opening curly brace {,
        // > These special characters are often called "metacharacters".
        [
          /[\\$.|*+(){^]/g,
          (match) => `\\${match}`
        ],
        [
          // > a question mark (?) matches a single character
          /(?!\\)\?/g,
          () => "[^/]",
          "?"
        ],
        // leading slash
        [
          // > A leading slash matches the beginning of the pathname.
          // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
          // A leading slash matches the beginning of the pathname
          /^\//,
          () => "^",
          SLASH
        ],
        // replace special metacharacter slash after the leading slash
        [
          /\//g,
          () => "\\/",
          SLASH
        ],
        [
          // > A leading "**" followed by a slash means match in all directories.
          // > For example, "**/foo" matches file or directory "foo" anywhere,
          // > the same as pattern "foo".
          // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
          // >   under directory "foo".
          // Notice that the '*'s have been replaced as '\\*'
          /^\^*(?:\\\*\\\*\\\/)+/,
          // '**/foo' <-> 'foo'
          () => "^(?:.*\\/)?",
          "*"
        ],
        // starting
        [
          // there will be no leading '/'
          //   (which has been replaced by section "leading slash")
          // If starts with '**', adding a '^' to the regular expression also works
          DIRECT,
          (source, pattern) => {
            if (!source || source[0] === "^") {
              return source;
            }
            const anchor = !REGEX_INNER_SLASH.test(pattern) ? "(?:^|\\/)" : "^";
            return anchor + source;
          }
        ],
        // two globstars
        [
          // Use lookahead assertions so that we could match more than one `'/**'`
          /\\\/\\\*\\\*(?=\\\/|$)/g,
          // Zero, one or several directories
          // should not use '*', or it will be replaced by the next replacer
          // Check if it is not the last `'/**'`
          (_, index, str) => index + 6 < str.length ? str.slice(index + 6) === "\\/" ? "(?:\\/[^\\/]+)+" : "(?:\\/[^\\/]+)*" : `\\/${TRAILING_DOUBLESTAR}`,
          "*"
        ],
        // normal intermediate wildcards
        [
          // Never replace escaped '*'
          // ignore rule '\*' will match the path '*'
          // 'abc.*/' -> go
          // 'abc.*'  -> skip this rule,
          //    coz trailing single wildcard will be handed by [trailing wildcard]
          /(^|[^\\]+)(\\\*)+(?=.+)/g,
          // '*.js' matches '.js'
          // '*.js' doesn't match 'abc'
          (_, p1, p2) => {
            const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
            return p1 + unescaped;
          },
          "*"
        ],
        // trailing wildcard, held apart from a literal star
        [
          // The step above leaves a trailing `*` alone, so a single `\*` is all that
          //   can be left at the end here. Whether it is a wildcard or a literal
          //   turns on the backslashes the user put in front of it: the escaper has
          //   since doubled every one, so what stands here is those `2N` doubled
          //   backslashes and then the star's own escape. An even number of the
          //   original `N` leaves the star unescaped -- a wildcard -- and an odd
          //   number escapes it -- a literal. This runs while the two are still
          //   distinct, before the unescape steps below collapse the literal onto
          //   the very `\*` a wildcard leaves behind.
          /(^|[^\\])((?:\\\\)*)\\\*$/,
          (match, p1, p2) => (
            // `p2` holds the doubled user backslashes; half of them is `N`.
            p2.length / 2 % 2 === 0 ? p1 + p2 + TRAILING_WILDCARD : match
          ),
          "*"
        ],
        [
          // unescape, revert step 3 except for back slash
          // For example, if a user escape a '\\*',
          // after step 3, the result will be '\\\\\\*'
          /\\\\\\(?=[$.|*+(){^])/g,
          () => ESCAPE,
          ESCAPE + ESCAPE
        ],
        [
          // '\\\\' -> '\\'
          /\\\\/g,
          () => ESCAPE,
          ESCAPE + ESCAPE
        ],
        [
          // Every real bracket expression -- POSIX classes included -- has already
          //   been held aside by `extractBrackets`, so the only `[` left in the
          //   pattern is an escaped, literal one.
          // `\` is escaped by step 3
          /\\\[([^\]/]*?)(\\*)($|\])/g,
          // '\\[bar]' -> '\\\\[bar\\]'
          (match, range, endEscape, close) => `\\[${range}${cleanRangeBackSlash(endEscape)}${close}`,
          "["
        ],
        // ending
        [
          // 'js' will not match 'js.'
          // 'ab' will not match 'abc'
          DIRECT,
          // WTF!
          // https://git-scm.com/docs/gitignore
          // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
          // which re-fixes #24, #38
          // > If there is a separator at the end of the pattern then the pattern
          // > will only match directories, otherwise the pattern can match both
          // > files and directories.
          // 'js*' will not match 'a.js'
          // 'js/' will not match 'a.js'
          // 'js' will match 'a.js' and 'a.js/'
          (source) => {
            const last = source[source.length - 1];
            if (!last || last === TRAILING_WILDCARD || last === TRAILING_DOUBLESTAR) {
              return source;
            }
            return last === SLASH ? `${source}$` : `${source}(?=$|\\/$)`;
          }
        ]
      ];
      var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\uE000$/;
      var MODE_IGNORE = "regex";
      var MODE_CHECK_IGNORE = "checkRegex";
      var UNDERSCORE = "_";
      var replaceTrailingWildcard = (_, p1) => {
        const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      };
      var REGEX_REPLACE_TRAILING_DOUBLESTAR = /\uE001$/;
      var replaceTrailingDoublestar = () => ".+(?=$|\\/$)";
      var WILDCARD = "[^\\/]*";
      var separatorAfter = (run, at) => {
        let separator = EMPTY;
        for (let index = at + 1; index < run.length && !run[index].wildcard; index++) {
          separator += run[index].single;
        }
        return separator;
      };
      var pinWildcards = (source) => {
        if (source.indexOf(WILDCARD) < 0) {
          return source;
        }
        const tokens = [];
        const { length } = source;
        let index = 0;
        while (index < length) {
          const char = source[index];
          if (source.startsWith(WILDCARD, index)) {
            tokens.push({ wildcard: true });
            index += WILDCARD.length;
          } else if (char === "[") {
            let end = index + 1;
            if (source[end] === "^") {
              end++;
            }
            if (source[end] === "]") {
              end++;
            }
            while (end < length && source[end] !== "]") {
              end += source[end] === ESCAPE ? 2 : 1;
            }
            end++;
            tokens.push({ single: source.slice(index, end) });
            index = end;
          } else if (char === ESCAPE) {
            tokens.push({ single: source.slice(index, index + 2) });
            index += 2;
          } else if (char === "(") {
            let depth = 0;
            let end = index;
            do {
              if (source[end] === ESCAPE) {
                end++;
              } else if (source[end] === "(") {
                depth++;
              } else if (source[end] === ")") {
                depth--;
              }
              end++;
            } while (end < length && depth > 0);
            if ("*+?".indexOf(source[end]) >= 0) {
              end++;
            }
            tokens.push({ boundary: source.slice(index, end) });
            index = end;
          } else if (char === "^" || char === "$") {
            tokens.push({ boundary: char });
            index++;
          } else {
            tokens.push({ single: char });
            index++;
          }
        }
        let out = EMPTY;
        let run = [];
        const flush = () => {
          let lastWildcard;
          run.forEach((token, at) => {
            if (token.wildcard) {
              lastWildcard = at;
            }
          });
          run.forEach((token, at) => {
            if (!token.wildcard) {
              out += token.single;
              return;
            }
            out += at === lastWildcard ? WILDCARD : `(?:(?!${separatorAfter(run, at)})[^\\/])*`;
          });
          run = [];
        };
        tokens.forEach((token) => {
          if (token.boundary === void 0) {
            run.push(token);
            return;
          }
          flush();
          out += token.boundary;
        });
        flush();
        return out;
      };
      var makeRegexPrefix = (pattern) => {
        const { source, sources } = extractBrackets(pattern);
        const replaced = REPLACERS.reduce(
          // A pass whose matcher finds nothing hands back the very string it was
          //   given, so asking first costs a search and saves a rewrite. Ten of the
          //   fifteen passes never fire for a typical .gitignore line, and between
          //   them they were 45% of this chain.
          (prev, [matcher, replacer, required]) => {
            if (matcher === DIRECT) {
              return replacer(prev, pattern);
            }
            if (required !== UNDEFINED && prev.indexOf(required) < 0) {
              return prev;
            }
            return matcher.test(prev) ? prev.replace(matcher, replacer.bind(pattern)) : prev;
          },
          source
        );
        return sources.length ? replaced.replace(
          REGEX_RESTORE_PLACEHOLDER,
          (match, index) => sources[index]
        ) : replaced;
      };
      var checkSourceOf = (body, prefix) => {
        if (body[body.length - 1] === SLASH) {
          prefix = makeRegexPrefix(body.slice(0, -1));
        }
        const head = prefix.slice(0, -1);
        const last = prefix[prefix.length - 1];
        return last === TRAILING_WILDCARD ? `${head}$` : last === TRAILING_DOUBLESTAR ? `${head}.*$` : NEVER_MATCH;
      };
      var matchesBasename = (body) => {
        const index = body.indexOf(SLASH);
        return index < 0 || index === body.length - 1;
      };
      var basenameOf = (path) => {
        const end = path.length - 1;
        const index = path.lastIndexOf(
          SLASH,
          path[end] === SLASH ? end - 1 : end
        );
        return index < 0 ? path : path.slice(index + 1);
      };
      var parentOf2 = (path) => {
        if (path.charCodeAt(0) === SLASH_CODE || path.indexOf(DOUBLE_SLASH) >= 0) {
          const slices = path.split(SLASH).filter(Boolean);
          slices.pop();
          return slices.length ? slices.join(SLASH) + SLASH : EMPTY;
        }
        const end = path.length - 1;
        const cut = path.lastIndexOf(
          SLASH,
          path.charCodeAt(end) === SLASH_CODE ? end - 1 : end
        );
        return cut < 0 ? EMPTY : path.slice(0, cut + 1);
      };
      var isString = (subject) => typeof subject === "string";
      var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern);
      var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
      var IgnoreRule = class {
        constructor(pattern, mark, body, ignoreCase, negative, prefix) {
          this.pattern = pattern;
          this.mark = mark;
          this.negative = negative;
          define(this, "body", body);
          define(this, "ignoreCase", ignoreCase);
          define(this, "regexPrefix", prefix);
        }
        // Worked out on first use and kept behind an own property, the way `regex`
        //   caches itself in `_regex`. Deciding it in the constructor instead would
        //   add a fourth `defineProperty` to every rule ever built, which cost 4% of
        //   every compile -- including the compiles of rules that are never matched
        //   against anything.
        get _basenameOnly() {
          return define(this, "_basenameOnly", matchesBasename(this.body));
        }
        get regex() {
          const key = UNDERSCORE + MODE_IGNORE;
          if (this[key]) {
            return this[key];
          }
          return this._make(MODE_IGNORE, key);
        }
        get checkRegex() {
          const key = UNDERSCORE + MODE_CHECK_IGNORE;
          if (this[key]) {
            return this[key];
          }
          return this._make(MODE_CHECK_IGNORE, key);
        }
        _make(mode, key) {
          const str = pinWildcards(
            mode === MODE_IGNORE ? this.regexPrefix.replace(REGEX_REPLACE_TRAILING_WILDCARD, replaceTrailingWildcard).replace(REGEX_REPLACE_TRAILING_DOUBLESTAR, replaceTrailingDoublestar) : checkSourceOf(this.body, this.regexPrefix)
          );
          const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
          return define(this, key, regex);
        }
      };
      var isLineEnd = (char) => char === "\r" || char === "\n";
      var trimEnd = (body) => {
        let end = body.length;
        while (end && isLineEnd(body[end - 1])) {
          end--;
        }
        const lineEnd = end;
        while (end && body[end - 1] === SPACE) {
          end--;
        }
        if (end === lineEnd) {
          return body.slice(0, end);
        }
        let backslashes = 0;
        while (backslashes < end && body[end - backslashes - 1] === ESCAPE) {
          backslashes++;
        }
        return backslashes % 2 ? body.slice(0, end - 1) + SPACE : body.slice(0, end);
      };
      var createRule = ({
        pattern,
        mark
      }, ignoreCase) => {
        let body = pattern[0] === BOM ? pattern.slice(1) : pattern;
        if (body[0] === "#") {
          return;
        }
        let negative = false;
        if (body[0] === "!") {
          negative = true;
          body = body.slice(1);
        }
        const last = body[body.length - 1];
        if (last === SPACE || last === "\r" || last === "\n") {
          body = trimEnd(body);
        }
        if (!body) {
          return;
        }
        body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
        const regexPrefix = makeRegexPrefix(body);
        return new IgnoreRule(
          pattern,
          mark,
          body,
          ignoreCase,
          negative,
          regexPrefix
        );
      };
      var RuleManager = class {
        constructor(ignoreCase) {
          this._ignoreCase = ignoreCase;
          this._rules = [];
          this._basenameCount = 0;
        }
        _add(pattern) {
          if (pattern && pattern[KEY_IGNORE]) {
            this._rules = this._rules.concat(pattern._rules._rules);
            this._basenameCount += pattern._rules._basenameCount;
            this._added = true;
            return;
          }
          if (isString(pattern)) {
            pattern = {
              pattern
            };
          }
          const rule = checkPattern(pattern.pattern) && createRule(pattern, this._ignoreCase);
          if (rule) {
            this._added = true;
            this._rules.push(rule);
            if (matchesBasename(rule.body)) {
              this._basenameCount++;
            }
          }
        }
        // @param {Array<string> | string | Ignore} pattern
        add(pattern) {
          this._added = false;
          makeArray(
            isString(pattern) ? splitPattern(pattern) : pattern
          ).forEach(this._add, this);
          if (this._added) {
            this._literalRules = UNDEFINED;
          }
          return this._added;
        }
        // Match the literal 'abc/' for `checkIgnore`, last rule wins. Only a rule
        //   ending in a wildcard can match it (see `checkSourceOf`), so the rest
        //   are left out once, rather than tested or compiled for every path.
        testLiteral(path) {
          const rules = this._literalRules || (this._literalRules = this._rules.filter(
            ({ body }) => body[body.length - (body[body.length - 1] === SLASH ? 2 : 1)] === "*"
          ));
          let ignored = false;
          let unignored = false;
          let matchedRule;
          for (let index = rules.length - 1; index >= 0; index--) {
            const rule = rules[index];
            if (rule.checkRegex.test(path)) {
              ignored = !rule.negative;
              unignored = rule.negative;
              matchedRule = rule.negative ? UNDEFINED : rule;
              break;
            }
          }
          const ret = {
            ignored,
            unignored
          };
          if (matchedRule) {
            ret.rule = matchedRule;
          }
          return ret;
        }
        // Test one single path without recursively checking parent directories
        //
        // - checkUnignored `boolean` whether should check if the path is unignored,
        //   setting `checkUnignored` to `false` could reduce additional
        //   path matching.
        // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
        // @returns {TestResult} true if a file is ignored
        test(path, checkUnignored, mode) {
          let ignored = false;
          let unignored = false;
          let matchedRule;
          const rules = this._rules;
          const { length } = rules;
          const shortcut = this._basenameCount * 2 >= length;
          const basename = shortcut ? basenameOf(path) : path;
          for (let index = 0; index < length; index++) {
            const rule = rules[index];
            const { negative } = rule;
            const skip = unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored;
            if (!skip && rule[mode].test(
              shortcut && rule._basenameOnly ? basename : path
            )) {
              ignored = !negative;
              unignored = negative;
              matchedRule = negative ? UNDEFINED : rule;
            }
          }
          const ret = {
            ignored,
            unignored
          };
          if (matchedRule) {
            ret.rule = matchedRule;
          }
          return ret;
        }
      };
      var throwError = (message, Ctor) => {
        throw new Ctor(message);
      };
      var checkPath = (path, originalPath, doThrow) => {
        if (!isString(path)) {
          return doThrow(
            `path must be a string, but got \`${originalPath}\``,
            TypeError
          );
        }
        if (!path) {
          return doThrow(`path must not be empty`, TypeError);
        }
        if (checkPath.isNotRelative(path)) {
          const r = "`path.relative()`d";
          return doThrow(
            `path should be a ${r} string, but got "${originalPath}"`,
            RangeError
          );
        }
        return true;
      };
      var isNotRelative = (path) => {
        const first = path.charCodeAt(0);
        if (first === SLASH_CODE) {
          return true;
        }
        if (first !== DOT_CODE) {
          return false;
        }
        if (path.length === 1) {
          return true;
        }
        const second = path.charCodeAt(1);
        if (second === SLASH_CODE) {
          return true;
        }
        if (second !== DOT_CODE) {
          return false;
        }
        return path.length === 2 || path.charCodeAt(2) === SLASH_CODE;
      };
      checkPath.isNotRelative = isNotRelative;
      checkPath.convert = (p) => p;
      var Ignore = class {
        constructor({
          ignorecase = true,
          ignoreCase = ignorecase,
          allowRelativePaths = false
        } = {}) {
          define(this, KEY_IGNORE, true);
          this._rules = new RuleManager(ignoreCase);
          this._strictPathCheck = !allowRelativePaths;
          this._initCache();
        }
        _initCache() {
          this._ignoreCache = /* @__PURE__ */ Object.create(null);
          this._testCache = /* @__PURE__ */ Object.create(null);
        }
        add(pattern) {
          if (this._rules.add(pattern)) {
            this._initCache();
          }
          return this;
        }
        // legacy
        addPattern(pattern) {
          return this.add(pattern);
        }
        // @returns {TestResult}
        _test(originalPath, cache, checkUnignored) {
          const path = originalPath && checkPath.convert(originalPath);
          checkPath(
            path,
            originalPath,
            this._strictPathCheck ? throwError : RETURN_FALSE
          );
          return this._t(path, cache, checkUnignored);
        }
        checkIgnore(path) {
          if (path.charCodeAt(path.length - 1) !== SLASH_CODE) {
            return this.test(path);
          }
          const dir = this._t(path, this._testCache, true);
          if (dir.ignored) {
            return dir;
          }
          const literal = this._rules.testLiteral(path);
          return literal.ignored || literal.unignored ? literal : dir;
        }
        _t(path, cache, checkUnignored) {
          if (path in cache) {
            return cache[path];
          }
          const parentPath = parentOf2(path);
          const parent = parentPath ? this._t(parentPath, cache, checkUnignored) : UNDEFINED;
          return cache[path] = parent && parent.ignored ? parent : this._rules.test(path, checkUnignored, MODE_IGNORE);
        }
        ignores(path) {
          return this._test(path, this._ignoreCache, false).ignored;
        }
        createFilter() {
          return (path) => !this.ignores(path);
        }
        filter(paths) {
          return makeArray(paths).filter(this.createFilter());
        }
        // @returns {TestResult}
        test(path) {
          return this._test(path, this._testCache, true);
        }
      };
      var factory = (options) => new Ignore(options);
      var isPathValid = (path) => checkPath(path && checkPath.convert(path), path, RETURN_FALSE);
      var setupWindows = () => {
        const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
        checkPath.convert = makePosix;
        const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
        checkPath.isNotRelative = (path) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path) || isNotRelative(path);
      };
      if (
        // Detect `process` so that it can run in browsers.
        typeof process !== "undefined" && process.platform === "win32"
      ) {
        setupWindows();
      }
      module.exports = factory;
      factory.default = factory;
      module.exports.isPathValid = isPathValid;
      define(module.exports, /* @__PURE__ */ Symbol.for("setupWindows"), setupWindows);
    }
  });

  // src/embedded/index.ts
  var embedded_exports = {};
  __export(embedded_exports, {
    receive: () => receive,
    start: () => start
  });

  // src/shared/bytes.ts
  var utf8 = new TextEncoder();
  var fromUtf8 = new TextDecoder();
  function toBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 32768) {
      s += String.fromCharCode(...bytes.subarray(i, i + 32768));
    }
    return btoa(s);
  }
  function fromBase64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      out[i] = s.charCodeAt(i);
    }
    return out;
  }
  function toHex(bytes) {
    let s = "";
    for (const b of bytes) {
      s += b.toString(16).padStart(2, "0");
    }
    return s;
  }
  function fromHex(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
  function withPlainBuffer(bytes) {
    return bytes.buffer instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
  }

  // src/shared/errors.ts
  var SyncError = class extends Error {
    code;
    retryAfter;
    reason;
    constructor(code, message, extra = {}) {
      super(`${code}: ${message}`);
      this.name = "SyncError";
      this.code = code;
      this.retryAfter = extra.retryAfter;
      this.reason = extra.reason;
    }
  };

  // src/shared/paths.ts
  var HIDDEN_DIR = ".pappdrive";
  var MAX_SEGMENT_BYTES = 255;
  var MAX_PATH_BYTES = 1024;
  function pathProblem(path) {
    if (path === "") {
      return "the path is empty";
    } else if (path.startsWith("/")) {
      return 'it starts with a slash. Paths are relative to the folder, like "notes/todo.md"';
    } else if (/\p{Cc}/u.test(path)) {
      return "it contains a control character";
    } else if (utf8.encode(path).length > MAX_PATH_BYTES) {
      return `it is longer than ${MAX_PATH_BYTES} bytes`;
    }
    for (const seg of path.split("/")) {
      if (seg === "") {
        return 'it has an empty segment ("//" or a trailing slash)';
      } else if (seg === "." || seg === "..") {
        return 'it contains "." or ".."';
      } else if (utf8.encode(seg).length > MAX_SEGMENT_BYTES) {
        return `a segment is longer than ${MAX_SEGMENT_BYTES} bytes`;
      }
    }
    return null;
  }
  function pathKey(path) {
    return path.normalize("NFC").toLowerCase();
  }
  function parentOf(path) {
    const i = path.lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i);
  }
  function baseName(path) {
    return path.slice(path.lastIndexOf("/") + 1);
  }
  function joinPath(dir, name) {
    return dir === "" ? name : `${dir}/${name}`;
  }
  function dirKeysOf(paths) {
    const out = /* @__PURE__ */ new Set();
    for (const p of paths) {
      const segs = pathKey(p).split("/");
      for (let i = 1; i < segs.length; i++) {
        out.add(segs.slice(0, i).join("/"));
      }
    }
    return out;
  }

  // src/browser/opfs/handles.ts
  var CHUNK = /^\d{8}$/;
  function nullIfMissing(e) {
    if (e instanceof DOMException && ["NotFoundError", "TypeMismatchError"].includes(e.name)) {
      return null;
    }
    throw e;
  }
  async function chunksOf(tdir) {
    const out = [];
    for await (const [name, h] of tdir.entries()) {
      if (h.kind === "file" && CHUNK.test(name)) {
        out.push(h);
      }
    }
    return out.sort((a, b) => a.name < b.name ? -1 : 1);
  }
  async function makeDirs(dir, dirPath) {
    let d = dir;
    for (const s of dirPath === "" ? [] : dirPath.split("/")) {
      d = await d.getDirectoryHandle(s, { create: true });
    }
    return d;
  }
  async function isEmpty(dir) {
    for await (const _ of dir.entries()) {
      return false;
    }
    return true;
  }
  async function moveDir(src, dest) {
    const entries = [];
    for await (const e of src.entries()) {
      entries.push(e);
    }
    for (const [name, h] of entries) {
      if (h.kind === "file") {
        await h.move(dest, name);
      } else {
        await moveDir(h, await dest.getDirectoryHandle(name, { create: true }));
        await src.removeEntry(name);
      }
    }
  }

  // src/browser/opfs/write.ts
  var writeWithWritable = async (dir, _segs, name, parts) => {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      for (const part of parts) {
        await writable.write(part);
      }
      await writable.close();
    } catch (e) {
      await writable.abort();
      throw e;
    }
    return handle;
  };
  var SLICE = 16 * 1024 * 1024;
  var WORKER_SOURCE = `onmessage = async ({ data: { id, path, name, parts } }) => {
  let handle
  try {
    let dir = await navigator.storage.getDirectory()
    for (const s of path) dir = await dir.getDirectoryHandle(s)
    handle = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle()
    let at = 0
    for (const part of parts) {
      for (let o = 0; o < part.size; o += ${SLICE}) {
        at += handle.write(new Uint8Array(await part.slice(o, o + ${SLICE}).arrayBuffer()), { at })
      }
    }
    handle.flush()
    postMessage({ id })
  } catch (e) {
    postMessage({ id, error: String(e) })
  } finally {
    handle?.close()
  }
}`;
  var worker = null;
  var nextId = 0;
  var waiting = /* @__PURE__ */ new Map();
  var writeViaWorker = async (dir, segs, name, parts) => {
    if (worker === null) {
      worker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })));
      worker.onmessage = ({ data }) => {
        const done = waiting.get(data.id);
        if (!done) {
          throw new Error(`pappdrive: the OPFS worker answered write ${data.id}, which nobody waits for.`);
        }
        waiting.delete(data.id);
        done(data.error);
      };
      worker.onerror = (e) => {
        for (const done of waiting.values()) {
          done(e.message === "" ? "the OPFS worker could not start" : e.message);
        }
        waiting.clear();
      };
    }
    const w = worker;
    const id = nextId++;
    await new Promise((resolve, reject) => {
      waiting.set(id, (error) => error === void 0 ? resolve() : reject(new Error(`pappdrive: could not write ${name}: ${error}`)));
      w.postMessage({ id, path: segs, name, parts: parts.map((p) => p instanceof Blob ? p : new Blob([p])) });
    });
    return dir.getFileHandle(name);
  };

  // src/browser/opfs/index.ts
  var TMP = `${HIDDEN_DIR}/tmp`;
  var PROBE = "case-Probe";
  async function openOpfs(userId, app, readFor, getRoot = opfsRoot) {
    const rootSegs = ["pappdrive", userId, readFor ? `${app}.read-${readFor}` : app];
    const top = await getRoot();
    const root = await makeDirs(top, rootSegs.join("/"));
    const hidden = await root.getDirectoryHandle(HIDDEN_DIR, { create: true });
    const probe = await hidden.getFileHandle(PROBE, { create: true });
    const caseInsensitive = await hidden.getFileHandle(PROBE.toUpperCase()).catch(nullIfMissing) !== null;
    const writeFile = probe.createWritable === void 0 ? writeViaWorker : writeWithWritable;
    const hourAgo = Date.now() - 36e5;
    for await (const [name, h] of hidden.entries()) {
      if (h.kind === "file" && name.endsWith(".saving") && (await h.getFile()).lastModified < hourAgo) {
        await hidden.removeEntry(name).catch(nullIfMissing);
      }
    }
    async function stat(path) {
      const f = await getFile(path);
      return f && { size: f.size, mtime: f.lastModified };
    }
    async function list(dir) {
      const d = await findDir(dir);
      const out = [];
      if (d) {
        for await (const [name, h] of d.entries()) {
          out.push({ name, dir: h.kind === "directory" });
        }
      }
      return out;
    }
    async function read(path, offset, length) {
      const f = await getFile(path);
      if (!f) {
        throw new SyncError("not-found", `"${path}" does not exist. List the folder to see what is there.`);
      }
      return new Uint8Array(await f.slice(offset, offset + length).arrayBuffer());
    }
    async function moveTempInto(temp, path) {
      const tdirPath = `${TMP}/${temp}`;
      const tdir = await findDir(tdirPath);
      if (!tdir) {
        throw new Error(`pappdrive: the temp file ${temp} is missing, so "${path}" cannot be written.`);
      }
      const chunks = await chunksOf(tdir);
      const [only, ...more] = chunks;
      const source = only && more.length === 0 ? only : await write(tdirPath, "joined", await Promise.all(chunks.map((c) => c.getFile())));
      await source.move(await makeDirs(root, parentOf(path)), baseName(path));
      await tempRemove(temp);
      const f = await source.getFile();
      return { size: f.size, mtime: f.lastModified };
    }
    async function move(from, to) {
      const name = baseName(from);
      const fromParent = await findDir(parentOf(from));
      const file = fromParent && await fromParent.getFileHandle(name).catch(nullIfMissing);
      const dir = fromParent && !file ? await fromParent.getDirectoryHandle(name).catch(nullIfMissing) : null;
      if (file) {
        await file.move(await makeDirs(root, parentOf(to)), baseName(to));
      } else if (fromParent && dir) {
        await moveDir(dir, await makeDirs(root, to));
        await fromParent.removeEntry(name);
      } else {
        throw new SyncError("not-found", `"${from}" does not exist, so it cannot be moved.`);
      }
    }
    async function remove(path) {
      const name = baseName(path);
      const parent = await findDir(parentOf(path));
      if (parent && await parent.getFileHandle(name).catch(nullIfMissing)) {
        await parent.removeEntry(name);
      }
    }
    async function removeEmptyDirs(dir) {
      for (let d = dir; d !== ""; d = parentOf(d)) {
        const name = baseName(d);
        const parent = await findDir(parentOf(d));
        const handle = parent && await parent.getDirectoryHandle(name).catch(nullIfMissing);
        if (!parent || !handle) {
          continue;
        } else if (!await isEmpty(handle)) {
          return;
        }
        await parent.removeEntry(name);
      }
    }
    async function tempSize(temp) {
      const tdir = await findDir(`${TMP}/${temp}`);
      if (!tdir) {
        return null;
      }
      let size = 0;
      for (const c of await chunksOf(tdir)) {
        size += (await c.getFile()).size;
      }
      return size;
    }
    async function tempAppend(temp, data) {
      const tdirPath = `${TMP}/${temp}`;
      const nextChunk = (await chunksOf(await makeDirs(root, tdirPath))).length;
      await write(tdirPath, String(nextChunk).padStart(8, "0"), [withPlainBuffer(data)]);
    }
    async function tempTruncate(temp, size) {
      const tdirPath = `${TMP}/${temp}`;
      const tdir = await findDir(tdirPath);
      if (!tdir) {
        return;
      }
      let start2 = 0;
      for (const c of await chunksOf(tdir)) {
        const f = await c.getFile();
        if (start2 >= size) {
          await tdir.removeEntry(c.name);
        } else if (start2 + f.size > size) {
          await write(tdirPath, c.name, [f.slice(0, size - start2)]);
        }
        start2 += f.size;
      }
    }
    async function tempRemove(temp) {
      const tmp = await findDir(TMP);
      await tmp?.removeEntry(temp, { recursive: true }).catch(nullIfMissing);
    }
    async function tempList() {
      const tmp = await findDir(TMP);
      const out = [];
      if (tmp) {
        for await (const [name, h] of tmp.entries()) {
          if (h.kind === "directory") {
            out.push(name);
          }
        }
      }
      return out;
    }
    async function loadState(name) {
      const f = await getFile(`${HIDDEN_DIR}/${name}`);
      return f ? f.text() : null;
    }
    async function saveState(name, data) {
      await write(HIDDEN_DIR, name, [utf8.encode(data)]);
    }
    async function destroy() {
      const [pappdriveName, userName, folderName] = rootSegs;
      const pappdrive = await top.getDirectoryHandle(pappdriveName);
      const user = await pappdrive.getDirectoryHandle(userName);
      await user.removeEntry(folderName, { recursive: true }).catch(nullIfMissing);
      if (await isEmpty(user)) {
        await pappdrive.removeEntry(userName);
        if (await isEmpty(pappdrive)) {
          await top.removeEntry(pappdriveName);
        }
      }
    }
    async function write(dirPath, name, parts) {
      const dir = await makeDirs(root, dirPath);
      const saved = await writeFile(dir, [...rootSegs, ...dirPath.split("/")], `${name}.${Math.random().toString(36).slice(2, 10)}.saving`, parts);
      await saved.move(dir, name);
      return saved;
    }
    async function getFile(path) {
      const parent = await findDir(parentOf(path));
      const handle = parent && await parent.getFileHandle(baseName(path)).catch(nullIfMissing);
      return handle && handle.getFile().catch(nullIfMissing);
    }
    async function findDir(dirPath) {
      let d = root;
      try {
        for (const s of dirPath === "" ? [] : dirPath.split("/")) {
          d = await d.getDirectoryHandle(s);
        }
        return d;
      } catch (e) {
        return nullIfMissing(e);
      }
    }
    return {
      kind: "private",
      caseInsensitive,
      // WHATWG File System forbids the platform's path separator in a name; backslash is one on Windows, and a page cannot tell its platform.
      canCreate: (segment) => !segment.includes("\\"),
      stat,
      list,
      read,
      moveTempInto,
      move,
      remove,
      removeEmptyDirs,
      tempSize,
      tempAppend,
      tempTruncate,
      tempRemove,
      tempList,
      loadState,
      saveState,
      destroy
    };
  }
  async function opfsRoot() {
    try {
      return await navigator.storage.getDirectory();
    } catch (e) {
      throw new SyncError(
        "not-allowed",
        `The browser gives this page no private file storage (OPFS): ${String(e)}. It needs a secure page (https or localhost), and private windows often turn it off. Open the app in a normal window over https.`
      );
    }
  }

  // ../protocol/src/index.ts
  var API_PREFIX = "/v1";
  var WATCH_PROTOCOL = "pappdrive";
  var PART_SIZE = 16 * 1024 * 1024;
  var VERSION_BYTES = 1;
  var NONCE_BYTES = 12;
  var GCM_TAG_BYTES = 16;
  var BLOB_OVERHEAD = VERSION_BYTES + NONCE_BYTES + GCM_TAG_BYTES;
  var MAX_BLOB_SIZE = PART_SIZE + BLOB_OVERHEAD;
  var ID_RE = /^[0-9a-f]{64}$/;
  var APP_NAME_RE = /^[a-z0-9-]{1,64}$/;
  var MIN_PASSWORD_LENGTH = 12;
  var DEFAULT_ARGON2 = { m: 65536, t: 3, p: 4 };
  var SWEEP_GRACE_MS = 24 * 36e5;
  var DELTA_MAX = 100;
  function blobIdsOf(entry) {
    return entry.parts === void 0 ? [entry.id] : entry.parts;
  }
  function normalizeEmail(email) {
    return email.trim().toLowerCase();
  }

  // ../../node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/browser.js
  var u8 = Uint8Array;
  var u16 = Uint16Array;
  var i32 = Int32Array;
  var fleb = new u8([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0,
    /* unused */
    0,
    0,
    /* impossible */
    0
  ]);
  var fdeb = new u8([
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13,
    /* unused */
    0,
    0
  ]);
  var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var freb = function(eb, start2) {
    var b = new u16(31);
    for (var i = 0; i < 31; ++i) {
      b[i] = start2 += 1 << eb[i - 1];
    }
    var r = new i32(b[30]);
    for (var i = 1; i < 30; ++i) {
      for (var j = b[i]; j < b[i + 1]; ++j) {
        r[j] = j - b[i] << 5 | i;
      }
    }
    return { b, r };
  };
  var _a = freb(fleb, 2);
  var fl = _a.b;
  var revfl = _a.r;
  fl[28] = 258, revfl[258] = 28;
  var _b = freb(fdeb, 0);
  var fd = _b.b;
  var revfd = _b.r;
  var rev = new u16(32768);
  for (i = 0; i < 32768; ++i) {
    x = (i & 43690) >> 1 | (i & 21845) << 1;
    x = (x & 52428) >> 2 | (x & 13107) << 2;
    x = (x & 61680) >> 4 | (x & 3855) << 4;
    rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
  }
  var x;
  var i;
  var hMap = (function(cd, mb, r) {
    var s = cd.length;
    var i = 0;
    var l = new u16(mb);
    for (; i < s; ++i) {
      if (cd[i])
        ++l[cd[i] - 1];
    }
    var le = new u16(mb);
    for (i = 1; i < mb; ++i) {
      le[i] = le[i - 1] + l[i - 1] << 1;
    }
    var co;
    if (r) {
      co = new u16(1 << mb);
      var rvb = 15 - mb;
      for (i = 0; i < s; ++i) {
        if (cd[i]) {
          var sv = i << 4 | cd[i];
          var r_1 = mb - cd[i];
          var v = le[cd[i] - 1]++ << r_1;
          for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
            co[rev[v] >> rvb] = sv;
          }
        }
      }
    } else {
      co = new u16(s);
      for (i = 0; i < s; ++i) {
        if (cd[i]) {
          co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
        }
      }
    }
    return co;
  });
  var flt = new u8(288);
  for (i = 0; i < 144; ++i)
    flt[i] = 8;
  var i;
  for (i = 144; i < 256; ++i)
    flt[i] = 9;
  var i;
  for (i = 256; i < 280; ++i)
    flt[i] = 7;
  var i;
  for (i = 280; i < 288; ++i)
    flt[i] = 8;
  var i;
  var fdt = new u8(32);
  for (i = 0; i < 32; ++i)
    fdt[i] = 5;
  var i;
  var flm = /* @__PURE__ */ hMap(flt, 9, 0);
  var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
  var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
  var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
  var max = function(a) {
    var m = a[0];
    for (var i = 1; i < a.length; ++i) {
      if (a[i] > m)
        m = a[i];
    }
    return m;
  };
  var bits = function(d, p, m) {
    var o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
  };
  var bits16 = function(d, p) {
    var o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
  };
  var shft = function(p) {
    return (p + 7) / 8 | 0;
  };
  var slc = function(v, s, e) {
    if (s == null || s < 0)
      s = 0;
    if (e == null || e > v.length)
      e = v.length;
    return new u8(v.subarray(s, e));
  };
  var ec = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    // determined by compression function
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data"
    // determined by unknown compression method
  ];
  var err = function(ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
      Error.captureStackTrace(e, err);
    if (!nt)
      throw e;
    return e;
  };
  var inflt = function(dat, st, buf, dict) {
    var sl = dat.length, dl = dict ? dict.length : 0;
    if (!sl || st.f && !st.l)
      return buf || new u8(0);
    var noBuf = !buf;
    var resize = noBuf || st.i != 2;
    var noSt = st.i;
    if (noBuf)
      buf = new u8(sl * 3);
    var cbuf = function(l2) {
      var bl = buf.length;
      if (l2 > bl) {
        var nbuf = new u8(Math.max(bl * 2, l2));
        nbuf.set(buf);
        buf = nbuf;
      }
    };
    var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
    var tbts = sl * 8;
    do {
      if (!lm) {
        final = bits(dat, pos, 1);
        var type = bits(dat, pos + 1, 3);
        pos += 3;
        if (!type) {
          var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
          if (t > sl) {
            if (noSt)
              err(0);
            break;
          }
          if (resize)
            cbuf(bt + l);
          buf.set(dat.subarray(s, t), bt);
          st.b = bt += l, st.p = pos = t * 8, st.f = final;
          continue;
        } else if (type == 1)
          lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
        else if (type == 2) {
          var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
          var tl = hLit + bits(dat, pos + 5, 31) + 1;
          pos += 14;
          var ldt = new u8(tl);
          var clt = new u8(19);
          for (var i = 0; i < hcLen; ++i) {
            clt[clim[i]] = bits(dat, pos + i * 3, 7);
          }
          pos += hcLen * 3;
          var clb = max(clt), clbmsk = (1 << clb) - 1;
          var clm = hMap(clt, clb, 1);
          for (var i = 0; i < tl; ) {
            var r = clm[bits(dat, pos, clbmsk)];
            pos += r & 15;
            var s = r >> 4;
            if (s < 16) {
              ldt[i++] = s;
            } else {
              var c = 0, n = 0;
              if (s == 16)
                n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
              else if (s == 17)
                n = 3 + bits(dat, pos, 7), pos += 3;
              else if (s == 18)
                n = 11 + bits(dat, pos, 127), pos += 7;
              while (n--)
                ldt[i++] = c;
            }
          }
          var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
          lbt = max(lt);
          dbt = max(dt);
          lm = hMap(lt, lbt, 1);
          dm = hMap(dt, dbt, 1);
        } else
          err(1);
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
      }
      if (resize)
        cbuf(bt + 131072);
      var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
      var lpos = pos;
      for (; ; lpos = pos) {
        var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
        pos += c & 15;
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (!c)
          err(2);
        if (sym < 256)
          buf[bt++] = sym;
        else if (sym == 256) {
          lpos = pos, lm = null;
          break;
        } else {
          var add = sym - 254;
          if (sym > 264) {
            var i = sym - 257, b = fleb[i];
            add = bits(dat, pos, (1 << b) - 1) + fl[i];
            pos += b;
          }
          var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
          if (!d)
            err(3);
          pos += d & 15;
          var dt = fd[dsym];
          if (dsym > 3) {
            var b = fdeb[dsym];
            dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
          }
          if (pos > tbts) {
            if (noSt)
              err(0);
            break;
          }
          if (resize)
            cbuf(bt + 131072);
          var end = bt + add;
          if (bt < dt) {
            var shift = dl - dt, dend = Math.min(dt, end);
            if (shift + bt < 0)
              err(3);
            for (; bt < dend; ++bt)
              buf[bt] = dict[shift + bt];
          }
          for (; bt < end; ++bt)
            buf[bt] = buf[bt - dt];
        }
      }
      st.l = lm, st.p = lpos, st.b = bt, st.f = final;
      if (lm)
        final = 1, st.m = lbt, st.d = dm, st.n = dbt;
    } while (!final);
    return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
  };
  var wbits = function(d, p, v) {
    v <<= p & 7;
    var o = p / 8 | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
  };
  var wbits16 = function(d, p, v) {
    v <<= p & 7;
    var o = p / 8 | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
    d[o + 2] |= v >> 16;
  };
  var hTree = function(d, mb) {
    var t = [];
    for (var i = 0; i < d.length; ++i) {
      if (d[i])
        t.push({ s: i, f: d[i] });
    }
    var s = t.length;
    var t2 = t.slice();
    if (!s)
      return { t: et, l: 0 };
    if (s == 1) {
      var v = new u8(t[0].s + 1);
      v[t[0].s] = 1;
      return { t: v, l: 1 };
    }
    t.sort(function(a, b) {
      return a.f - b.f;
    });
    t.push({ s: -1, f: 25001 });
    var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
    t[0] = { s: -1, f: l.f + r.f, l, r };
    while (i1 != s - 1) {
      l = t[t[i0].f < t[i2].f ? i0++ : i2++];
      r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
      t[i1++] = { s: -1, f: l.f + r.f, l, r };
    }
    var maxSym = t2[0].s;
    for (var i = 1; i < s; ++i) {
      if (t2[i].s > maxSym)
        maxSym = t2[i].s;
    }
    var tr = new u16(maxSym + 1);
    var mbt = ln(t[i1 - 1], tr, 0);
    if (mbt > mb) {
      var i = 0, dt = 0;
      var lft = mbt - mb, cst = 1 << lft;
      t2.sort(function(a, b) {
        return tr[b.s] - tr[a.s] || a.f - b.f;
      });
      for (; i < s; ++i) {
        var i2_1 = t2[i].s;
        if (tr[i2_1] > mb) {
          dt += cst - (1 << mbt - tr[i2_1]);
          tr[i2_1] = mb;
        } else
          break;
      }
      dt >>= lft;
      while (dt > 0) {
        var i2_2 = t2[i].s;
        if (tr[i2_2] < mb)
          dt -= 1 << mb - tr[i2_2]++ - 1;
        else
          ++i;
      }
      for (; i >= 0 && dt; --i) {
        var i2_3 = t2[i].s;
        if (tr[i2_3] == mb) {
          --tr[i2_3];
          ++dt;
        }
      }
      mbt = mb;
    }
    return { t: new u8(tr), l: mbt };
  };
  var ln = function(n, l, d) {
    return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
  };
  var lc = function(c) {
    var s = c.length;
    while (s && !c[--s])
      ;
    var cl = new u16(++s);
    var cli = 0, cln = c[0], cls = 1;
    var w = function(v) {
      cl[cli++] = v;
    };
    for (var i = 1; i <= s; ++i) {
      if (c[i] == cln && i != s)
        ++cls;
      else {
        if (!cln && cls > 2) {
          for (; cls > 138; cls -= 138)
            w(32754);
          if (cls > 2) {
            w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
            cls = 0;
          }
        } else if (cls > 3) {
          w(cln), --cls;
          for (; cls > 6; cls -= 6)
            w(8304);
          if (cls > 2)
            w(cls - 3 << 5 | 8208), cls = 0;
        }
        while (cls--)
          w(cln);
        cls = 1;
        cln = c[i];
      }
    }
    return { c: cl.subarray(0, cli), n: s };
  };
  var clen = function(cf, cl) {
    var l = 0;
    for (var i = 0; i < cl.length; ++i)
      l += cf[i] * cl[i];
    return l;
  };
  var wfblk = function(out, pos, dat) {
    var s = dat.length;
    var o = shft(pos + 2);
    out[o] = s & 255;
    out[o + 1] = s >> 8;
    out[o + 2] = out[o] ^ 255;
    out[o + 3] = out[o + 1] ^ 255;
    for (var i = 0; i < s; ++i)
      out[o + i + 4] = dat[i];
    return (o + 4 + s) * 8;
  };
  var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
    wbits(out, p++, final);
    ++lf[256];
    var _a3 = hTree(lf, 15), dlt = _a3.t, mlb = _a3.l;
    var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
    var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
    var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
    var lcfreq = new u16(19);
    for (var i = 0; i < lclt.length; ++i)
      ++lcfreq[lclt[i] & 31];
    for (var i = 0; i < lcdt.length; ++i)
      ++lcfreq[lcdt[i] & 31];
    var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
    var nlcc = 19;
    for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
      ;
    var flen = bl + 5 << 3;
    var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
    var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
    if (bs >= 0 && flen <= ftlen && flen <= dtlen)
      return wfblk(out, p, dat.subarray(bs, bs + bl));
    var lm, ll, dm, dl;
    wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
    if (dtlen < ftlen) {
      lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
      var llm = hMap(lct, mlcb, 0);
      wbits(out, p, nlc - 257);
      wbits(out, p + 5, ndc - 1);
      wbits(out, p + 10, nlcc - 4);
      p += 14;
      for (var i = 0; i < nlcc; ++i)
        wbits(out, p + 3 * i, lct[clim[i]]);
      p += 3 * nlcc;
      var lcts = [lclt, lcdt];
      for (var it = 0; it < 2; ++it) {
        var clct = lcts[it];
        for (var i = 0; i < clct.length; ++i) {
          var len = clct[i] & 31;
          wbits(out, p, llm[len]), p += lct[len];
          if (len > 15)
            wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
        }
      }
    } else {
      lm = flm, ll = flt, dm = fdm, dl = fdt;
    }
    for (var i = 0; i < li; ++i) {
      var sym = syms[i];
      if (sym > 255) {
        var len = sym >> 18 & 31;
        wbits16(out, p, lm[len + 257]), p += ll[len + 257];
        if (len > 7)
          wbits(out, p, sym >> 23 & 31), p += fleb[len];
        var dst = sym & 31;
        wbits16(out, p, dm[dst]), p += dl[dst];
        if (dst > 3)
          wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
      } else {
        wbits16(out, p, lm[sym]), p += ll[sym];
      }
    }
    wbits16(out, p, lm[256]);
    return p + ll[256];
  };
  var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
  var et = /* @__PURE__ */ new u8(0);
  var dflt = function(dat, lvl, plvl, pre, post, st) {
    var s = st.z || dat.length;
    var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
    var w = o.subarray(pre, o.length - post);
    var lst = st.l;
    var pos = (st.r || 0) & 7;
    if (lvl) {
      if (pos)
        w[0] = st.r >> 3;
      var opt = deo[lvl - 1];
      var n = opt >> 13, c = opt & 8191;
      var msk_1 = (1 << plvl) - 1;
      var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
      var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
      var hsh = function(i2) {
        return (dat[i2] ^ dat[i2 + 1] << bs1_1 ^ dat[i2 + 2] << bs2_1) & msk_1;
      };
      var syms = new i32(25e3);
      var lf = new u16(288), df = new u16(32);
      var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
      for (; i + 2 < s; ++i) {
        var hv = hsh(i);
        var imod = i & 32767, pimod = head[hv];
        prev[imod] = pimod;
        head[hv] = imod;
        if (wi <= i) {
          var rem = s - i;
          if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
            pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
            li = lc_1 = eb = 0, bs = i;
            for (var j = 0; j < 286; ++j)
              lf[j] = 0;
            for (var j = 0; j < 30; ++j)
              df[j] = 0;
          }
          var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
          if (rem > 2 && hv == hsh(i - dif)) {
            var maxn = Math.min(n, rem) - 1;
            var maxd = Math.min(32767, i);
            var ml = Math.min(258, rem);
            while (dif <= maxd && --ch_1 && imod != pimod) {
              if (dat[i + l] == dat[i + l - dif]) {
                var nl = 0;
                for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                  ;
                if (nl > l) {
                  l = nl, d = dif;
                  if (nl > maxn)
                    break;
                  var mmd = Math.min(dif, nl - 2);
                  var md = 0;
                  for (var j = 0; j < mmd; ++j) {
                    var ti = i - dif + j & 32767;
                    var pti = prev[ti];
                    var cd = ti - pti & 32767;
                    if (cd > md)
                      md = cd, pimod = ti;
                  }
                }
              }
              imod = pimod, pimod = prev[imod];
              dif += imod - pimod & 32767;
            }
          }
          if (d) {
            syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
            var lin = revfl[l] & 31, din = revfd[d] & 31;
            eb += fleb[lin] + fdeb[din];
            ++lf[257 + lin];
            ++df[din];
            wi = i + l;
            ++lc_1;
          } else {
            syms[li++] = dat[i];
            ++lf[dat[i]];
          }
        }
      }
      for (i = Math.max(i, wi); i < s; ++i) {
        syms[li++] = dat[i];
        ++lf[dat[i]];
      }
      pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
      if (!lst) {
        st.r = pos & 7 | w[pos / 8 | 0] << 3;
        pos -= 7;
        st.h = head, st.p = prev, st.i = i, st.w = wi;
      }
    } else {
      for (var i = st.w || 0; i < s + lst; i += 65535) {
        var e = i + 65535;
        if (e >= s) {
          w[pos / 8 | 0] = lst;
          e = s;
        }
        pos = wfblk(w, pos + 1, dat.subarray(i, e));
      }
      st.i = s;
    }
    return slc(o, 0, pre + shft(pos) + post);
  };
  var crct = /* @__PURE__ */ (function() {
    var t = new Int32Array(256);
    for (var i = 0; i < 256; ++i) {
      var c = i, k = 9;
      while (--k)
        c = (c & 1 && -306674912) ^ c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  var crc = function() {
    var c = -1;
    return {
      p: function(d) {
        var cr = c;
        for (var i = 0; i < d.length; ++i)
          cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
        c = cr;
      },
      d: function() {
        return ~c;
      }
    };
  };
  var dopt = function(dat, opt, pre, post, st) {
    if (!st) {
      st = { l: 1 };
      if (opt.dictionary) {
        var dict = opt.dictionary.subarray(-32768);
        var newDat = new u8(dict.length + dat.length);
        newDat.set(dict);
        newDat.set(dat, dict.length);
        dat = newDat;
        st.w = dict.length;
      }
    }
    return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
  };
  var wbytes = function(d, b, v) {
    for (; v; ++b)
      d[b] = v, v >>>= 8;
  };
  var gzh = function(c, o) {
    var fn = o.filename;
    c[0] = 31, c[1] = 139, c[2] = 8, c[8] = o.level < 2 ? 4 : o.level == 9 ? 2 : 0, c[9] = 3;
    if (o.mtime != 0)
      wbytes(c, 4, Math.floor(new Date(o.mtime || Date.now()) / 1e3));
    if (fn) {
      c[3] = 8;
      for (var i = 0; i <= fn.length; ++i)
        c[i + 10] = fn.charCodeAt(i);
    }
  };
  var gzs = function(d) {
    if (d[0] != 31 || d[1] != 139 || d[2] != 8)
      err(6, "invalid gzip data");
    var flg = d[3];
    var st = 10;
    if (flg & 4)
      st += (d[10] | d[11] << 8) + 2;
    for (var zs = (flg >> 3 & 1) + (flg >> 4 & 1); zs > 0; zs -= !d[st++])
      ;
    return st + (flg & 2);
  };
  var gzl = function(d) {
    var l = d.length;
    return (d[l - 4] | d[l - 3] << 8 | d[l - 2] << 16 | d[l - 1] << 24) >>> 0;
  };
  var gzhl = function(o) {
    return 10 + (o.filename ? o.filename.length + 1 : 0);
  };
  function gzipSync(data, opts) {
    if (!opts)
      opts = {};
    var c = crc(), l = data.length;
    c.p(data);
    var d = dopt(data, opts, gzhl(opts), 8), s = d.length;
    return gzh(d, opts), wbytes(d, s - 8, c.d()), wbytes(d, s - 4, l), d;
  }
  function gunzipSync(data, opts) {
    var st = gzs(data);
    if (st + 8 > data.length)
      err(6, "invalid gzip data");
    return inflt(data.subarray(st, -8), { i: 2 }, opts && opts.out || new u8(gzl(data)), opts && opts.dictionary);
  }
  var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
  var tds = 0;
  try {
    td.decode(et, { stream: true });
    tds = 1;
  } catch (e) {
  }

  // src/shared/crypto.ts
  var subtle = globalThis.crypto.subtle;
  var BLOB_VERSION = 1;
  var COPY_VERSION = 1;
  var HMAC = { name: "HMAC", hash: "SHA-256" };
  function randomBytes(n) {
    return globalThis.crypto.getRandomValues(new Uint8Array(n));
  }
  async function hkdf(ikm, info) {
    const key = await subtle.importKey("raw", withPlainBuffer(ikm), "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8.encode(info) }, key, 256));
  }
  async function deriveFromPassword(argon2, email, password, params) {
    const salt = new Uint8Array(await subtle.digest("SHA-256", utf8.encode("pappdrive|" + normalizeEmail(email))));
    const out = await argon2(password.normalize("NFC"), salt, params);
    return { loginKey: await hkdf(out, "pappdrive login key"), passwordKey: await hkdf(out, "pappdrive password key") };
  }
  async function deriveFromRecovery(code) {
    return { recoveryLoginKey: await hkdf(code, "pappdrive recovery login key"), recoveryKey: await hkdf(code, "pappdrive recovery key") };
  }
  async function dataKeys(raw) {
    return {
      enc: await subtle.importKey("raw", await hkdf(raw, "pappdrive encrypt"), "AES-GCM", false, ["encrypt", "decrypt"]),
      blobId: await subtle.importKey("raw", await hkdf(raw, "pappdrive blob id"), HMAC, false, ["sign"]),
      fileId: await subtle.importKey("raw", await hkdf(raw, "pappdrive file id"), HMAC, false, ["sign"])
    };
  }
  async function lockDataKey(dataKey, lockKey) {
    const key = await subtle.importKey("raw", withPlainBuffer(lockKey), "AES-GCM", false, ["encrypt"]);
    return toBase64(concat(new Uint8Array([COPY_VERSION]), await seal(key, dataKey)));
  }
  async function unlockDataKey(copy, lockKey) {
    const bytes = fromBase64(copy);
    if (bytes[0] !== COPY_VERSION) {
      throw new SyncError("update-needed", "The locked key has an unknown format. Update pappdrive.");
    }
    const key = await subtle.importKey("raw", withPlainBuffer(lockKey), "AES-GCM", false, ["decrypt"]);
    return unseal(key, bytes.subarray(1), new SyncError("credentials", "The password or recovery code does not open this account's key."));
  }
  async function blobId(keys, plaintext) {
    return toHex(new Uint8Array(await subtle.sign("HMAC", keys.blobId, withPlainBuffer(plaintext))));
  }
  async function bigFileId(keys, partIds) {
    return toHex(new Uint8Array(await subtle.sign("HMAC", keys.fileId, concat(...partIds.map(fromHex)))));
  }
  async function encryptBlob(keys, plaintext) {
    return concat(new Uint8Array([BLOB_VERSION]), await seal(keys.enc, plaintext));
  }
  async function decryptBlob(keys, blob, expectedId) {
    if (blob[0] !== BLOB_VERSION) {
      throw new SyncError("update-needed", "A blob has an unknown format. Update pappdrive.");
    }
    const plaintext = await unseal(keys.enc, blob.subarray(1), new SyncError("server", "A downloaded blob did not decrypt. It will be fetched again on the next sync."));
    if (await blobId(keys, plaintext) !== expectedId) {
      throw new SyncError("server", "A downloaded blob does not match its id. It will be fetched again on the next sync.");
    }
    return plaintext;
  }
  async function encodeBody(keys, place, body) {
    return toBase64(await seal(keys.enc, gzipSync(utf8.encode(JSON.stringify(body))), utf8.encode(`pappdrive ${place.kind}|${place.app}|${place.base}`)));
  }
  async function decodeBody(keys, place, b64) {
    const gzip = await unseal(
      keys.enc,
      fromBase64(b64),
      new SyncError("server", `The ${place.kind} of "${place.app}" did not decrypt with this account's key, or the server sent one that belongs elsewhere.`),
      utf8.encode(`pappdrive ${place.kind}|${place.app}|${place.base}`)
    );
    return JSON.parse(fromUtf8.decode(gunzipSync(gzip)));
  }
  async function seal(key, plaintext, aad = new Uint8Array(0)) {
    const nonce = randomBytes(12);
    return concat(nonce, new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, withPlainBuffer(plaintext))));
  }
  async function unseal(key, sealed, failure, aad = new Uint8Array(0)) {
    const bytes = withPlainBuffer(sealed);
    return subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: aad }, key, bytes.subarray(12)).then(
      (plain) => new Uint8Array(plain),
      () => {
        throw failure;
      }
    );
  }

  // src/shared/recovery-code.ts
  var CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var BITS_PER_CHAR = 5;
  var CODE_BITS = 128;
  var CODE_CHARS = Math.ceil(CODE_BITS / BITS_PER_CHAR);
  var FIRST_CHAR_VALUES = 2 ** (CODE_BITS - (CODE_CHARS - 1) * BITS_PER_CHAR);
  function formatRecoveryCode(code) {
    let n = BigInt("0x" + toHex(code));
    let s = "";
    for (let i = 0; i < CODE_CHARS; i++) {
      s = CROCKFORD_BASE32[Number(n & 31n)] + s;
      n >>= 5n;
    }
    return [s.slice(0, 5), s.slice(5, 10), s.slice(10, 15), s.slice(15, 20), s.slice(20)].join("-");
  }
  function foldRecoveryCode(text) {
    return text.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  }
  function parseRecoveryCode(text) {
    const s = foldRecoveryCode(text);
    if (s.length !== CODE_CHARS || [...s].some((c) => !CROCKFORD_BASE32.includes(c)) || CROCKFORD_BASE32.indexOf(s.charAt(0)) >= FIRST_CHAR_VALUES) {
      throw new SyncError("credentials", `That recovery code is not valid. Check it against the saved copy: ${CODE_CHARS} letters and digits.`);
    }
    let n = 0n;
    for (const c of s) {
      n = n << 5n | BigInt(CROCKFORD_BASE32.indexOf(c));
    }
    return fromHex(n.toString(16).padStart(CODE_BITS / 4, "0"));
  }

  // src/papp/http.ts
  var ApiError = class extends Error {
    status;
    error;
    missing;
    reason;
    retryAfter;
    constructor(status, error, extra = {}) {
      super(`server answered ${status} ${error}`);
      this.name = "ApiError";
      this.status = status;
      this.error = error;
      this.missing = extra.missing;
      this.reason = extra.reason;
      this.retryAfter = extra.retryAfter;
    }
  };
  async function send(server, method, path, init = {}) {
    const headers = { ...init.headers };
    if (init.token !== void 0) {
      headers["authorization"] = `Bearer ${init.token}`;
    }
    const res = await fetch(server + API_PREFIX + path, { method, headers, body: init.body }).catch(() => {
      throw new ApiError(0, "network");
    });
    if (res.ok || init.accept?.includes(res.status)) {
      return res;
    }
    const err2 = await res.json().catch(() => null);
    if (!err2?.error) {
      throw new ApiError(res.status, "server");
    }
    const retryAfter = res.headers.get("retry-after");
    throw new ApiError(res.status, err2.error, { missing: err2.missing, reason: err2.reason, retryAfter: retryAfter === null ? void 0 : Number(retryAfter) });
  }
  async function request(server, method, path, body, token) {
    const res = await send(server, method, path, {
      body: body === void 0 ? void 0 : JSON.stringify(body),
      headers: body === void 0 ? {} : { "content-type": "application/json" },
      token
    });
    return res.status === 204 ? void 0 : await res.json();
  }
  function decodeJwt(token) {
    const claims = token.split(".")[1];
    if (claims === void 0) {
      throw new SyncError("server", "The server sent an access token that is not a JWT. Check the server address in createPapp.");
    }
    return JSON.parse(fromUtf8.decode(fromBase64(claims.replace(/-/g, "+").replace(/_/g, "/"))));
  }

  // src/papp/account.ts
  async function prepareSignUp(server, argon2, email, password, scope) {
    const pk = await passwordKeys(server, argon2, email, password);
    const dataKey = randomBytes(32);
    const code = randomBytes(16);
    const rk = await deriveFromRecovery(code);
    const signup = {
      email,
      ...scope,
      loginKey: toBase64(pk.loginKey),
      recoveryLoginKey: toBase64(rk.recoveryLoginKey),
      passwordCopy: await lockDataKey(dataKey, pk.passwordKey),
      recoveryCopy: await lockDataKey(dataKey, rk.recoveryKey)
    };
    return { signup, dataKey, recoveryCode: formatRecoveryCode(code) };
  }
  async function logInWithPassword(server, argon2, email, password, scope) {
    const pk = await passwordKeys(server, argon2, email, password);
    const login = { email, ...scope, loginKey: toBase64(pk.loginKey) };
    const res = await request(server, "POST", "/auth/login", login);
    return { ...res, dataKey: await unlockDataKey(res.passwordCopy, pk.passwordKey) };
  }
  async function logInWithRecoveryCode(server, email, code, scope) {
    const rk = await deriveFromRecovery(code);
    const recover = { email, ...scope, recoveryLoginKey: toBase64(rk.recoveryLoginKey) };
    const res = await request(server, "POST", "/auth/recover", recover);
    return { ...res, dataKey: await unlockDataKey(res.recoveryCopy, rk.recoveryKey) };
  }
  async function deleteAppWithPassword(server, argon2, email, password, app) {
    await request(server, "POST", "/app/delete", { email, app, loginKey: toBase64((await passwordKeys(server, argon2, email, password)).loginKey) });
  }
  async function deleteAccountWithPassword(server, argon2, email, password) {
    await request(server, "POST", "/account/delete", { email, loginKey: toBase64((await passwordKeys(server, argon2, email, password)).loginKey) });
  }
  async function passwordKeys(server, argon2, email, password) {
    return deriveFromPassword(argon2, email, password, await request(server, "POST", "/auth/params", { email }));
  }

  // src/papp/errors.ts
  function goneError(reason) {
    const what = reason === "account" ? "The account was deleted. This device is signed out and its copy of the key is deleted." : "This app's folder was deleted. This device is signed out of the app.";
    return new SyncError("gone", `${what} Sign up or sign in again to start a new, empty folder.`, { reason });
  }
  function signedOut(detail = "Not signed in.") {
    return new SyncError("signed-out", `${detail} Sign in first: await papp.signIn(email, password), or the sign-in form.`);
  }
  function serverError(e, o) {
    switch (e.error) {
      case "expired":
        return signedOut("The session expired and could not be renewed.");
      case "network":
        return new SyncError("network", `Could not reach the server at ${o.server}. Check the connection and try again.`);
      case "credentials":
        return new SyncError(
          "credentials",
          o.path === "/auth/recover" ? "Wrong email or recovery code. Check both against the saved copy." : o.path === "/auth/verify" ? "Wrong or expired code. Check the latest email, or send a new code with papp.sendVerificationEmail()." : "Wrong email or password. Try again, or use the recovery code to set a new password."
        );
      case "exists":
        return new SyncError("exists", "An account with this email already exists. Sign in instead, or recover with the recovery code if the password is lost.");
      case "no-app": {
        const readFolders = o.read.length ? ` or one of the read folders (${o.read.join(", ")})` : "";
        return new SyncError(
          "no-app",
          `The app "${o.app}"${readFolders} does not exist in this account. Create it first with the command-line tool: npx pappdrive apps create ${o.app}. Then sign in again.`
        );
      }
      case "rate-limited": {
        const retryAfter = e.retryAfter;
        return new SyncError("rate-limited", `Too many tries. Wait ${retryAfter} seconds, then try again.`, { retryAfter });
      }
      case "not-allowed":
        return new SyncError("not-allowed", "The server refused this request for this token.");
      case "unverified":
        return new SyncError(
          "unverified",
          "The email address is not confirmed yet, so nothing is uploaded. Enter the code from the sign-up email with papp.verifyEmail(code); papp.sendVerificationEmail() sends a new one."
        );
      case "over-quota":
        return new SyncError("over-quota", "The account's storage is full, so new files wait on this device. Delete files, or upgrade the plan at https://pappdrive.com.");
      default:
        return new SyncError("server", `The server answered ${e.status} ${e.error}. Try again later; if it persists, update pappdrive.`);
    }
  }

  // src/papp/index-watch.ts
  var RETRY_MIN_MS = 1e3;
  var RETRY_MAX_MS = 6e4;
  var REOPEN_BEFORE_EXPIRY_MS = 3e4;
  function watchIndex(url, freshToken, check) {
    let socket = null;
    let timer = void 0;
    let retryMs = RETRY_MIN_MS;
    let stopped = false;
    connect();
    function connect() {
      void freshToken().then((token) => {
        if (stopped) {
          return;
        }
        const ws = new WebSocket(url, [WATCH_PROTOCOL, token]);
        socket = ws;
        ws.onopen = () => {
          retryMs = RETRY_MIN_MS;
          check();
          schedule(() => ws.close(), decodeJwt(token).exp * 1e3 - REOPEN_BEFORE_EXPIRY_MS - Date.now());
        };
        ws.onmessage = check;
        ws.onclose = () => {
          socket = null;
          retryLater();
        };
      }, retryLater);
    }
    function retryLater() {
      if (stopped) {
        return;
      }
      schedule(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    }
    function schedule(fn, ms) {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
      timer.unref?.();
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }

  // src/papp/api.ts
  var REFRESH_MARGIN_SECONDS = 60;
  function createApi(server, read, hooks) {
    let accessToken = null;
    let refreshToken = null;
    let refreshing = null;
    function setSession(nextRefresh, nextAccess) {
      refreshToken = nextRefresh;
      accessToken = nextAccess;
    }
    function clear() {
      refreshToken = null;
      accessToken = null;
      refreshing = null;
    }
    function refresh() {
      refreshing ??= (async () => {
        const sent = refreshToken;
        if (!sent) {
          throw signedOut();
        }
        try {
          const res = await request(server, "POST", "/auth/refresh", { refreshToken: sent, read });
          if (refreshToken === sent) {
            accessToken = res.accessToken;
          }
          return res.accessToken;
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            await hooks.onSignedOut();
            throw signedOut("This device was signed out on the server.");
          }
          return rethrow(e);
        }
      })().finally(() => {
        refreshing = null;
      });
      return refreshing;
    }
    async function authed(call) {
      const current = accessToken;
      const token = current !== null && decodeJwt(current).exp - REFRESH_MARGIN_SECONDS >= Date.now() / 1e3 ? current : await refresh();
      try {
        return await call(token);
      } catch (e) {
        if (!(e instanceof ApiError && e.error === "expired")) {
          return rethrow(e);
        }
        return call(await refresh()).catch((e2) => rethrow(e2));
      }
    }
    async function rethrow(e) {
      if (e instanceof ApiError && e.status === 410 && e.reason !== void 0) {
        await hooks.onGone(e.reason);
        throw goneError(e.reason);
      }
      throw e;
    }
    function folderApi(app, readOnly) {
      const q = readOnly ? `?app=${encodeURIComponent(app)}` : "";
      function translated(path, call) {
        return authed(call).catch((e) => {
          throw e instanceof ApiError ? serverError(e, { path, server, app, read }) : e;
        });
      }
      return {
        getDelta: (known) => translated("/delta", async (token) => {
          const res = await send(server, "GET", `/delta${q}`, { headers: known === null || known.etag === null ? {} : { "if-none-match": known.etag }, token, accept: [304, 404] });
          if (res.status === 304 && known !== null) {
            return { kind: "unchanged", known };
          } else if (res.status === 404) {
            return { kind: "missing" };
          }
          const etag = res.headers.get("ETag");
          const delta = await res.json();
          if (etag === null) {
            throw new SyncError("server", "The server sent the delta without its ETag. Update the server.");
          }
          checkVersion(delta.v);
          return { kind: "found", delta: { v: 1, base: delta.base, blobs: delta.blobs, body: delta.body }, etag };
        }),
        getIndex: (id) => translated("/index", async (token) => {
          const index = await (await send(server, "GET", `/index/${id}${q}`, { token })).json();
          checkVersion(index.v);
          return { v: 1, blobs: index.blobs, body: index.body };
        }),
        getBlob: (id) => translated("/blobs", async (token) => new Uint8Array(await (await send(server, "GET", `/blobs/${id}${q}`, { token })).arrayBuffer())),
        putBlob: (id, data) => translated("/blobs", async (token) => {
          await send(server, "PUT", `/blobs/${id}`, { body: withPlainBuffer(data), headers: { "content-type": "application/octet-stream" }, token });
        }),
        commitDelta: (delta, etag) => translated("/delta", (token) => commit(server, "/delta", { delta, etag }, token)),
        commitCheckpoint: (index, delta, etag) => translated("/index", (token) => commit(server, "/index", { index, delta, etag }, token)),
        watchIndex: (check) => watchIndex(`${server.replace(/^http/, "ws")}${API_PREFIX}/index/watch${q}`, () => authed(async (token) => token), check)
      };
    }
    return { setSession, clear, refresh, authed, folderApi };
  }
  function checkVersion(v) {
    if (v !== 1) {
      throw new SyncError(
        "update-needed",
        `The folder's index has format version ${String(v)}, which this version of pappdrive does not know. Sync has stopped so nothing is overwritten. Update the pappdrive package, then open the folder again.`
      );
    }
  }
  async function commit(server, path, body, token) {
    try {
      return { ok: true, etag: (await request(server, "PUT", path, body, token)).etag };
    } catch (e) {
      if (e instanceof ApiError && e.error === "stale") {
        return { ok: false, error: "stale" };
      } else if (e instanceof ApiError && e.error === "missing" && e.missing !== void 0) {
        return { ok: false, error: "missing", missing: e.missing };
      }
      throw e;
    }
  }

  // src/papp/folder/scan/ignore.ts
  var import_ignore = __toESM(require_ignore(), 1);
  var IGNORE_FILE = ".pappignore";
  var HARD_DIRS = [".git", HIDDEN_DIR];
  var SOFT_DEFAULTS = ["node_modules/", ".DS_Store", "Thumbs.db", "desktop.ini", "*.swp", "*.swo", "*~", ".#*", "~$*"];
  var GLOB_CHARS = /[*?[\]{}()!+@\\]/;
  function isHard(path) {
    return path.split("/").some((seg) => HARD_DIRS.includes(seg.toLowerCase()));
  }
  function ignoreRules(files = []) {
    const byDir = new Map([["", ""], ...files.map((f) => [f.dir, f.content])]);
    const levels = [...byDir].map(([dir, content]) => {
      const ig = (0, import_ignore.default)({ ignorecase: true });
      if (dir === "") {
        ig.add(SOFT_DEFAULTS);
      }
      ig.add(content);
      const lines = content.split(/\r?\n/);
      return {
        dir,
        key: dir.toLowerCase(),
        depth: dir === "" ? 0 : dir.split("/").length,
        // ignore 7's public test() also checks parent folders, within one file only; that breaks git's layering across .pappignore files. Only the private rule list tests one path.
        rules: ig._rules,
        lines,
        negations: lines.filter((x) => x.startsWith("!")).map((x) => x.slice(1))
      };
    }).sort((a, b) => a.depth - b.depth);
    const dirCache = /* @__PURE__ */ new Map();
    function ignores(path, isDir = false) {
      if (isHard(path)) {
        return true;
      }
      const parent = parentOf(path);
      if (parent !== "") {
        const cached = dirCache.get(parent);
        const parentIgnored = cached === void 0 ? ignores(parent, true) : cached;
        dirCache.set(parent, parentIgnored);
        if (parentIgnored) {
          return true;
        }
      }
      const segs = path.split("/");
      const key = path.toLowerCase();
      let ignored = false;
      for (const level of levels) {
        if (level.key !== "" && !key.startsWith(level.key + "/")) {
          continue;
        }
        const rel = segs.slice(level.depth).join("/");
        const r = level.rules.test(isDir ? rel + "/" : rel, true, "regex");
        if (r.ignored) {
          ignored = true;
        } else if (r.unignored) {
          ignored = false;
        }
      }
      return ignored;
    }
    function watcherSkipGlobs() {
      const globs = [".git", "**/.git", "**/.git/**", HIDDEN_DIR, `**/${HIDDEN_DIR}`, `**/${HIDDEN_DIR}/**`];
      const nodeModulesReincluded = levels.some((level) => {
        if (level.negations.length === 0) {
          return false;
        }
        const ig = (0, import_ignore.default)({ ignorecase: true }).add(level.negations);
        return ["node_modules/", "a/node_modules/", "a/b/node_modules/"].some((p) => ig.ignores(p));
      });
      if (!nodeModulesReincluded) {
        globs.push("node_modules", "**/node_modules", "**/node_modules/**");
      }
      for (const level of levels) {
        if (GLOB_CHARS.test(level.dir)) {
          continue;
        }
        const below = levels.filter((l) => level.key === "" || l.key === level.key || l.key.startsWith(level.key + "/"));
        if (below.some((l) => l.negations.length > 0)) {
          continue;
        }
        const prefix = level.dir ? level.dir + "/" : "";
        for (const raw of level.lines) {
          const line = raw.trimEnd();
          if (!line.endsWith("/") || line.startsWith("#") || line.includes("\\")) {
            continue;
          }
          let pat = line.slice(0, -1);
          if (pat === "" || pat === "/") {
            continue;
          }
          const anchored = pat.includes("/");
          pat = pat.replace(/^\//, "");
          const glob = anchored ? prefix + pat : `${prefix}**/${pat}`;
          globs.push(glob, glob + "/**");
        }
      }
      return [...new Set(globs)];
    }
    return { ignores, watcherSkipGlobs };
  }

  // src/papp/folder/files/read.ts
  var READ_CHUNK = 1024 * 1024;
  async function readAll(fs, path, size, chunk) {
    if (size <= chunk) {
      return fs.read(path, 0, size);
    }
    const parts = [];
    for (let off = 0; off < size; off += chunk) {
      parts.push(await fs.read(path, off, Math.min(chunk, size - off)));
    }
    return concat(...parts);
  }
  function notFound(path) {
    return new SyncError("not-found", `"${path}" does not exist. Check the path with files.list(), or write it first.`);
  }
  function fileStream(fs, p) {
    let off = 0;
    let opened = null;
    return new ReadableStream({
      async pull(c) {
        const st = opened ??= await fs.stat(p);
        if (!st) {
          return c.error(notFound(p));
        }
        const data = await fs.read(p, off, Math.min(READ_CHUNK, st.size - off));
        const now = await fs.stat(p);
        if (now?.size !== st.size || now.mtime !== st.mtime) {
          return c.error(new SyncError("changed", `"${p}" changed while it was read, so the bytes read so far mix two versions. Read it again.`));
        } else if (data.length === 0) {
          return c.close();
        }
        off += data.length;
        c.enqueue(data);
      }
    });
  }
  async function listFolder(fs, dir) {
    const out = [];
    for (const e of await fs.list(dir)) {
      const name = e.name.normalize("NFC");
      if (dir === "" && name.toLowerCase() === HIDDEN_DIR) {
        continue;
      }
      const path = joinPath(dir, name);
      if (e.dir) {
        if (await hasFiles(fs, path)) {
          out.push({ path, size: 0, mtime: 0, dir: true });
        }
      } else {
        const st = await fs.stat(path);
        if (st) {
          out.push({ path, size: st.size, mtime: st.mtime, dir: false });
        }
      }
    }
    return out.sort(
      (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    );
  }
  async function hasFiles(fs, dir) {
    for (const e of await fs.list(dir)) {
      if (!e.dir || await hasFiles(fs, joinPath(dir, e.name.normalize("NFC")))) {
        return true;
      }
    }
    return false;
  }

  // src/papp/folder/hash.ts
  async function entryFromParts(keys, partIds, size, mtime) {
    const [only, ...more] = partIds;
    if (only !== void 0 && more.length === 0) {
      return { id: only, size, mtime };
    }
    return { id: await bigFileId(keys, partIds), size, mtime, parts: partIds };
  }
  async function hashFile(fs, keys, path, partSize) {
    for (let i = 0; i < 3; i++) {
      const before = await fs.stat(path);
      if (!before) {
        return { state: "missing" };
      }
      const ids = [];
      if (before.size === 0) {
        ids.push(await blobId(keys, new Uint8Array(0)));
      }
      for (let off = 0; off < before.size; off += partSize) {
        ids.push(await blobId(keys, await fs.read(path, off, Math.min(partSize, before.size - off))));
      }
      const after = await fs.stat(path);
      if (!after) {
        return { state: "missing" };
      } else if (after.size === before.size && after.mtime === before.mtime) {
        return { state: "hashed", entry: await entryFromParts(keys, ids, before.size, before.mtime) };
      }
    }
    return { state: "changing" };
  }

  // src/papp/folder/files/write.ts
  async function streamToTemp(fs, keys, partSize, temp, data) {
    const ids = [];
    let chunks = [];
    let buffered = 0;
    let size = 0;
    const joined = () => {
      const [only, ...more] = chunks;
      return only !== void 0 && more.length === 0 ? only : concat(...chunks);
    };
    const emit = async (part) => {
      ids.push(await blobId(keys, part));
      await fs.tempAppend(temp, part);
    };
    const add = async (chunk) => {
      size += chunk.length;
      chunks.push(chunk);
      buffered += chunk.length;
      while (buffered >= partSize) {
        const all = joined();
        await emit(all.subarray(0, partSize));
        chunks = [all.subarray(partSize)];
        buffered -= partSize;
      }
    };
    if (data instanceof Uint8Array) {
      await add(data);
    } else if (data instanceof Blob || data instanceof ReadableStream) {
      const reader = (data instanceof Blob ? data.stream() : data).getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        await add(r.value);
      }
    } else {
      await add(utf8.encode(data));
    }
    if (buffered > 0 || size === 0) {
      await emit(joined());
    }
    return entryFromParts(keys, ids, size, 0);
  }
  async function checkNames(fs, p) {
    const segs = p.split("/");
    if (segs.some((s) => s.toLowerCase() === HIDDEN_DIR)) {
      throw new SyncError("bad-path", `"${p}" has a folder named ${HIDDEN_DIR}, the library's hidden folder. Use another name.`);
    }
    let dir = "";
    for (const [i, name] of segs.entries()) {
      const last = i === segs.length - 1;
      const match = (await fs.list(dir)).find((e) => pathKey(e.name) === pathKey(name));
      if (!match) {
        return;
      }
      const spelled = match.name.normalize("NFC");
      const existing = joinPath(dir, spelled);
      if (spelled !== name) {
        if (last && !match.dir) {
          throw new SyncError("case-clash", `"${existing}" already exists. Write to "${existing}", or remove it first.`);
        }
        const fixed = [existing, ...segs.slice(i + 1)].join("/");
        throw new SyncError("case-clash", `The folder "${existing}" already exists with other capitals. Write to "${fixed}" instead.`);
      } else if (last && match.dir) {
        throw new SyncError("bad-path", `"${p}" is a folder. A file and a folder cannot share a name. Write inside it, like "${p}/name", or pick another name.`);
      } else if (!last && !match.dir) {
        throw new SyncError("bad-path", `"${existing}" is a file, so "${p}" cannot be inside it. A file and a folder cannot share a name. Rename or remove "${existing}" first.`);
      }
      dir = existing;
    }
  }

  // src/papp/folder/files/index.ts
  function createFiles(d) {
    const { ctx, partSize, state, scanner, withLock } = d;
    const { fs, keys } = ctx;
    const activeWriteTemps = /* @__PURE__ */ new Set();
    async function write(path, data) {
      d.assertOpen();
      if (ctx.readOnly) {
        throw readOnlyError("write");
      }
      const p = devicePath(path);
      await checkNames(fs, p);
      const temp = `w-${toHex(randomBytes(8))}`;
      activeWriteTemps.add(temp);
      try {
        const entry = await streamToTemp(fs, keys, partSize, temp, data);
        await withLock(pathKey(p), async () => {
          const st = await fs.moveTempInto(temp, p);
          if (!d.isLeading()) {
            return;
          } else if (scanner.isIgnored(p)) {
            state.deleteDisk(pathKey(p));
          } else {
            state.setDisk({ path: p, entry: { ...entry, size: st.size, mtime: st.mtime } });
          }
        });
      } catch (e) {
        await fs.tempRemove(temp);
        throw e;
      } finally {
        activeWriteTemps.delete(temp);
      }
      if (d.isLeading() && baseName(p).toLowerCase() === IGNORE_FILE) {
        await scanner.refreshRules();
      }
      d.changedHere(p);
    }
    async function read(path) {
      d.assertOpen();
      const p = devicePath(path);
      const st = await fs.stat(p);
      if (!st) {
        throw notFound(path);
      }
      return readAll(fs, p, st.size, partSize);
    }
    function readStream(path) {
      d.assertOpen();
      return fileStream(fs, devicePath(path));
    }
    async function list(dir) {
      d.assertOpen();
      return listFolder(fs, dir === void 0 ? "" : devicePath(dir));
    }
    async function remove(path) {
      d.assertOpen();
      if (ctx.readOnly) {
        throw readOnlyError("remove");
      }
      const p = devicePath(path);
      if (!await fs.stat(p)) {
        throw new SyncError("not-found", `"${path}" does not exist, so there is nothing to remove. List files with files.list(); a folder goes away once its files are removed.`);
      }
      await withLock(pathKey(p), async () => {
        await fs.remove(p);
        if (d.isLeading()) {
          state.deleteDisk(pathKey(p));
        }
        await fs.removeEmptyDirs(parentOf(p));
      });
      d.changedHere(p);
    }
    async function removeCrashedWriteTemps() {
      for (const t of await fs.tempList()) {
        if (t.startsWith("w-") && !activeWriteTemps.has(t)) {
          await fs.tempRemove(t);
        }
      }
    }
    function devicePath(path) {
      const p = path.normalize("NFC");
      const problem = pathProblem(p);
      const key = pathKey(p);
      if (problem) {
        throw new SyncError("bad-path", `"${path}" is not a valid path: ${problem}.`);
      } else if (key === HIDDEN_DIR || key.startsWith(HIDDEN_DIR + "/")) {
        throw new SyncError("bad-path", `"${path}" is inside the library's hidden folder ${HIDDEN_DIR}/. Use another path.`);
      }
      const bad = p.split("/").find((seg) => !fs.canCreate(seg));
      if (bad !== void 0) {
        throw new SyncError(
          "bad-path",
          `"${path}" cannot be made on this device: the system refuses the name "${bad}". Avoid \\, and for Windows also < > : " | ? * and names like CON or NUL.`
        );
      }
      return p;
    }
    function readOnlyError(what) {
      return new SyncError(
        "read-only",
        `"${ctx.app}" is open read-only, so ${what} is not allowed. Change files through papp.files, the app's own folder, or in the "${ctx.app}" app itself.`
      );
    }
    return { write, read, readText: async (path) => fromUtf8.decode(await read(path)), readStream, list, remove, removeCrashedWriteTemps };
  }

  // src/papp/folder/locks.ts
  function createPathLocks() {
    const tails = /* @__PURE__ */ new Map();
    return async (key, fn) => {
      const prev = tails.get(key);
      const result = prev === void 0 ? fn() : prev.then(fn);
      const tail = result.then(
        () => void 0,
        () => void 0
      );
      tails.set(key, tail);
      try {
        return await result;
      } finally {
        if (tails.get(key) === tail) {
          tails.delete(key);
        }
      }
    };
  }

  // src/papp/folder/state.ts
  function sameVersion(a, b) {
    return a.entry.id === b.entry.id && baseName(a.path) === baseName(b.path);
  }
  function serverView(etag, base, blobs, delta) {
    const { seq, ops } = delta;
    const body = { ...base.body };
    for (const [path, entry] of Object.entries(ops)) {
      if (entry === null) {
        delete body[path];
      } else {
        body[path] = entry;
      }
    }
    const map = /* @__PURE__ */ new Map();
    for (const [path, entry] of Object.entries(body).sort(([a], [b]) => a < b ? -1 : 1)) {
      const key = pathKey(path);
      if (!map.has(key)) {
        map.set(key, { path, entry });
      }
    }
    return { etag, base, seq, ops, header: { ...base.header, ...blobs }, body, map };
  }
  var STATE_VERSION = 1;
  var UPLOADED_TRUST_MS = SWEEP_GRACE_MS - 36e5;
  function createLocalState(fs) {
    let uploaded = /* @__PURE__ */ new Map();
    const dirty = { disk: false, synced: false, uploaded: false, seenSeq: false };
    let flushing = Promise.resolve();
    const state = {
      disk: /* @__PURE__ */ new Map(),
      synced: /* @__PURE__ */ new Map(),
      server: null,
      seenSeq: 0,
      load,
      setSeenSeq,
      isKnown,
      setDisk,
      deleteDisk,
      replaceDisk,
      setSynced,
      deleteSynced,
      markUploaded,
      dropUploaded,
      isUploaded,
      flush
    };
    async function load() {
      state.disk = parseFiles(await fs.loadState("disk"));
      state.synced = parseFiles(await fs.loadState("synced"));
      const saved = await fs.loadState("uploaded");
      const blobs = saved === null ? {} : JSON.parse(saved).blobs;
      const cutoff = Date.now() - UPLOADED_TRUST_MS;
      uploaded = new Map(Object.entries(blobs).filter(([, t]) => t > cutoff));
      const seenSeq = await fs.loadState("seen-seq");
      state.seenSeq = seenSeq === null ? 0 : JSON.parse(seenSeq).seq;
    }
    function setSeenSeq(seq) {
      state.seenSeq = seq;
      dirty.seenSeq = true;
    }
    function isKnown(key) {
      return state.synced.has(key) || state.server?.map.has(key) === true;
    }
    function setDisk(rec) {
      state.disk.set(pathKey(rec.path), rec);
      dirty.disk = true;
    }
    function deleteDisk(key) {
      if (state.disk.delete(key)) {
        dirty.disk = true;
      }
    }
    function replaceDisk(map) {
      state.disk = map;
      dirty.disk = true;
    }
    function setSynced(rec) {
      state.synced.set(pathKey(rec.path), rec);
      dirty.synced = true;
    }
    function deleteSynced(key) {
      if (state.synced.delete(key)) {
        dirty.synced = true;
      }
    }
    function markUploaded(id) {
      uploaded.set(id, Date.now());
      dirty.uploaded = true;
    }
    function dropUploaded(id) {
      if (uploaded.delete(id)) {
        dirty.uploaded = true;
      }
    }
    function isUploaded(id) {
      const t = uploaded.get(id);
      return t !== void 0 && t > Date.now() - UPLOADED_TRUST_MS;
    }
    function flush() {
      const run = flushing.then(async () => {
        if (dirty.disk) {
          dirty.disk = false;
          await fs.saveState("disk", serializeFiles(state.disk));
        }
        if (dirty.synced) {
          dirty.synced = false;
          await fs.saveState("synced", serializeFiles(state.synced));
        }
        if (dirty.uploaded) {
          dirty.uploaded = false;
          await fs.saveState("uploaded", JSON.stringify({ v: STATE_VERSION, blobs: Object.fromEntries(uploaded) }));
        }
        if (dirty.seenSeq) {
          dirty.seenSeq = false;
          await fs.saveState("seen-seq", JSON.stringify({ v: STATE_VERSION, seq: state.seenSeq }));
        }
      });
      flushing = run.catch(() => {
      });
      return run;
    }
    return state;
  }
  function parseFiles(text) {
    const files = text === null ? {} : JSON.parse(text).files;
    const out = /* @__PURE__ */ new Map();
    for (const [path, { skipped, ...entry }] of Object.entries(files)) {
      out.set(pathKey(path), skipped ? { path, entry, skipped } : { path, entry });
    }
    return out;
  }
  function serializeFiles(map) {
    const files = {};
    for (const rec of map.values()) {
      files[rec.path] = rec.skipped ? { ...rec.entry, skipped: rec.skipped } : rec.entry;
    }
    return JSON.stringify({ v: STATE_VERSION, files });
  }

  // src/papp/folder/round/download.ts
  var CONCURRENCY = 3;
  async function downloadAll(r, jobs, land2, onError) {
    const { fs, keys, api } = r.ctx;
    const sorted = [...jobs].sort((a, b) => a.entry.size - b.entry.size);
    const fetchBlob = async (id, size) => {
      const pt = await decryptBlob(keys, await api.getBlob(id), id);
      if (pt.length !== size) {
        throw new SyncError("server", `Blob ${id} has the wrong size. The next sync fetches the index again.`);
      }
      return pt;
    };
    const fetchToTemp = async (entry) => {
      const temp = entry.id;
      if (!entry.parts) {
        if (await fs.tempSize(temp) === entry.size) {
          return temp;
        }
        const pt = await fetchBlob(entry.id, entry.size);
        await fs.tempRemove(temp);
        await fs.tempAppend(temp, pt);
        return temp;
      } else if (await bigFileId(keys, entry.parts) !== entry.id) {
        throw new SyncError("server", "A big file's part list does not match its file id. The next sync fetches the index again.");
      }
      const have = await fs.tempSize(temp);
      const whole = have === null || have > entry.size ? 0 : Math.floor(have / r.partSize);
      if (have !== null && have !== whole * r.partSize) {
        await fs.tempTruncate(temp, whole * r.partSize);
      }
      for (const [i, part] of entry.parts.entries()) {
        if (i < whole) {
          continue;
        }
        r.signal.throwIfAborted();
        await fs.tempAppend(temp, await fetchBlob(part, Math.min(r.partSize, entry.size - i * r.partSize)));
      }
      return temp;
    };
    const sameBlob = Map.groupBy(sorted, (job) => job.entry.id).values();
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, sorted.length) }, async () => {
        for (const jobs2 of sameBlob) {
          for (const job of jobs2) {
            r.signal.throwIfAborted();
            try {
              const temp = await fetchToTemp(job.entry);
              r.signal.throwIfAborted();
              await land2(job, temp);
            } catch (e) {
              onError(job, e);
            }
          }
        }
      })
    );
  }

  // src/papp/folder/round/moves.ts
  async function conflictCopy(r, key, path) {
    const copy = await r.withLock(key, async () => {
      const live = r.state.disk.get(key);
      return live && moveToConflictCopy(r, live.path, live.entry);
    });
    if (copy) {
      r.fire({ path, origin: "conflict", copy });
    }
    return copy !== void 0;
  }
  async function moveToConflictCopy(r, path, entry) {
    const { fs } = r.ctx;
    const when = /* @__PURE__ */ new Date();
    const onDisk = /* @__PURE__ */ new Set();
    const taken = (k) => r.state.disk.has(k) || r.state.isKnown(k) || onDisk.has(k);
    let copy = conflictName(path, when, taken);
    while (await fs.stat(copy)) {
      onDisk.add(pathKey(copy));
      copy = conflictName(path, when, taken);
    }
    const before = await fs.stat(path);
    await fs.move(path, copy);
    r.state.deleteDisk(pathKey(path));
    const after = await fs.stat(copy);
    if (after && !r.scanner.isIgnored(copy)) {
      r.state.setDisk({ path: copy, entry: carry(entry, before, after) });
    }
    return copy;
  }
  async function renameLocal(r, from, to) {
    if (from === to) {
      return;
    }
    const { fs } = r.ctx;
    const before = await fs.stat(from);
    if (fs.caseInsensitive && pathKey(from) === pathKey(to)) {
      const tmp = `${from}.pappdrive-rename-${toHex(randomBytes(4))}`;
      await fs.move(from, tmp);
      await fs.move(tmp, to);
    } else {
      await fs.move(from, to);
    }
    const rec = r.state.disk.get(pathKey(from));
    r.state.deleteDisk(pathKey(from));
    const after = await fs.stat(to);
    if (rec && after) {
      r.state.setDisk({ path: to, entry: carry(rec.entry, before, after) });
    }
  }
  function carry(entry, before, after) {
    if (entry && before && before.size === entry.size && before.mtime === entry.mtime) {
      return { ...entry, size: after.size, mtime: after.mtime };
    }
    return { id: "", size: after.size, mtime: -1 };
  }
  function conflictName(path, when, taken, isFolder = false) {
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`;
    const dir = parentOf(path);
    const base = baseName(path);
    const dot = isFolder ? -1 : base.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ""];
    for (let n = 1; ; n++) {
      const name = `${stem} (conflict ${stamp}${n > 1 ? ` ${n}` : ""})${ext}`;
      const full = joinPath(dir, name);
      if (!taken(pathKey(full))) {
        return full;
      }
    }
  }

  // src/papp/folder/round/spelling.ts
  function localTarget(serverPath, d, spell) {
    return d ? joinPath(parentOf(d.path), baseName(serverPath)) : respell(serverPath, spell);
  }
  function folderSpellings(paths) {
    const spell = /* @__PURE__ */ new Map();
    for (const p of paths) {
      const segs = p.split("/");
      for (let i = 1; i < segs.length; i++) {
        const dir = segs.slice(0, i).join("/");
        if (!spell.has(pathKey(dir))) {
          spell.set(pathKey(dir), dir);
        }
      }
    }
    return spell;
  }
  function respell(path, spell) {
    let out = "";
    for (const seg of path.split("/").slice(0, -1)) {
      const key = pathKey(joinPath(out, seg));
      const known = spell.get(key);
      out = known === void 0 ? joinPath(out, seg) : known;
      spell.set(key, out);
    }
    return joinPath(out, baseName(path));
  }

  // src/papp/folder/round/apply.ts
  var RECENT_MS = 2e3;
  async function applyServer(r, decisions) {
    const spell = folderSpellings([...r.state.disk.values()].map((rec) => rec.path));
    const jobs = [];
    const deletes = [];
    for (const dec of decisions) {
      r.signal.throwIfAborted();
      const { key } = dec;
      switch (dec.action) {
        case "conflict": {
          const { server } = dec;
          const moved = await conflictCopy(r, key, server.path);
          jobs.push({ key, path: server.path, entry: server.entry, target: respell(server.path, spell), expected: void 0, quiet: moved });
          break;
        }
        case "download": {
          const { disk, server } = dec;
          if (disk?.entry.id === server.entry.id) {
            await adopt(r, key, server.path, server.entry, spell);
          } else {
            jobs.push({ key, path: server.path, entry: server.entry, target: localTarget(server.path, disk, spell), expected: disk, quiet: false });
          }
          break;
        }
        case "adopt":
          await adopt(r, key, dec.server.path, dec.server.entry, spell);
          break;
        case "forget":
          r.state.deleteSynced(key);
          break;
        case "delete-here":
          deletes.push(dec);
          break;
        case "upload":
        case "delete-server":
          break;
      }
    }
    let firstError = null;
    const keepTemps = /* @__PURE__ */ new Set();
    const download = async (list) => {
      let flushed = Date.now();
      await downloadAll(
        r,
        list,
        async (job, temp) => {
          await land(r, job, temp);
          if (Date.now() - flushed > 2e3) {
            flushed = Date.now();
            await r.state.flush();
          }
        },
        (job, e) => {
          keepTemps.add(job.entry.id);
          firstError ??= e;
        }
      );
      r.signal.throwIfAborted();
    };
    const blocked = blockedChecker(r);
    const ready = [];
    const later = [];
    for (const j of jobs) {
      (blocked(j.target) ? later : ready).push(j);
    }
    await download(ready);
    const emptied = /* @__PURE__ */ new Set();
    for (const dec of deletes) {
      await deleteHere(r, dec, emptied);
    }
    for (const dir of emptied) {
      await r.ctx.fs.removeEmptyDirs(dir);
    }
    const stillBlocked = blockedChecker(r);
    const unblocked = [];
    for (const j of later) {
      if (stillBlocked(j.target)) {
        keepTemps.add(j.entry.id);
      } else {
        unblocked.push(j);
      }
    }
    await download(unblocked);
    for (const t of await r.ctx.fs.tempList()) {
      if (ID_RE.test(t) && !keepTemps.has(t)) {
        await r.ctx.fs.tempRemove(t);
      }
    }
    await r.state.flush();
    return firstError;
  }
  async function adopt(r, key, path, entry, spell) {
    await r.withLock(key, async () => {
      const live = r.state.disk.get(key);
      if (!live || live.entry.id !== entry.id) {
        return;
      }
      await renameLocal(r, live.path, localTarget(path, live, spell));
      r.state.setSynced({ path, entry });
    });
  }
  async function land(r, j, temp) {
    const { fs, keys } = r.ctx;
    await r.withLock(j.key, async () => {
      r.signal.throwIfAborted();
      const live = r.state.disk.get(j.key);
      const here = live ? live.path : j.expected ? j.expected.path : j.target;
      const saved = await unchangedSince(r, j.expected, live, j.target) ? null : await hashFile(fs, keys, here, r.partSize);
      if (saved?.state === "hashed" && saved.entry.id === j.entry.id) {
        r.state.setDisk({ path: here, entry: saved.entry });
        r.state.setSynced({ path: j.path, entry: j.entry });
        await fs.tempRemove(temp);
        return;
      }
      const copy = saved === null || saved.state === "missing" ? void 0 : await moveToConflictCopy(r, here, saved.state === "hashed" ? saved.entry : void 0);
      const old = saved === null ? live : void 0;
      const respelled = old !== void 0 && old.path !== j.target;
      if (respelled && fs.caseInsensitive) {
        await renameLocal(r, old.path, j.target);
      }
      const st = await fs.moveTempInto(temp, j.target);
      if (respelled && !fs.caseInsensitive) {
        await fs.remove(old.path);
      }
      r.state.setDisk({ path: j.target, entry: { ...j.entry, size: st.size, mtime: st.mtime } });
      r.state.setSynced({ path: j.path, entry: j.entry });
      if (copy) {
        r.fire({ path: j.target, origin: "conflict", copy });
      } else if (!j.quiet) {
        r.fire({ path: j.target, origin: "remote" });
      }
    });
  }
  async function deleteHere(r, dec, emptied) {
    const { fs, keys } = r.ctx;
    const expected = dec.disk;
    await r.withLock(dec.key, async () => {
      r.signal.throwIfAborted();
      const live = r.state.disk.get(dec.key);
      if (!live) {
        r.state.deleteSynced(dec.key);
        return;
      } else if (await unchangedSince(r, expected, live, expected.path)) {
        await fs.remove(expected.path);
        r.state.deleteDisk(dec.key);
        r.state.deleteSynced(dec.key);
        emptied.add(parentOf(expected.path));
        r.fire({ path: expected.path, origin: "remote" });
        return;
      }
      const h = await hashFile(fs, keys, live.path, r.partSize);
      if (h.state === "hashed") {
        r.state.setDisk({ path: live.path, entry: h.entry });
      }
    });
  }
  async function unchangedSince(r, expected, live, target) {
    const { fs, keys } = r.ctx;
    if (!expected) {
      return !live && await fs.stat(target) === null;
    } else if (!live || live.entry.id !== expected.entry.id || live.path !== expected.path) {
      return false;
    }
    const st = await fs.stat(expected.path);
    if (!st || st.size !== expected.entry.size || st.mtime !== expected.entry.mtime) {
      return false;
    } else if (Date.now() - st.mtime >= RECENT_MS) {
      return true;
    }
    const h = await hashFile(fs, keys, expected.path, r.partSize);
    return h.state === "hashed" && h.entry.id === expected.entry.id;
  }
  function blockedChecker(r) {
    const dirs = dirKeysOf([...r.state.disk.values()].map((rec) => rec.path));
    return (target) => {
      const key = pathKey(target);
      if (dirs.has(key)) {
        return true;
      }
      const segs = key.split("/");
      for (let i = 1; i < segs.length; i++) {
        if (r.state.disk.has(segs.slice(0, i).join("/"))) {
          return true;
        }
      }
      return false;
    };
  }

  // src/papp/folder/round/clashes.ts
  async function resolveClashes(r, decisions, view) {
    const uploads = decisions.filter((d) => d.action === "upload");
    if (uploads.length === 0) {
      return false;
    }
    const mine = new Set(decisions.filter((d) => d.action === "upload" || d.action === "delete-server").map((d) => d.key));
    const paths = [];
    for (const [key, v] of view.map) {
      if (!mine.has(key)) {
        paths.push({ key, path: v.path, local: false });
      }
    }
    for (const d of uploads) {
      paths.push({ key: d.key, path: d.disk.path, local: true });
    }
    const clashes = findClashes(paths);
    if (clashes.length === 0) {
      return false;
    }
    const when = /* @__PURE__ */ new Date();
    for (const c of clashes) {
      r.signal.throwIfAborted();
      if (c.move === "file") {
        await conflictCopy(r, c.file.key, c.file.path);
        continue;
      }
      const prefix = c.file.key + "/";
      const localDir = c.inside[0].path.split("/").slice(0, c.file.key.split("/").length).join("/");
      const emptied = /* @__PURE__ */ new Set();
      for (const d of decisions) {
        if (d.action === "delete-here" && d.key.startsWith(prefix)) {
          await deleteHere(r, d, emptied);
        }
      }
      const dirs = dirKeysOf([...r.state.disk.values(), ...view.map.values(), ...r.state.synced.values()].map((rec) => rec.path));
      const newDir = conflictName(localDir, when, (k) => r.state.disk.has(k) || r.state.isKnown(k) || dirs.has(k), true);
      await r.ctx.fs.move(localDir, newDir);
      for (const [k, rec] of [...r.state.disk]) {
        if (k.startsWith(prefix)) {
          r.state.deleteDisk(k);
          r.state.setDisk({ ...rec, path: newDir + rec.path.slice(localDir.length) });
        }
      }
      r.fire({ path: c.file.path, origin: "conflict", copy: newDir });
    }
    await r.state.flush();
    return true;
  }
  function findClashes(paths) {
    const clashes = new Map(paths.map((file) => [file.key, { file, inside: [] }]));
    for (const p of paths) {
      const segs = p.key.split("/");
      for (let i = 1; i < segs.length; i++) {
        clashes.get(segs.slice(0, i).join("/"))?.inside.push(p);
      }
    }
    const out = [];
    for (const { file, inside } of clashes.values()) {
      const [first, ...rest] = inside;
      const [firstLocal, ...restLocal] = inside.filter((p) => p.local);
      if (first === void 0) {
        continue;
      } else if (file.local && firstLocal === void 0) {
        out.push({ file, inside: [first, ...rest], move: "file" });
      } else if (!file.local && firstLocal !== void 0) {
        out.push({ file, inside: [firstLocal, ...restLocal], move: "folder" });
      }
    }
    return out;
  }

  // src/papp/folder/round/upload.ts
  var BATCH_BYTES = 32 * 1024 * 1024;
  var PUT_CONCURRENCY = 4;
  function createUploader(ctx, state, partSize, header) {
    let batch = [];
    let batchBytes = 0;
    const inBatch = /* @__PURE__ */ new Set();
    const sources = /* @__PURE__ */ new Map();
    async function addFile(path, entry) {
      const { fs, keys } = ctx;
      const before = await fs.stat(path);
      if (!before) {
        return "missing";
      } else if (before.size !== entry.size || before.mtime !== entry.mtime) {
        return "changed";
      }
      const ids = blobIdsOf(entry);
      for (const [i, id] of ids.entries()) {
        const offset = i * partSize;
        const length = Math.min(partSize, entry.size - offset);
        sources.set(id, { path, offset, length });
        if (header[id] !== void 0 || state.isUploaded(id) || inBatch.has(id)) {
          continue;
        }
        const data = await fs.read(path, offset, length);
        if (await blobId(keys, data) !== id) {
          return "changed";
        }
        await addBlob(id, data);
      }
      const after = await fs.stat(path);
      if (!after) {
        return "missing";
      }
      return after.size === before.size && after.mtime === before.mtime ? "ok" : "changed";
    }
    async function reupload(ids) {
      for (const id of ids) {
        state.dropUploaded(id);
        const src = sources.get(id);
        if (!src) {
          return false;
        }
        const data = await ctx.fs.read(src.path, src.offset, src.length);
        if (await blobId(ctx.keys, data) !== id) {
          return false;
        }
        await addBlob(id, data);
      }
      await flush();
      return true;
    }
    async function flush() {
      if (batch.length === 0) {
        return;
      }
      const sending = batch;
      batch = [];
      batchBytes = 0;
      try {
        const queue = sending.values();
        await Promise.all(
          Array.from({ length: Math.min(PUT_CONCURRENCY, sending.length) }, async () => {
            for (const b of queue) {
              await ctx.api.putBlob(b.id, b.data);
              state.markUploaded(b.id);
            }
          })
        );
      } finally {
        for (const b of sending) {
          inBatch.delete(b.id);
        }
        await state.flush();
      }
    }
    async function addBlob(id, plaintext) {
      const data = await encryptBlob(ctx.keys, plaintext);
      if (batch.length > 0 && batchBytes + data.length > BATCH_BYTES) {
        await flush();
      }
      batch.push({ id, data });
      batchBytes += data.length;
      inBatch.add(id);
    }
    return { addFile, reupload, flush };
  }

  // src/papp/folder/round/commit.ts
  async function commitLocal(r, view, decisions) {
    const uploads = decisions.filter((d) => d.action === "upload");
    const deletes = decisions.filter((d) => d.action === "delete-server");
    if (uploads.length === 0 && deletes.length === 0) {
      return "done";
    }
    const uploader = createUploader(r.ctx, r.state, r.partSize, view.header);
    const uploaded = await uploadFiles(
      r,
      uploader,
      uploads.map((d) => d.key)
    );
    await uploader.flush();
    r.signal.throwIfAborted();
    const { body, ops, changes } = nextIndex(
      view,
      deletes.map((d) => d.server.path),
      uploaded
    );
    if (changes.length === 0 && deletes.length === 0) {
      return "done";
    }
    const next = await publish(r, uploader, view, body, ops);
    if (next === "stale") {
      return "stale";
    }
    for (const c of changes) {
      r.state.setSynced(c);
    }
    for (const d of deletes) {
      r.state.deleteSynced(d.key);
    }
    for (const id of Object.keys(next.header)) {
      r.state.dropUploaded(id);
    }
    r.state.server = next;
    r.state.setSeenSeq(next.seq);
    await r.state.flush();
    return "done";
  }
  async function uploadFiles(r, uploader, keys) {
    const uploaded = [];
    for (const key of keys) {
      r.signal.throwIfAborted();
      let rec = r.state.disk.get(key);
      for (let tries = 0; rec && tries < 4; tries++) {
        const result = await uploader.addFile(rec.path, rec.entry);
        if (result === "ok") {
          uploaded.push(rec);
          break;
        } else if (result === "missing") {
          break;
        }
        const h = await hashFile(r.ctx.fs, r.ctx.keys, rec.path, r.partSize);
        if (h.state !== "hashed") {
          break;
        }
        rec = { path: rec.path, entry: h.entry };
        r.state.setDisk(rec);
      }
    }
    return uploaded;
  }
  function nextIndex(view, deleted, uploaded) {
    const body = { ...view.body };
    for (const path of deleted) {
      delete body[path];
    }
    const spell = folderSpellings(Object.keys(body));
    const respelled = [];
    for (const rec of uploaded) {
      const old = view.map.get(pathKey(rec.path));
      if (old) {
        delete body[old.path];
      }
      const path = respell(rec.path, spell);
      body[path] = rec.entry;
      respelled.push({ path, entry: rec.entry });
    }
    const changed = new Set(respelled.map((c) => c.path));
    const held = /* @__PURE__ */ new Set();
    for (const c of findClashes(Object.keys(body).map((p) => ({ key: pathKey(p), path: p, local: changed.has(p) })))) {
      for (const p of [c.file, ...c.inside]) {
        if (p.local) {
          held.add(p.path);
        }
      }
    }
    for (const path of held) {
      delete body[path];
      const old = view.map.get(pathKey(path));
      if (old) {
        body[old.path] = old.entry;
      }
    }
    const changes = respelled.filter((c) => !held.has(c.path));
    const ops = { ...view.ops };
    for (const path of Object.keys(view.body)) {
      if (body[path] === void 0) {
        ops[path] = null;
      }
    }
    for (const c of changes) {
      ops[c.path] = c.entry;
    }
    return { body, ops, changes };
  }
  async function publish(r, uploader, view, body, ops) {
    const { keys, api, app } = r.ctx;
    const seq = view.seq + 1;
    if (view.base !== null) {
      const { base: base2, etag } = view;
      const changed = Object.values(ops).filter((entry) => entry !== null);
      const blobs = Object.fromEntries(Object.entries(headerOf(changed, view.header, r.partSize)).filter(([id]) => base2.header[id] === void 0));
      if (Object.keys(ops).length <= DELTA_MAX && Object.keys(blobs).length <= DELTA_MAX) {
        const payload2 = { seq, ops };
        const delta2 = { v: 1, base: base2.id, blobs, body: await encodeBody(keys, { kind: "delta", app, base: base2.id }, payload2) };
        const sent2 = await send2(r, uploader, () => api.commitDelta(delta2, etag));
        return sent2 === "stale" ? "stale" : serverView(sent2.etag, base2, blobs, payload2);
      }
    }
    const base = { id: toHex(randomBytes(32)), header: headerOf(Object.values(body), view.header, r.partSize), body };
    const payload = { seq, ops: {} };
    const index = { v: 1, blobs: base.header, body: await encodeBody(keys, { kind: "index", app, base: base.id }, body) };
    const delta = { v: 1, base: base.id, blobs: {}, body: await encodeBody(keys, { kind: "delta", app, base: base.id }, payload) };
    const sent = await send2(r, uploader, () => api.commitCheckpoint(index, delta, view.etag));
    return sent === "stale" ? "stale" : serverView(sent.etag, base, {}, payload);
  }
  function headerOf(entries, known, partSize) {
    const header = {};
    for (const entry of entries) {
      for (const [i, id] of blobIdsOf(entry).entries()) {
        const stored = known[id];
        header[id] = stored === void 0 ? Math.min(partSize, entry.size - i * partSize) + BLOB_OVERHEAD : stored;
      }
    }
    return header;
  }
  async function send2(r, uploader, attempt) {
    for (let tries = 0; ; tries++) {
      r.signal.throwIfAborted();
      const result = await attempt();
      if (result.ok) {
        return { etag: result.etag };
      } else if (result.error === "stale" || tries >= 3 || !await uploader.reupload(result.missing)) {
        return "stale";
      }
    }
  }

  // src/papp/folder/round/decide.ts
  function frozenKeys(disk, view, fs) {
    const frozen = /* @__PURE__ */ new Set();
    const skipped = [];
    for (const [key, d] of disk) {
      if (d.skipped) {
        frozen.add(key);
        skipped.push(d.path);
      }
    }
    for (const [key, v] of view.map) {
      if (frozen.has(key)) {
        continue;
      } else if (isHard(v.path)) {
        frozen.add(key);
      } else if (pathProblem(v.path) || v.path.split("/").some((seg) => !fs.canCreate(seg))) {
        frozen.add(key);
        skipped.push(v.path);
      }
    }
    return { frozen, skipped: skipped.sort() };
  }
  function decide(input) {
    const { disk, synced, server, frozen, readOnly } = input;
    const keys = /* @__PURE__ */ new Set([...disk.keys(), ...synced.keys(), ...server.keys()]);
    const out = [];
    for (const key of keys) {
      if (frozen.has(key)) {
        continue;
      }
      const d = disk.get(key);
      const s = synced.get(key);
      const v = server.get(key);
      const decision = readOnly ? decideReadOnly(key, d, s, v) : decideOne(key, d, s, v);
      if (decision) {
        out.push(decision);
      }
    }
    return out;
  }
  function decideOne(key, d, s, v) {
    if (!s) {
      if (d && v) {
        return { key, action: d.entry.id === v.entry.id ? "adopt" : "conflict", disk: d, server: v };
      } else if (d) {
        return { key, action: "upload", disk: d, server: void 0 };
      } else if (v) {
        return { key, action: "download", disk: void 0, server: v };
      }
      return null;
    } else if (!d) {
      if (!v) {
        return { key, action: "forget" };
      }
      return sameVersion(v, s) ? { key, action: "delete-server", server: v } : { key, action: "download", disk: void 0, server: v };
    } else if (!v) {
      return sameVersion(d, s) ? { key, action: "delete-here", disk: d } : { key, action: "upload", disk: d, server: void 0 };
    }
    const diskChanged = !sameVersion(d, s);
    const serverChanged = !sameVersion(v, s);
    if (!diskChanged && !serverChanged) {
      return null;
    } else if (!diskChanged) {
      return { key, action: "download", disk: d, server: v };
    } else if (!serverChanged) {
      return { key, action: "upload", disk: d, server: v };
    }
    return { key, action: d.entry.id === v.entry.id ? "adopt" : "conflict", disk: d, server: v };
  }
  function decideReadOnly(key, d, s, v) {
    if (v) {
      if (!d || d.entry.id !== v.entry.id) {
        return { key, action: "download", disk: d, server: v };
      } else if (!s || !sameVersion(s, v) || baseName(d.path) !== baseName(v.path)) {
        return { key, action: "adopt", disk: d, server: v };
      }
      return null;
    } else if (d) {
      return { key, action: "delete-here", disk: d };
    } else if (s) {
      return { key, action: "forget" };
    }
    return null;
  }

  // src/papp/folder/round/index.ts
  var ROUND_TRIES = 8;
  function createSyncEngine(r) {
    let reportedSkipped = /* @__PURE__ */ new Set();
    async function round(local) {
      try {
        let downloadError = null;
        for (let i = 0; i < ROUND_TRIES; i++) {
          const attempt = await roundOnce(local);
          downloadError ??= attempt.downloadError;
          if (attempt.commit === "done") {
            return { downloadError, skipped: attempt.skipped };
          }
        }
        throw new SyncError("server", "Other devices kept committing first, so this device's changes wait. The next sync tries again.");
      } catch (e) {
        if (r.signal.aborted) {
          return "stopped";
        }
        throw e;
      } finally {
        if (!r.signal.aborted) {
          await r.state.flush();
        }
      }
    }
    async function roundOnce(local) {
      const { readOnly, fs } = r.ctx;
      const view = await fetchIndex();
      await r.scanner.refreshRules();
      if (r.scanner.needsFullScan || fs.kind === "visible" && !fs.watch) {
        for (const p of await r.scanner.scan()) {
          if (!r.scanner.isIgnored(p)) {
            r.fire({ path: p, origin: "local" });
          }
        }
      }
      r.signal.throwIfAborted();
      const { frozen, skipped } = frozenKeys(r.state.disk, view, fs);
      for (const p of skipped) {
        if (!reportedSkipped.has(p)) {
          r.fire({ path: p, origin: "skipped", reason: "bad name" });
        }
      }
      reportedSkipped = new Set(skipped);
      const decideNow = () => decide({ disk: r.state.disk, synced: r.state.synced, server: view.map, frozen, readOnly });
      const first = decideNow();
      const decisions = !readOnly && await resolveClashes(r, first, view) ? decideNow() : first;
      const downloadError = await applyServer(r, decisions);
      if (!local || readOnly) {
        return { commit: "done", downloadError, skipped };
      }
      return { commit: await commitLocal(r, view, decideNow()), downloadError, skipped };
    }
    async function fetchIndex() {
      const { keys, readOnly, api, app } = r.ctx;
      const { state } = r;
      const known = state.server;
      const fetched = await api.getDelta(known);
      r.signal.throwIfAborted();
      if (fetched.kind === "unchanged") {
        return fetched.known;
      } else if (fetched.kind === "found") {
        const { delta, etag } = fetched;
        const payload = await decodeBody(keys, { kind: "delta", app, base: delta.base }, delta.body);
        if (payload.seq < state.seenSeq) {
          throw new SyncError(
            "server",
            `The server sent version ${payload.seq} of the folder's index, older than version ${state.seenSeq} this device already saw. Sync stopped so no change is undone. The next sync checks again.`
          );
        }
        state.setSeenSeq(payload.seq);
        if (known?.base?.id === delta.base) {
          return state.server = serverView(etag, known.base, delta.blobs, payload);
        }
        const index = await api.getIndex(delta.base);
        const base = { id: delta.base, header: index.blobs, body: await decodeBody(keys, { kind: "index", app, base: delta.base }, index.body) };
        return state.server = serverView(etag, base, delta.blobs, payload);
      }
      state.server = null;
      if (readOnly || state.synced.size === 0) {
        return { etag: null, base: null, seq: state.seenSeq, ops: {}, header: {}, body: {}, map: /* @__PURE__ */ new Map() };
      }
      await r.ctx.noticeGone();
      r.signal.throwIfAborted();
      throw new SyncError(
        "server",
        "The folder's index is missing on the server although this device synced before. Nothing was uploaded, so the folder is not rebuilt by mistake. The next sync checks again."
      );
    }
    return { round };
  }

  // src/papp/folder/scan/index.ts
  function createScanner(ctx, partSize, state, fire) {
    let rules = ignoreRules();
    let ignoreFiles = [];
    let needsFullScan = false;
    const reportedDups = /* @__PURE__ */ new Set();
    function isIgnored(path) {
      return isHard(path) || !state.isKnown(pathKey(path)) && rules.ignores(path);
    }
    async function refreshRules() {
      const candidates = new Map(ignoreFiles.map((f) => [f.dir, f.path]));
      for (const rec of state.disk.values()) {
        if (baseName(rec.path).toLowerCase() === IGNORE_FILE) {
          candidates.set(parentOf(rec.path), rec.path);
        }
      }
      const files = [];
      for (const [dir, path] of candidates) {
        const file = await readIgnoreFile(dir, path);
        if (file) {
          files.push(file);
        }
      }
      if (rulesSignature(files) === rulesSignature(ignoreFiles)) {
        return;
      }
      ignoreFiles = files;
      rules = ignoreRules(files);
      needsFullScan = true;
    }
    async function scan(root = "") {
      const rootKey = pathKey(root);
      const under = (key) => root === "" || key === rootKey || key.startsWith(rootKey + "/");
      const found = await walk(root, under);
      const before = state.disk;
      const after = new Map([...[...before].filter(([k]) => !under(k)), ...found.disk]);
      state.replaceDisk(after);
      ignoreFiles = found.ignoreFiles;
      rules = found.rules;
      reportDups(found.caseDuplicates);
      if (root === "") {
        needsFullScan = false;
      }
      const changed = [];
      for (const [k, r] of after) {
        const b = before.get(k);
        if (under(k) && (!b || b.path !== r.path || b.entry.id !== r.entry.id || b.skipped !== r.skipped)) {
          changed.push(r.path);
        }
      }
      for (const [k, r] of before) {
        if (under(k) && !after.has(k)) {
          changed.push(r.path);
        }
      }
      return changed;
    }
    async function processPaths(paths) {
      const { fs, keys } = ctx;
      const changed = [];
      const changing = [];
      let ignoreFileTouched = false;
      for (const path of paths) {
        if (isHard(path)) {
          continue;
        } else if (baseName(path).toLowerCase() === IGNORE_FILE) {
          ignoreFileTouched = true;
        }
        const key = pathKey(path);
        const rec = state.disk.get(key);
        const st = await fs.stat(path);
        if (st) {
          if (isIgnored(path)) {
            continue;
          } else if (pathProblem(path)) {
            if (!rec?.skipped) {
              state.setDisk({ path, entry: { id: "", size: 0, mtime: 0 }, skipped: "bad name" });
              changed.push(path);
            }
            continue;
          } else if (rec && rec.path === path && !rec.skipped && st.size === rec.entry.size && st.mtime === rec.entry.mtime) {
            continue;
          } else if (rec && rec.path !== path && !fs.caseInsensitive && await fs.stat(rec.path)) {
            reportDups([path]);
            continue;
          }
          const h = await hashFile(fs, keys, path, partSize);
          if (h.state === "changing") {
            changing.push(path);
            continue;
          } else if (h.state === "hashed") {
            state.setDisk({ path, entry: h.entry });
            changed.push(path);
            continue;
          }
        }
        if ((await fs.list(path)).length > 0) {
          changed.push(...await scan(path));
          continue;
        }
        for (const [k, r] of [...state.disk]) {
          if ((k === key || k.startsWith(key + "/")) && !await fs.stat(r.path)) {
            state.deleteDisk(k);
            changed.push(r.path);
          }
        }
      }
      if (ignoreFileTouched) {
        await refreshRules();
      }
      return { changed, changing };
    }
    async function walk(root, under) {
      const { fs, keys } = ctx;
      const known = /* @__PURE__ */ new Map();
      for (const [k, r] of [...state.server?.map ?? [], ...state.synced]) {
        known.set(k, r.path);
      }
      const knownDirs = dirKeysOf(known.values());
      const walkIgnoreFiles = ignoreFiles.filter((f) => !under(pathKey(f.dir)));
      let walkRules = ignoreRules(walkIgnoreFiles);
      const found = [];
      const visit = async (dir) => {
        const entries = await fs.list(dir);
        const ignoreFile = entries.find((e) => !e.dir && e.name.toLowerCase() === IGNORE_FILE);
        const file = ignoreFile && await readIgnoreFile(dir, joinPath(dir, ignoreFile.name));
        if (file) {
          walkIgnoreFiles.push(file);
          walkRules = ignoreRules(walkIgnoreFiles);
        }
        for (const e of entries) {
          const path = joinPath(dir, e.name);
          if (e.dir && e.name.toLowerCase() === HIDDEN_DIR) {
            if (dir !== "" && fs.kind === "visible") {
              throw new SyncError(
                "folder-taken",
                `"${path}" is another app's hidden folder, so another app's folder is inside this one. Two apps cannot sync the same files. Open a folder that does not contain "${dir}", or move that folder out.`
              );
            }
            continue;
          } else if (isHard(path) || !(e.dir ? knownDirs : known).has(pathKey(path)) && walkRules.ignores(path, e.dir)) {
            continue;
          } else if (e.dir) {
            await visit(path);
            continue;
          } else if (pathProblem(path)) {
            found.push({ path, entry: { id: "", size: 0, mtime: 0 }, skipped: "bad name" });
            continue;
          }
          const prev = state.disk.get(pathKey(path));
          const st = await fs.stat(path);
          if (!st) {
            continue;
          } else if (prev && !prev.skipped && prev.path === path && st.size === prev.entry.size && st.mtime === prev.entry.mtime) {
            found.push(prev);
            continue;
          }
          const h = await hashFile(fs, keys, path, partSize);
          if (h.state === "changing") {
            if (prev) {
              found.push(prev);
            }
          } else if (h.state === "hashed") {
            found.push({ path, entry: h.entry });
          }
        }
      };
      await visit(root);
      const disk = /* @__PURE__ */ new Map();
      const caseDuplicates = [];
      for (const rec of found) {
        const key = pathKey(rec.path);
        const had = disk.get(key);
        if (!had) {
          disk.set(key, rec);
        } else if (rec.path === known.get(key)) {
          disk.set(key, rec);
          caseDuplicates.push(had.path);
        } else {
          caseDuplicates.push(rec.path);
        }
      }
      for (const key of dirKeysOf(disk.keys())) {
        const rec = disk.get(key);
        if (rec) {
          disk.delete(key);
          caseDuplicates.push(rec.path);
        }
      }
      return { disk, ignoreFiles: walkIgnoreFiles, rules: walkRules, caseDuplicates };
    }
    async function readIgnoreFile(dir, path) {
      const st = await ctx.fs.stat(path);
      return st && { dir, path, content: fromUtf8.decode(await readAll(ctx.fs, path, st.size, partSize)) };
    }
    function reportDups(paths) {
      for (const p of paths) {
        if (reportedDups.has(p)) {
          continue;
        }
        reportedDups.add(p);
        fire({ path: p, origin: "case-duplicate" });
      }
    }
    return {
      watcherSkipGlobs: () => rules.watcherSkipGlobs(),
      get needsFullScan() {
        return needsFullScan;
      },
      isIgnored,
      refreshRules,
      scan,
      processPaths
    };
  }
  function rulesSignature(files) {
    return JSON.stringify([...files].sort((a, b) => a.dir < b.dir ? -1 : 1).map((f) => [f.dir, f.content]));
  }

  // src/papp/folder/debounce.ts
  function createDebounce(quietMs, maxWaitMs, fire) {
    let first = null;
    let timer = void 0;
    function poke() {
      const now = Date.now();
      first ??= now;
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          first = null;
          fire();
        },
        Math.max(0, Math.min(quietMs, first + maxWaitMs - now))
      );
    }
    function reset() {
      clearTimeout(timer);
      first = null;
    }
    return {
      get waiting() {
        return first !== null;
      },
      poke,
      reset,
      cancel: () => clearTimeout(timer)
    };
  }

  // src/papp/folder/scheduler.ts
  function createScheduler(d) {
    const { ctx, tuning, state, scanner, engine, status, isLeading, signal } = d;
    let mutex2 = Promise.resolve();
    let queued = null;
    let updateNeeded = null;
    let saveTimer = void 0;
    let retryTimer = void 0;
    let stopIndexWatch = void 0;
    let stopDiskWatch = void 0;
    let offBackground = void 0;
    let diskWatchSkipGlobs = "";
    const diskChanges = /* @__PURE__ */ new Set();
    const localQuiet = createDebounce(tuning.quietMs, tuning.maxWaitMs, () => void request2(true));
    const diskQuiet = createDebounce(tuning.watchQuietMs, tuning.watchMaxMs, () => {
      const paths = [...diskChanges];
      diskChanges.clear();
      lookAt(paths);
    });
    function exclusive(fn) {
      const run2 = mutex2.then(() => signal.aborted ? null : fn());
      mutex2 = run2.catch((e) => status.setError(e));
      return run2;
    }
    function request2(local) {
      if (updateNeeded) {
        return Promise.resolve(updateNeeded);
      } else if (signal.aborted || !isLeading()) {
        return Promise.resolve(null);
      } else if (queued) {
        queued.local ||= local;
        return queued.done;
      }
      const round = {
        local,
        done: exclusive(() => {
          queued = null;
          return run(round.local);
        })
      };
      queued = round;
      return round.done;
    }
    async function run(local) {
      if (updateNeeded) {
        return updateNeeded;
      }
      status.roundStarted();
      const outcome = await engine.round(local).catch((e) => e);
      if (outcome === "stopped") {
        return null;
      } else if (outcome instanceof SyncError && outcome.code === "update-needed") {
        updateNeeded = outcome;
      } else if (outcome instanceof SyncError && outcome.code === "rate-limited") {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void request2(true), outcome.retryAfter * 1e3);
        retryTimer.unref?.();
      }
      status.roundEnded(outcome);
      if (!signal.aborted) {
        await restartDiskWatchIfRulesChanged();
      }
      return outcome instanceof Error ? outcome : null;
    }
    function flush() {
      localQuiet.reset();
      return request2(true);
    }
    async function start2() {
      await watchDisk();
      stopIndexWatch = ctx.api.watchIndex(() => void request2(!localQuiet.waiting));
      offBackground = ctx.syncOnBackground ? ctx.platform.onBackground?.(flush) : void 0;
    }
    async function watchDisk() {
      if (!ctx.fs.watch) {
        return;
      }
      const skipGlobs = scanner.watcherSkipGlobs();
      diskWatchSkipGlobs = JSON.stringify(skipGlobs);
      stopDiskWatch = await ctx.fs.watch(
        skipGlobs,
        (paths) => {
          for (const p of paths) {
            diskChanges.add(p);
          }
          diskQuiet.poke();
        },
        rescan
      );
    }
    async function restartDiskWatchIfRulesChanged() {
      const stopping = stopDiskWatch;
      if (!stopping || JSON.stringify(scanner.watcherSkipGlobs()) === diskWatchSkipGlobs) {
        return;
      }
      stopDiskWatch = void 0;
      await stopping();
      await watchDisk();
    }
    function localChanged(paths) {
      const shown = paths.filter((p) => !scanner.isIgnored(p));
      if (shown.length === 0) {
        return;
      }
      for (const p of shown) {
        status.fire({ path: p, origin: "local" });
      }
      localQuiet.poke();
      saveTimer ??= setTimeout(() => {
        saveTimer = void 0;
        if (!signal.aborted) {
          state.flush().catch((e) => status.setError(e));
        }
      }, 1e3);
      status.scheduleRefresh();
    }
    function lookAt(paths) {
      void exclusive(async () => {
        const { changed, changing } = await scanner.processPaths(paths);
        localChanged(changed);
        for (const p of changing) {
          diskChanges.add(p);
        }
        if (changing.length > 0) {
          diskQuiet.poke();
        }
      });
    }
    function rescan() {
      void exclusive(async () => localChanged(await scanner.scan()));
    }
    async function stop() {
      stopIndexWatch?.();
      stopIndexWatch = void 0;
      offBackground?.();
      offBackground = void 0;
      localQuiet.cancel();
      diskQuiet.cancel();
      clearTimeout(saveTimer);
      clearTimeout(retryTimer);
      const stopping = stopDiskWatch;
      stopDiskWatch = void 0;
      await stopping?.();
    }
    return { request: request2, flush, start: start2, stop, localChanged, lookAt, rescan, idle: () => mutex2 };
  }

  // src/papp/folder/status.ts
  function createStatus(d) {
    let live = { syncing: false, lastSync: null, pending: 0, skipped: [], deleted: null, error: null };
    let refreshTimer = void 0;
    const changeListeners = /* @__PURE__ */ new Set();
    const statusListeners = /* @__PURE__ */ new Set();
    function snapshot() {
      return { ...live, skipped: [...live.skipped] };
    }
    function notify() {
      const s = snapshot();
      for (const cb of statusListeners) {
        callApp(() => cb(s));
      }
      d.broadcast({ type: "status", status: s });
    }
    function replace(s) {
      live = s;
      notify();
    }
    function setError(e) {
      if (d.signal.aborted) {
        return;
      }
      live.error = e.message;
      notify();
    }
    function stopFailed(e) {
      live.error = e.message;
      notify();
    }
    function refresh() {
      const { disk, synced } = d.state;
      const frozen = new Set(live.skipped.map(pathKey));
      const changedHere = [...disk].filter(([key, rec]) => {
        const was = synced.get(key);
        return !rec.skipped && !frozen.has(key) && (!was || !sameVersion(was, rec));
      });
      const removedHere = [...synced.keys()].filter((key) => !disk.has(key) && !frozen.has(key));
      live.pending = d.readOnly ? 0 : changedHere.length + removedHere.length;
      notify();
    }
    function roundStarted() {
      live.syncing = true;
      notify();
    }
    function roundEnded(outcome) {
      if (d.signal.aborted) {
        return;
      } else if (outcome instanceof Error) {
        live.error = outcome.message;
      } else {
        live.lastSync = Date.now();
        live.error = outcome.downloadError === null ? null : outcome.downloadError.message;
        live.skipped = outcome.skipped;
      }
      live.syncing = false;
      refresh();
    }
    function markDeleted(reason) {
      live.deleted = reason;
      live.syncing = false;
      live.pending = 0;
    }
    function scheduleRefresh() {
      refreshTimer ??= setTimeout(() => {
        refreshTimer = void 0;
        if (!d.signal.aborted) {
          refresh();
        }
      }, 20);
    }
    function fire(change) {
      deliver(change);
      d.broadcast({ type: "change", change });
    }
    function deliver(change) {
      for (const cb of changeListeners) {
        callApp(() => cb({ ...change }));
      }
    }
    function watch(cb) {
      changeListeners.add(cb);
      return () => void changeListeners.delete(cb);
    }
    function onStatus(cb) {
      statusListeners.add(cb);
      return () => void statusListeners.delete(cb);
    }
    return {
      get live() {
        return live;
      },
      snapshot,
      notify,
      replace,
      setError,
      stopFailed,
      refresh,
      roundStarted,
      roundEnded,
      markDeleted,
      scheduleRefresh,
      fire,
      deliver,
      watch,
      onStatus
    };
  }
  function callApp(fn) {
    try {
      fn();
    } catch (e) {
      console.error("pappdrive: a watch or onStatus callback threw:", e);
    }
  }

  // src/papp/folder/tabs.ts
  var OWN_WRITE_ECHO_MS = 1e4;
  function createTabs(ctx, signal) {
    let coord = void 0;
    const recentWrites = /* @__PURE__ */ new Map();
    const tabs = {
      leading: false,
      get shared() {
        return coord !== void 0;
      },
      start: start2,
      post,
      tellLeader,
      askLeaderToSync,
      close
    };
    async function start2(hooks) {
      const coordinator = ctx.platform.coordinator?.(`${ctx.app}${ctx.readOnly ? ":read" : ""}`);
      if (!coordinator) {
        return hooks.lead();
      }
      coord = coordinator;
      coordinator.onMessage((m) => {
        if (signal.aborted) {
          return;
        } else if (tabs.leading) {
          if (m.type === "local-change") {
            hooks.followerChanged(m.paths);
          }
        } else if (m.type === "change") {
          const wrote = recentWrites.get(m.change.path);
          if (m.change.origin !== "local" || wrote === void 0 || Date.now() - wrote >= OWN_WRITE_ECHO_MS) {
            hooks.deliver(m.change);
          }
        } else if (m.type === "status") {
          hooks.setStatus(m.status);
        }
      });
      const granted = coordinator.waitForLead().then(() => true);
      const now = await Promise.race([granted, new Promise((r) => setTimeout(() => r(false), 50))]);
      if (now || coordinator.isLeader()) {
        return hooks.lead();
      }
      void granted.then(() => {
        if (!signal.aborted) {
          hooks.lead().catch(hooks.onError);
        }
      });
    }
    function post(msg) {
      if (tabs.leading) {
        coord?.post(msg);
      }
    }
    function tellLeader(path) {
      recentWrites.set(path, Date.now());
      coord?.post({ type: "local-change", paths: [path] });
    }
    async function askLeaderToSync() {
      const leader = coord;
      if (!leader) {
        return;
      }
      await new Promise((resolve) => {
        let sawSyncing = false;
        const timer = setTimeout(done, 3e4);
        const off = leader.onMessage((m) => {
          if (m.type !== "status") {
            return;
          } else if (m.status.syncing) {
            sawSyncing = true;
          } else if (sawSyncing) {
            done();
          }
        });
        function done() {
          clearTimeout(timer);
          off();
          resolve();
        }
        leader.post({ type: "local-change", paths: [] });
      });
    }
    function close() {
      coord?.close();
    }
    return tabs;
  }

  // src/papp/folder/index.ts
  function openFolder(ctx, tuningOverrides) {
    const tuning = { partSize: PART_SIZE, quietMs: 2e3, maxWaitMs: 1e4, watchQuietMs: 2e3, watchMaxMs: 1e4, ...tuningOverrides };
    const { partSize } = tuning;
    const stop = new AbortController();
    const { signal } = stop;
    const withLock = createPathLocks();
    const state = createLocalState(ctx.fs);
    const tabs = createTabs(ctx, signal);
    const status = createStatus({ readOnly: ctx.readOnly, state, broadcast: tabs.post, signal });
    const scanner = createScanner(ctx, partSize, state, status.fire);
    const engine = createSyncEngine({ ctx, partSize, state, scanner, withLock, fire: status.fire, signal });
    const scheduler = createScheduler({ ctx, tuning, state, scanner, engine, status, isLeading: () => tabs.leading, signal });
    const { removeCrashedWriteTemps, ...files } = createFiles({
      ctx,
      partSize,
      state,
      scanner,
      withLock,
      isLeading: () => tabs.leading,
      assertOpen,
      changedHere: (path) => {
        if (tabs.leading) {
          scheduler.localChanged([path]);
        } else {
          status.deliver({ path, origin: "local" });
          tabs.tellLeader(path);
        }
      }
    });
    async function becomeLeader() {
      const { fs, app } = ctx;
      const owner = await fs.loadState("app");
      if (owner !== null && owner !== app) {
        throw new SyncError(
          "folder-taken",
          `This folder belongs to the app "${owner}". Two apps cannot sync the same files. Open another folder for "${app}", or open "${owner}"'s folder read-only with papp.openReadOnly("${owner}").`
        );
      }
      await state.load();
      if (!tabs.shared) {
        await removeCrashedWriteTemps();
      }
      await scanner.scan();
      if (owner === null) {
        await fs.saveState("app", app);
      }
      await state.flush();
      if (signal.aborted) {
        return;
      }
      tabs.leading = true;
      status.refresh();
      await scheduler.start();
      void scheduler.request(true);
    }
    function follow(received) {
      status.replace(received);
      if (received.deleted !== null) {
        stop.abort();
      }
    }
    async function sync() {
      if (status.live.deleted) {
        return;
      }
      assertOpen();
      if (!tabs.leading) {
        return tabs.askLeaderToSync();
      }
      const failure = await scheduler.flush();
      if (failure) {
        throw failure;
      }
    }
    async function close() {
      if (signal.aborted) {
        return;
      }
      stop.abort();
      try {
        await scheduler.stop();
        await scheduler.idle();
        if (tabs.leading) {
          await state.flush();
        }
      } finally {
        tabs.close();
      }
    }
    async function markDeleted(reason) {
      if (signal.aborted) {
        return;
      }
      stop.abort();
      status.markDeleted(reason);
      try {
        await scheduler.stop();
        await ctx.fs.destroy();
      } finally {
        status.notify();
        tabs.close();
      }
    }
    function assertOpen() {
      if (status.live.deleted) {
        throw goneError(status.live.deleted);
      } else if (signal.aborted) {
        throw new SyncError("signed-out", "This folder was closed (sign-out or close). Sign in and open it again with papp.open().");
      }
    }
    return {
      readOnly: ctx.readOnly,
      get status() {
        return status.snapshot();
      },
      start: () => tabs.start({
        lead: becomeLeader,
        onError: status.setError,
        deliver: status.deliver,
        setStatus: follow,
        followerChanged: (paths) => paths.length === 0 ? void scheduler.flush() : scheduler.lookAt(paths)
      }),
      close,
      markDeleted,
      stopFailed: status.stopFailed,
      watch: status.watch,
      onStatus: status.onStatus,
      sync,
      ...files
    };
  }

  // src/papp/open-folders.ts
  var OWN_FOLDER_KEY = "";
  function createOpenFolders(api, platform, syncOnBackground) {
    const folders = /* @__PURE__ */ new Map();
    async function open(dataKey, app, readOnly, openFs) {
      const key = readOnly ? app : OWN_FOLDER_KEY;
      let opening = folders.get(key);
      if (!opening) {
        opening = (async () => {
          const folder2 = openFolder({
            app,
            readOnly,
            fs: await openFs(),
            keys: await dataKeys(fromBase64(dataKey)),
            api: api.folderApi(app, readOnly),
            platform,
            syncOnBackground,
            noticeGone: () => api.refresh().then(
              () => void 0,
              (e) => {
                if (!(e instanceof SyncError && e.code === "gone")) {
                  throw e;
                }
              }
            )
          });
          await folder2.start().catch(async (e) => {
            await folder2.close();
            throw e;
          });
          return folder2;
        })();
        folders.set(key, opening);
        opening.catch(() => {
          if (folders.get(key) === opening) {
            folders.delete(key);
          }
        });
      }
      const folder = await opening;
      const stoppedWhileOpening = folders.get(key) !== opening;
      if (stoppedWhileOpening) {
        throw signedOut();
      }
      return folder;
    }
    async function stopAll(stop) {
      const openings = [...folders.values()];
      folders.clear();
      const opened = (await Promise.allSettled(openings)).flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
      const results = await Promise.allSettled(opened.map(stop));
      const failures = results.flatMap((r) => r.status === "rejected" ? [r.reason] : []);
      if (failures.length > 0) {
        throw new AggregateError(failures, "A folder did not stop cleanly.");
      }
    }
    return { open, stopAll };
  }

  // src/papp/session.ts
  function createSession(keyStore, keyName, api, platform) {
    let current = null;
    async function restore() {
      const raw = await keyStore.get(keyName);
      if (!raw) {
        return;
      }
      current = JSON.parse(raw);
      api.setSession(current.refreshToken, null);
    }
    async function save(email, res, dataKey, recoveryCode) {
      const saved = { email, userId: decodeJwt(res.accessToken).sub, refreshToken: res.refreshToken, dataKey: toBase64(dataKey), recoveryCode };
      await keyStore.set(keyName, JSON.stringify(saved));
      current = saved;
      api.setSession(res.refreshToken, res.accessToken);
      await platform.persist?.();
    }
    async function confirmRecoveryCode() {
      if (!current) {
        throw signedOut();
      }
      const confirmed2 = { ...current, recoveryCode: null };
      await keyStore.set(keyName, JSON.stringify(confirmed2));
      current = confirmed2;
    }
    function confirmed() {
      if (!current) {
        throw signedOut();
      } else if (current.recoveryCode !== null) {
        throw new SyncError(
          "signed-out",
          "The recovery code is not confirmed yet. Show the code from papp.pendingSignUp() and call papp.confirmRecoveryCode() once the user saved it."
        );
      }
      return current;
    }
    async function clear() {
      current = null;
      api.clear();
      await keyStore.delete(keyName);
    }
    return {
      get current() {
        return current;
      },
      restore,
      save,
      confirmRecoveryCode,
      confirmed,
      clear
    };
  }

  // src/papp/index.ts
  function createPappCore(opts, platform, keyStore) {
    const { app } = opts;
    const server = opts.server.replace(/\/+$/, "");
    const read = opts.read ?? [];
    const bad = [app, ...read].find((n) => !APP_NAME_RE.test(n));
    if (bad !== void 0) {
      throw new SyncError("no-app", `"${bad}" is not a valid app name. App names are lowercase letters, digits and -, 1 to 64 characters.`);
    }
    let own = null;
    const api = createApi(server, read, {
      onGone: async (reason) => {
        void folders.stopAll((f) => f.markDeleted(reason).catch(f.stopFailed));
        await session.clear();
      },
      onSignedOut: async () => {
        own = null;
        void folders.stopAll((f) => f.close().catch(f.stopFailed));
        await session.clear();
      }
    });
    const session = createSession(keyStore, `pappdrive:${server}:${app}`, api, platform);
    const folders = createOpenFolders(api, platform, opts.syncOnBackground);
    const ready = session.restore();
    async function signUp(email, password) {
      await ready;
      checkPassword(password);
      if (session.current) {
        await signOut();
      }
      const address = normalizeEmail(email);
      const { signup, dataKey, recoveryCode } = await onServer("/auth/signup", () => prepareSignUp(server, platform.argon2, address, password, { app, read }));
      const tokens = await onServer("/auth/signup", () => request(server, "POST", "/auth/signup", signup));
      await session.save(address, tokens, dataKey, recoveryCode);
      return { recoveryCode };
    }
    async function pendingSignUp() {
      await ready;
      const s = session.current;
      return s && s.recoveryCode !== null ? { email: s.email, recoveryCode: s.recoveryCode } : null;
    }
    async function confirmRecoveryCode() {
      await ready;
      await session.confirmRecoveryCode();
    }
    async function verifyEmail(code) {
      await ready;
      await onServer("/auth/verify", () => api.authed((token) => request(server, "POST", "/auth/verify", { code }, token)));
    }
    async function sendVerificationEmail() {
      await ready;
      await onServer("/auth/verify/send", () => api.authed((token) => request(server, "POST", "/auth/verify/send", void 0, token)));
    }
    async function signIn(email, password) {
      await ready;
      if (session.current) {
        await signOut();
      }
      const address = normalizeEmail(email);
      const res = await onServer("/auth/login", () => logInWithPassword(server, platform.argon2, address, password, { app, read }));
      await session.save(address, res, res.dataKey, null);
    }
    async function recover(email, recoveryCode, newPassword) {
      await ready;
      checkPassword(newPassword);
      const code = parseRecoveryCode(recoveryCode);
      if (session.current) {
        await signOut();
      }
      const address = normalizeEmail(email);
      const res = await onServer("/auth/recover", () => logInWithRecoveryCode(server, address, code, { app, read }));
      await session.save(address, res, res.dataKey, null);
      await setPassword(newPassword);
    }
    async function setPassword(newPassword) {
      await ready;
      checkPassword(newPassword);
      const s = session.confirmed();
      const pk = await deriveFromPassword(platform.argon2, s.email, newPassword, DEFAULT_ARGON2);
      const req = { loginKey: toBase64(pk.loginKey), passwordCopy: await lockDataKey(fromBase64(s.dataKey), pk.passwordKey), params: DEFAULT_ARGON2 };
      await onServer("/auth/password", () => api.authed((token) => request(server, "POST", "/auth/password", req, token)));
    }
    async function signOut() {
      await ready;
      if (session.current) {
        await api.authed((token) => request(server, "POST", "/auth/logout", void 0, token)).catch(
          (e) => console.warn(`pappdrive: signed out on this device, but the server was not told (${String(e)}). The sign-in stops working there once the account's password changes.`)
        );
      }
      own = null;
      await Promise.all([folders.stopAll((f) => f.close()), session.clear()]);
    }
    async function deleteWith(password, reason) {
      await ready;
      const { email } = session.confirmed();
      if (reason === "app") {
        await onServer("/app/delete", () => deleteAppWithPassword(server, platform.argon2, email, password, app));
      } else {
        await onServer("/account/delete", () => deleteAccountWithPassword(server, platform.argon2, email, password));
      }
      await Promise.all([folders.stopAll((f) => f.markDeleted(reason)), session.clear()]);
    }
    async function close() {
      own = null;
      await folders.stopAll((f) => f.sync().finally(() => f.close()));
    }
    async function open(where) {
      await ready;
      const s = session.confirmed();
      own = await folders.open(s.dataKey, app, false, () => where.mode === "visible" ? platform.openVisible(where.path) : platform.openPrivate(s.userId, app));
      return own;
    }
    async function openReadOnly(other) {
      await ready;
      if (!read.includes(other)) {
        throw new SyncError(
          "not-allowed",
          `"${other}" is not in read. Add it to read in createPapp({ ..., read: [${[...read, other].map((n) => `"${n}"`).join(", ")}] }). The next token refresh sends it, no new sign-in needed.`
        );
      }
      const s = session.confirmed();
      return folders.open(s.dataKey, other, true, () => platform.openPrivate(s.userId, app, other));
    }
    async function onServer(path, call) {
      try {
        return await call();
      } catch (e) {
        if (!(e instanceof ApiError)) {
          throw e;
        }
        throw serverError(e, { path, server, app, read });
      }
    }
    return {
      ready,
      get signedIn() {
        return session.current !== null && session.current.recoveryCode === null;
      },
      get files() {
        if (!own) {
          throw new SyncError("signed-out", 'papp.files is ready only after open. Call await papp.open({ mode: "private" }) or await papp.open({ mode: "visible", path }) first.');
        }
        return own;
      },
      open,
      openReadOnly,
      signUp,
      pendingSignUp,
      confirmRecoveryCode,
      verifyEmail,
      sendVerificationEmail,
      signIn,
      recover,
      setPassword,
      signOut,
      deleteApp: (password) => deleteWith(password, "app"),
      deleteAccount: (password) => deleteWith(password, "account"),
      close
    };
  }
  function checkPassword(password) {
    if ([...password.normalize("NFC")].length < MIN_PASSWORD_LENGTH) {
      throw new SyncError("weak-password", `The password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters; a few random words work well.`);
    }
  }

  // src/rpc/errors.ts
  var RpcError = class extends Error {
    code;
    retryAfter;
    reason;
    constructor(body) {
      super(body.message);
      this.name = "RpcError";
      this.code = body.code;
      this.retryAfter = body.retryAfter;
      this.reason = body.reason;
    }
  };

  // src/rpc/channel.ts
  function createChannel(transport) {
    const handlers = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Map();
    let nextId2 = 1;
    const send3 = (msg) => transport.send(JSON.stringify(msg));
    transport.onMessage((text) => {
      const msg = JSON.parse(text);
      if ("method" in msg) {
        const { id, method, params } = msg;
        const handler = handlers.get(method);
        if (id === void 0) {
          handler?.(params);
          return;
        }
        void Promise.resolve().then(() => {
          if (!handler) {
            throw new RpcError({ code: "bad-request", message: `bad-request: Unknown method "${method}".` });
          }
          return handler(params);
        }).then(
          // JSON.stringify drops undefined; the envelope says null.
          (value) => send3({ id, ok: true, value: value === void 0 ? null : value }),
          (e) => send3({
            id,
            ok: false,
            error: e instanceof SyncError || e instanceof RpcError ? { code: e.code, message: e.message, retryAfter: e.retryAfter, reason: e.reason } : { code: "internal", message: String(e) }
          })
        );
        return;
      }
      const waiting2 = pending.get(msg.id);
      if (!waiting2) {
        return;
      }
      pending.delete(msg.id);
      if (msg.ok) {
        waiting2.resolve(msg.value);
      } else {
        waiting2.reject(new RpcError(msg.error));
      }
    });
    return {
      request(method, params) {
        const id = nextId2++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          send3({ id, method, params });
        });
      },
      notify(method, params) {
        send3({ method, params });
      },
      on(incoming) {
        for (const [method, handler] of Object.entries(incoming)) {
          handlers.set(method, handler);
        }
      }
    };
  }

  // src/rpc/host-keystore.ts
  function hostKeyStore(channel) {
    return {
      get: (name) => channel.request("host.keystore.get", { name }),
      set: (name, value) => channel.request("host.keystore.set", { name, value }),
      delete: (name) => channel.request("host.keystore.delete", { name })
    };
  }

  // src/rpc/serve.ts
  function serve(papp, channel) {
    const folders = /* @__PURE__ */ new Map();
    const reads = /* @__PURE__ */ new Map();
    const writes = /* @__PURE__ */ new Map();
    let nextTransfer = 1;
    async function track(handle, opening) {
      const entry = { files: opening, stop: () => {
      } };
      folders.get(handle)?.stop();
      folders.set(handle, entry);
      const folder = await opening;
      if (folders.get(handle) === entry) {
        const stopWatch = folder.watch((change) => channel.notify("change", { files: handle, change }));
        const stopStatus = folder.onStatus((status) => channel.notify("status", { files: handle, status }));
        entry.stop = () => {
          stopWatch();
          stopStatus();
        };
      }
      return handle;
    }
    function forget() {
      for (const { stop } of folders.values()) {
        stop();
      }
      folders.clear();
    }
    function files(handle) {
      const entry = folders.get(handle);
      if (!entry) {
        throw new RpcError({ code: "bad-request", message: `bad-request: No open folder "${handle}". Call open or openReadOnly first.` });
      }
      return entry.files;
    }
    function transfer(transfers, id) {
      const found = transfers.get(id);
      if (!found) {
        throw new RpcError({ code: "bad-request", message: `bad-request: No open transfer ${id}. It ended, failed or was cancelled.` });
      }
      return found;
    }
    const handlers = {
      signedIn: async () => {
        await papp.ready;
        return papp.signedIn;
      },
      open: ({ where }) => track("own", papp.open(where)),
      openReadOnly: ({ app }) => track(`read:${app}`, papp.openReadOnly(app)),
      signUp: ({ email, password }) => papp.signUp(email, password),
      pendingSignUp: () => papp.pendingSignUp(),
      confirmRecoveryCode: () => papp.confirmRecoveryCode(),
      verifyEmail: ({ code }) => papp.verifyEmail(code),
      sendVerificationEmail: () => papp.sendVerificationEmail(),
      signIn: ({ email, password }) => papp.signIn(email, password),
      recover: ({ email, recoveryCode, newPassword }) => papp.recover(email, recoveryCode, newPassword),
      setPassword: ({ newPassword }) => papp.setPassword(newPassword),
      signOut: () => papp.signOut().finally(forget),
      deleteApp: async ({ password }) => {
        await papp.deleteApp(password);
        forget();
      },
      deleteAccount: async ({ password }) => {
        await papp.deleteAccount(password);
        forget();
      },
      close: () => papp.close().finally(forget),
      "files.readOnly": async (p) => (await files(p.files)).readOnly,
      "files.writeText": async (p) => (await files(p.files)).write(p.path, p.text),
      "files.writeStart": async (p) => {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const written = (await files(p.files)).write(p.path, readable);
        written.catch((e) => writer.abort(e));
        const id = nextTransfer++;
        writes.set(id, { writer, written });
        return id;
      },
      "files.writeChunk": async ({ id, base64 }) => {
        const write = transfer(writes, id);
        writes.delete(id);
        await write.writer.write(fromBase64(base64));
        writes.set(id, write);
      },
      "files.writeEnd": async ({ id }) => {
        const { writer, written } = transfer(writes, id);
        writes.delete(id);
        await writer.close();
        await written;
      },
      "files.readStart": async (p) => {
        const reader = (await files(p.files)).readStream(p.path).getReader();
        const id = nextTransfer++;
        reads.set(id, reader);
        return id;
      },
      "files.readChunk": async ({ id }) => {
        const reader = transfer(reads, id);
        reads.delete(id);
        const next = await reader.read();
        if (next.done) {
          return null;
        }
        reads.set(id, reader);
        return toBase64(next.value);
      },
      "files.cancel": async ({ id }) => {
        const reader = reads.get(id);
        const write = writes.get(id);
        reads.delete(id);
        writes.delete(id);
        await reader?.cancel();
        await write?.writer.abort();
      },
      "files.readText": async (p) => (await files(p.files)).readText(p.path),
      "files.list": async (p) => (await files(p.files)).list(p.dir),
      "files.remove": async (p) => (await files(p.files)).remove(p.path),
      "files.status": async (p) => (await files(p.files)).status,
      "files.sync": async (p) => (await files(p.files)).sync()
    };
    channel.on(handlers);
  }

  // ../../node_modules/.pnpm/hash-wasm@4.12.0/node_modules/hash-wasm/dist/index.esm.js
  function __awaiter(thisArg, _arguments, P, generator) {
    function adopt2(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt2(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  }
  var Mutex = class {
    constructor() {
      this.mutex = Promise.resolve();
    }
    lock() {
      let begin = () => {
      };
      this.mutex = this.mutex.then(() => new Promise(begin));
      return new Promise((res) => {
        begin = res;
      });
    }
    dispatch(fn) {
      return __awaiter(this, void 0, void 0, function* () {
        const unlock = yield this.lock();
        try {
          return yield Promise.resolve(fn());
        } finally {
          unlock();
        }
      });
    }
  };
  var _a2;
  function getGlobal() {
    if (typeof globalThis !== "undefined")
      return globalThis;
    if (typeof self !== "undefined")
      return self;
    if (typeof window !== "undefined")
      return window;
    return global;
  }
  var globalObject = getGlobal();
  var nodeBuffer = (_a2 = globalObject.Buffer) !== null && _a2 !== void 0 ? _a2 : null;
  var textEncoder = globalObject.TextEncoder ? new globalObject.TextEncoder() : null;
  function hexCharCodesToInt(a, b) {
    return (a & 15) + (a >> 6 | a >> 3 & 8) << 4 | (b & 15) + (b >> 6 | b >> 3 & 8);
  }
  function writeHexToUInt8(buf, str) {
    const size = str.length >> 1;
    for (let i = 0; i < size; i++) {
      const index = i << 1;
      buf[i] = hexCharCodesToInt(str.charCodeAt(index), str.charCodeAt(index + 1));
    }
  }
  function hexStringEqualsUInt8(str, buf) {
    if (str.length !== buf.length * 2) {
      return false;
    }
    for (let i = 0; i < buf.length; i++) {
      const strIndex = i << 1;
      if (buf[i] !== hexCharCodesToInt(str.charCodeAt(strIndex), str.charCodeAt(strIndex + 1))) {
        return false;
      }
    }
    return true;
  }
  var alpha = "a".charCodeAt(0) - 10;
  var digit = "0".charCodeAt(0);
  function getDigestHex(tmpBuffer, input, hashLength) {
    let p = 0;
    for (let i = 0; i < hashLength; i++) {
      let nibble = input[i] >>> 4;
      tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
      nibble = input[i] & 15;
      tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
    }
    return String.fromCharCode.apply(null, tmpBuffer);
  }
  var getUInt8Buffer = nodeBuffer !== null ? (data) => {
    if (typeof data === "string") {
      const buf = nodeBuffer.from(data, "utf8");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
    if (nodeBuffer.isBuffer(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.length);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Invalid data type!");
  } : (data) => {
    if (typeof data === "string") {
      return textEncoder.encode(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Invalid data type!");
  };
  var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var base64Lookup = new Uint8Array(256);
  for (let i = 0; i < base64Chars.length; i++) {
    base64Lookup[base64Chars.charCodeAt(i)] = i;
  }
  function encodeBase64(data, pad = true) {
    const len = data.length;
    const extraBytes = len % 3;
    const parts = [];
    const len2 = len - extraBytes;
    for (let i = 0; i < len2; i += 3) {
      const tmp = (data[i] << 16 & 16711680) + (data[i + 1] << 8 & 65280) + (data[i + 2] & 255);
      const triplet = base64Chars.charAt(tmp >> 18 & 63) + base64Chars.charAt(tmp >> 12 & 63) + base64Chars.charAt(tmp >> 6 & 63) + base64Chars.charAt(tmp & 63);
      parts.push(triplet);
    }
    if (extraBytes === 1) {
      const tmp = data[len - 1];
      const a = base64Chars.charAt(tmp >> 2);
      const b = base64Chars.charAt(tmp << 4 & 63);
      parts.push(`${a}${b}`);
      if (pad) {
        parts.push("==");
      }
    } else if (extraBytes === 2) {
      const tmp = (data[len - 2] << 8) + data[len - 1];
      const a = base64Chars.charAt(tmp >> 10);
      const b = base64Chars.charAt(tmp >> 4 & 63);
      const c = base64Chars.charAt(tmp << 2 & 63);
      parts.push(`${a}${b}${c}`);
      if (pad) {
        parts.push("=");
      }
    }
    return parts.join("");
  }
  function getDecodeBase64Length(data) {
    let bufferLength = Math.floor(data.length * 0.75);
    const len = data.length;
    if (data[len - 1] === "=") {
      bufferLength -= 1;
      if (data[len - 2] === "=") {
        bufferLength -= 1;
      }
    }
    return bufferLength;
  }
  function decodeBase64(data) {
    const bufferLength = getDecodeBase64Length(data);
    const len = data.length;
    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const encoded1 = base64Lookup[data.charCodeAt(i)];
      const encoded2 = base64Lookup[data.charCodeAt(i + 1)];
      const encoded3 = base64Lookup[data.charCodeAt(i + 2)];
      const encoded4 = base64Lookup[data.charCodeAt(i + 3)];
      bytes[p] = encoded1 << 2 | encoded2 >> 4;
      p += 1;
      bytes[p] = (encoded2 & 15) << 4 | encoded3 >> 2;
      p += 1;
      bytes[p] = (encoded3 & 3) << 6 | encoded4 & 63;
      p += 1;
    }
    return bytes;
  }
  var MAX_HEAP = 16 * 1024;
  var WASM_FUNC_HASH_LENGTH = 4;
  var wasmMutex = new Mutex();
  var wasmModuleCache = /* @__PURE__ */ new Map();
  function WASMInterface(binary, hashLength) {
    return __awaiter(this, void 0, void 0, function* () {
      let wasmInstance = null;
      let memoryView = null;
      let initialized = false;
      if (typeof WebAssembly === "undefined") {
        throw new Error("WebAssembly is not supported in this environment!");
      }
      const writeMemory = (data, offset = 0) => {
        memoryView.set(data, offset);
      };
      const getMemory = () => memoryView;
      const getExports = () => wasmInstance.exports;
      const setMemorySize = (totalSize) => {
        wasmInstance.exports.Hash_SetMemorySize(totalSize);
        const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        memoryView = new Uint8Array(memoryBuffer, arrayOffset, totalSize);
      };
      const getStateSize = () => {
        const view = new DataView(wasmInstance.exports.memory.buffer);
        const stateSize = view.getUint32(wasmInstance.exports.STATE_SIZE, true);
        return stateSize;
      };
      const loadWASMPromise = wasmMutex.dispatch(() => __awaiter(this, void 0, void 0, function* () {
        if (!wasmModuleCache.has(binary.name)) {
          const asm = decodeBase64(binary.data);
          const promise = WebAssembly.compile(asm);
          wasmModuleCache.set(binary.name, promise);
        }
        const module = yield wasmModuleCache.get(binary.name);
        wasmInstance = yield WebAssembly.instantiate(module, {
          // env: {
          //   emscripten_memcpy_big: (dest, src, num) => {
          //     const memoryBuffer = wasmInstance.exports.memory.buffer;
          //     const memView = new Uint8Array(memoryBuffer, 0);
          //     memView.set(memView.subarray(src, src + num), dest);
          //   },
          //   print_memory: (offset, len) => {
          //     const memoryBuffer = wasmInstance.exports.memory.buffer;
          //     const memView = new Uint8Array(memoryBuffer, 0);
          //     console.log('print_int32', memView.subarray(offset, offset + len));
          //   },
          // },
        });
      }));
      const setupInterface = () => __awaiter(this, void 0, void 0, function* () {
        if (!wasmInstance) {
          yield loadWASMPromise;
        }
        const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        memoryView = new Uint8Array(memoryBuffer, arrayOffset, MAX_HEAP);
      });
      const init = (bits2 = null) => {
        initialized = true;
        wasmInstance.exports.Hash_Init(bits2);
      };
      const updateUInt8Array = (data) => {
        let read = 0;
        while (read < data.length) {
          const chunk = data.subarray(read, read + MAX_HEAP);
          read += chunk.length;
          memoryView.set(chunk);
          wasmInstance.exports.Hash_Update(chunk.length);
        }
      };
      const update = (data) => {
        if (!initialized) {
          throw new Error("update() called before init()");
        }
        const Uint8Buffer = getUInt8Buffer(data);
        updateUInt8Array(Uint8Buffer);
      };
      const digestChars = new Uint8Array(hashLength * 2);
      const digest = (outputType, padding = null) => {
        if (!initialized) {
          throw new Error("digest() called before init()");
        }
        initialized = false;
        wasmInstance.exports.Hash_Final(padding);
        if (outputType === "binary") {
          return memoryView.slice(0, hashLength);
        }
        return getDigestHex(digestChars, memoryView, hashLength);
      };
      const save = () => {
        if (!initialized) {
          throw new Error("save() can only be called after init() and before digest()");
        }
        const stateOffset = wasmInstance.exports.Hash_GetState();
        const stateLength = getStateSize();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        const internalState = new Uint8Array(memoryBuffer, stateOffset, stateLength);
        const prefixedState = new Uint8Array(WASM_FUNC_HASH_LENGTH + stateLength);
        writeHexToUInt8(prefixedState, binary.hash);
        prefixedState.set(internalState, WASM_FUNC_HASH_LENGTH);
        return prefixedState;
      };
      const load = (state) => {
        if (!(state instanceof Uint8Array)) {
          throw new Error("load() expects an Uint8Array generated by save()");
        }
        const stateOffset = wasmInstance.exports.Hash_GetState();
        const stateLength = getStateSize();
        const overallLength = WASM_FUNC_HASH_LENGTH + stateLength;
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        if (state.length !== overallLength) {
          throw new Error(`Bad state length (expected ${overallLength} bytes, got ${state.length})`);
        }
        if (!hexStringEqualsUInt8(binary.hash, state.subarray(0, WASM_FUNC_HASH_LENGTH))) {
          throw new Error("This state was written by an incompatible hash implementation");
        }
        const internalState = state.subarray(WASM_FUNC_HASH_LENGTH);
        new Uint8Array(memoryBuffer, stateOffset, stateLength).set(internalState);
        initialized = true;
      };
      const isDataShort = (data) => {
        if (typeof data === "string") {
          return data.length < MAX_HEAP / 4;
        }
        return data.byteLength < MAX_HEAP;
      };
      let canSimplify = isDataShort;
      switch (binary.name) {
        case "argon2":
        case "scrypt":
          canSimplify = () => true;
          break;
        case "blake2b":
        case "blake2s":
          canSimplify = (data, initParam) => initParam <= 512 && isDataShort(data);
          break;
        case "blake3":
          canSimplify = (data, initParam) => initParam === 0 && isDataShort(data);
          break;
        case "xxhash64":
        // cannot simplify
        case "xxhash3":
        case "xxhash128":
        case "crc64":
          canSimplify = () => false;
          break;
      }
      const calculate = (data, initParam = null, digestParam = null) => {
        if (!canSimplify(data, initParam)) {
          init(initParam);
          update(data);
          return digest("hex", digestParam);
        }
        const buffer = getUInt8Buffer(data);
        memoryView.set(buffer);
        wasmInstance.exports.Hash_Calculate(buffer.length, initParam, digestParam);
        return getDigestHex(digestChars, memoryView, hashLength);
      };
      yield setupInterface();
      return {
        getMemory,
        writeMemory,
        getExports,
        setMemorySize,
        init,
        update,
        digest,
        save,
        load,
        calculate,
        hashLength
      };
    });
  }
  var mutex$l = new Mutex();
  var name$k = "argon2";
  var data$k = "AGFzbQEAAAABKQVgAX8Bf2AAAX9gEH9/f39/f39/f39/f39/f38AYAR/f39/AGACf38AAwYFAAECAwQFBgEBAoCAAgYIAX8BQZCoBAsHQQQGbWVtb3J5AgASSGFzaF9TZXRNZW1vcnlTaXplAAAOSGFzaF9HZXRCdWZmZXIAAQ5IYXNoX0NhbGN1bGF0ZQAECvEyBVgBAn9BACEBAkAgAEEAKAKICCICRg0AAkAgACACayIAQRB2IABBgIB8cSAASWoiAEAAQX9HDQBB/wHADwtBACEBQQBBACkDiAggAEEQdK18NwOICAsgAcALcAECfwJAQQAoAoAIIgANAEEAPwBBEHQiADYCgAhBACgCiAgiAUGAgCBGDQACQEGAgCAgAWsiAEEQdiAAQYCAfHEgAElqIgBAAEF/Rw0AQQAPC0EAQQApA4gIIABBEHStfDcDiAhBACgCgAghAAsgAAvcDgECfiAAIAQpAwAiECAAKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAMIBAgDCkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgBCAQIAQpAwCFQiiJIhA3AwAgACAQIAApAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAwgECAMKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAEIBAgBCkDAIVCAYk3AwAgASAFKQMAIhAgASkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDSAQIA0pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAEgECABKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACANIBAgDSkDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAIgBikDACIQIAIpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIA4gECAOKQMAhUIgiSIQNwMAIAogECAKKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACACIBAgAikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDiAQIA4pAwCFQjCJIhA3AwAgCiAQIAopAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACADIAcpAwAiECADKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAPIBAgDykDAIVCIIkiEDcDACALIBAgCykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAyAQIAMpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA8gECAPKQMAhUIwiSIQNwMAIAsgECALKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgACAFKQMAIhAgACkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDyAQIA8pAwCFQiCJIhA3AwAgCiAQIAopAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAAgECAAKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAPIBAgDykDAIVCMIkiEDcDACAKIBAgCikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAEgBikDACIQIAEpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAwgECAMKQMAhUIgiSIQNwMAIAsgECALKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACABIBAgASkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDCAQIAwpAwCFQjCJIhA3AwAgCyAQIAspAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACACIAcpAwAiECACKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACANIBAgDSkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAiAQIAIpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA0gECANKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgAyAEKQMAIhAgAykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDiAQIA4pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAQgECAEKQMAhUIoiSIQNwMAIAMgECADKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAOIBAgDikDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBCAQIAQpAwCFQgGJNwMAC98aAQN/QQAhBEEAIAIpAwAgASkDAIU3A5AIQQAgAikDCCABKQMIhTcDmAhBACACKQMQIAEpAxCFNwOgCEEAIAIpAxggASkDGIU3A6gIQQAgAikDICABKQMghTcDsAhBACACKQMoIAEpAyiFNwO4CEEAIAIpAzAgASkDMIU3A8AIQQAgAikDOCABKQM4hTcDyAhBACACKQNAIAEpA0CFNwPQCEEAIAIpA0ggASkDSIU3A9gIQQAgAikDUCABKQNQhTcD4AhBACACKQNYIAEpA1iFNwPoCEEAIAIpA2AgASkDYIU3A/AIQQAgAikDaCABKQNohTcD+AhBACACKQNwIAEpA3CFNwOACUEAIAIpA3ggASkDeIU3A4gJQQAgAikDgAEgASkDgAGFNwOQCUEAIAIpA4gBIAEpA4gBhTcDmAlBACACKQOQASABKQOQAYU3A6AJQQAgAikDmAEgASkDmAGFNwOoCUEAIAIpA6ABIAEpA6ABhTcDsAlBACACKQOoASABKQOoAYU3A7gJQQAgAikDsAEgASkDsAGFNwPACUEAIAIpA7gBIAEpA7gBhTcDyAlBACACKQPAASABKQPAAYU3A9AJQQAgAikDyAEgASkDyAGFNwPYCUEAIAIpA9ABIAEpA9ABhTcD4AlBACACKQPYASABKQPYAYU3A+gJQQAgAikD4AEgASkD4AGFNwPwCUEAIAIpA+gBIAEpA+gBhTcD+AlBACACKQPwASABKQPwAYU3A4AKQQAgAikD+AEgASkD+AGFNwOICkEAIAIpA4ACIAEpA4AChTcDkApBACACKQOIAiABKQOIAoU3A5gKQQAgAikDkAIgASkDkAKFNwOgCkEAIAIpA5gCIAEpA5gChTcDqApBACACKQOgAiABKQOgAoU3A7AKQQAgAikDqAIgASkDqAKFNwO4CkEAIAIpA7ACIAEpA7AChTcDwApBACACKQO4AiABKQO4AoU3A8gKQQAgAikDwAIgASkDwAKFNwPQCkEAIAIpA8gCIAEpA8gChTcD2ApBACACKQPQAiABKQPQAoU3A+AKQQAgAikD2AIgASkD2AKFNwPoCkEAIAIpA+ACIAEpA+AChTcD8ApBACACKQPoAiABKQPoAoU3A/gKQQAgAikD8AIgASkD8AKFNwOAC0EAIAIpA/gCIAEpA/gChTcDiAtBACACKQOAAyABKQOAA4U3A5ALQQAgAikDiAMgASkDiAOFNwOYC0EAIAIpA5ADIAEpA5ADhTcDoAtBACACKQOYAyABKQOYA4U3A6gLQQAgAikDoAMgASkDoAOFNwOwC0EAIAIpA6gDIAEpA6gDhTcDuAtBACACKQOwAyABKQOwA4U3A8ALQQAgAikDuAMgASkDuAOFNwPIC0EAIAIpA8ADIAEpA8ADhTcD0AtBACACKQPIAyABKQPIA4U3A9gLQQAgAikD0AMgASkD0AOFNwPgC0EAIAIpA9gDIAEpA9gDhTcD6AtBACACKQPgAyABKQPgA4U3A/ALQQAgAikD6AMgASkD6AOFNwP4C0EAIAIpA/ADIAEpA/ADhTcDgAxBACACKQP4AyABKQP4A4U3A4gMQQAgAikDgAQgASkDgASFNwOQDEEAIAIpA4gEIAEpA4gEhTcDmAxBACACKQOQBCABKQOQBIU3A6AMQQAgAikDmAQgASkDmASFNwOoDEEAIAIpA6AEIAEpA6AEhTcDsAxBACACKQOoBCABKQOoBIU3A7gMQQAgAikDsAQgASkDsASFNwPADEEAIAIpA7gEIAEpA7gEhTcDyAxBACACKQPABCABKQPABIU3A9AMQQAgAikDyAQgASkDyASFNwPYDEEAIAIpA9AEIAEpA9AEhTcD4AxBACACKQPYBCABKQPYBIU3A+gMQQAgAikD4AQgASkD4ASFNwPwDEEAIAIpA+gEIAEpA+gEhTcD+AxBACACKQPwBCABKQPwBIU3A4ANQQAgAikD+AQgASkD+ASFNwOIDUEAIAIpA4AFIAEpA4AFhTcDkA1BACACKQOIBSABKQOIBYU3A5gNQQAgAikDkAUgASkDkAWFNwOgDUEAIAIpA5gFIAEpA5gFhTcDqA1BACACKQOgBSABKQOgBYU3A7ANQQAgAikDqAUgASkDqAWFNwO4DUEAIAIpA7AFIAEpA7AFhTcDwA1BACACKQO4BSABKQO4BYU3A8gNQQAgAikDwAUgASkDwAWFNwPQDUEAIAIpA8gFIAEpA8gFhTcD2A1BACACKQPQBSABKQPQBYU3A+ANQQAgAikD2AUgASkD2AWFNwPoDUEAIAIpA+AFIAEpA+AFhTcD8A1BACACKQPoBSABKQPoBYU3A/gNQQAgAikD8AUgASkD8AWFNwOADkEAIAIpA/gFIAEpA/gFhTcDiA5BACACKQOABiABKQOABoU3A5AOQQAgAikDiAYgASkDiAaFNwOYDkEAIAIpA5AGIAEpA5AGhTcDoA5BACACKQOYBiABKQOYBoU3A6gOQQAgAikDoAYgASkDoAaFNwOwDkEAIAIpA6gGIAEpA6gGhTcDuA5BACACKQOwBiABKQOwBoU3A8AOQQAgAikDuAYgASkDuAaFNwPIDkEAIAIpA8AGIAEpA8AGhTcD0A5BACACKQPIBiABKQPIBoU3A9gOQQAgAikD0AYgASkD0AaFNwPgDkEAIAIpA9gGIAEpA9gGhTcD6A5BACACKQPgBiABKQPgBoU3A/AOQQAgAikD6AYgASkD6AaFNwP4DkEAIAIpA/AGIAEpA/AGhTcDgA9BACACKQP4BiABKQP4BoU3A4gPQQAgAikDgAcgASkDgAeFNwOQD0EAIAIpA4gHIAEpA4gHhTcDmA9BACACKQOQByABKQOQB4U3A6APQQAgAikDmAcgASkDmAeFNwOoD0EAIAIpA6AHIAEpA6AHhTcDsA9BACACKQOoByABKQOoB4U3A7gPQQAgAikDsAcgASkDsAeFNwPAD0EAIAIpA7gHIAEpA7gHhTcDyA9BACACKQPAByABKQPAB4U3A9APQQAgAikDyAcgASkDyAeFNwPYD0EAIAIpA9AHIAEpA9AHhTcD4A9BACACKQPYByABKQPYB4U3A+gPQQAgAikD4AcgASkD4AeFNwPwD0EAIAIpA+gHIAEpA+gHhTcD+A9BACACKQPwByABKQPwB4U3A4AQQQAgAikD+AcgASkD+AeFNwOIEEGQCEGYCEGgCEGoCEGwCEG4CEHACEHICEHQCEHYCEHgCEHoCEHwCEH4CEGACUGICRACQZAJQZgJQaAJQagJQbAJQbgJQcAJQcgJQdAJQdgJQeAJQegJQfAJQfgJQYAKQYgKEAJBkApBmApBoApBqApBsApBuApBwApByApB0ApB2ApB4ApB6ApB8ApB+ApBgAtBiAsQAkGQC0GYC0GgC0GoC0GwC0G4C0HAC0HIC0HQC0HYC0HgC0HoC0HwC0H4C0GADEGIDBACQZAMQZgMQaAMQagMQbAMQbgMQcAMQcgMQdAMQdgMQeAMQegMQfAMQfgMQYANQYgNEAJBkA1BmA1BoA1BqA1BsA1BuA1BwA1ByA1B0A1B2A1B4A1B6A1B8A1B+A1BgA5BiA4QAkGQDkGYDkGgDkGoDkGwDkG4DkHADkHIDkHQDkHYDkHgDkHoDkHwDkH4DkGAD0GIDxACQZAPQZgPQaAPQagPQbAPQbgPQcAPQcgPQdAPQdgPQeAPQegPQfAPQfgPQYAQQYgQEAJBkAhBmAhBkAlBmAlBkApBmApBkAtBmAtBkAxBmAxBkA1BmA1BkA5BmA5BkA9BmA8QAkGgCEGoCEGgCUGoCUGgCkGoCkGgC0GoC0GgDEGoDEGgDUGoDUGgDkGoDkGgD0GoDxACQbAIQbgIQbAJQbgJQbAKQbgKQbALQbgLQbAMQbgMQbANQbgNQbAOQbgOQbAPQbgPEAJBwAhByAhBwAlByAlBwApByApBwAtByAtBwAxByAxBwA1ByA1BwA5ByA5BwA9ByA8QAkHQCEHYCEHQCUHYCUHQCkHYCkHQC0HYC0HQDEHYDEHQDUHYDUHQDkHYDkHQD0HYDxACQeAIQegIQeAJQegJQeAKQegKQeALQegLQeAMQegMQeANQegNQeAOQegOQeAPQegPEAJB8AhB+AhB8AlB+AlB8ApB+ApB8AtB+AtB8AxB+AxB8A1B+A1B8A5B+A5B8A9B+A8QAkGACUGICUGACkGICkGAC0GIC0GADEGIDEGADUGIDUGADkGIDkGAD0GID0GAEEGIEBACAkACQCADRQ0AA0AgACAEaiIDIAIgBGoiBSkDACABIARqIgYpAwCFIARBkAhqKQMAhSADKQMAhTcDACADQQhqIgMgBUEIaikDACAGQQhqKQMAhSAEQZgIaikDAIUgAykDAIU3AwAgBEEQaiIEQYAIRw0ADAILC0EAIQQDQCAAIARqIgMgAiAEaiIFKQMAIAEgBGoiBikDAIUgBEGQCGopAwCFNwMAIANBCGogBUEIaikDACAGQQhqKQMAhSAEQZgIaikDAIU3AwAgBEEQaiIEQYAIRw0ACwsL5QcMBX8BfgR/An4BfwF+AX8Bfgd/AX4DfwF+AkBBACgCgAgiAiABQQp0aiIDKAIIIAFHDQAgAygCDCEEIAMoAgAhBUEAIAMoAhQiBq03A7gQQQAgBK0iBzcDsBBBACAFIAEgBUECdG4iCGwiCUECdK03A6gQAkACQAJAAkAgBEUNAEF/IQogBUUNASAIQQNsIQsgCEECdCIErSEMIAWtIQ0gBkF/akECSSEOQgAhDwNAQQAgDzcDkBAgD6chEEIAIRFBACEBA0BBACARNwOgECAPIBGEUCIDIA5xIRIgBkEBRiAPUCITIAZBAkYgEUICVHFxciEUQX8gAUEBakEDcSAIbEF/aiATGyEVIAEgEHIhFiABIAhsIRcgA0EBdCEYQgAhGQNAQQBCADcDwBBBACAZNwOYECAYIQECQCASRQ0AQQBCATcDwBBBkBhBkBBBkCBBABADQZAYQZAYQZAgQQAQA0ECIQELAkAgASAITw0AIAQgGaciGmwgF2ogAWohAwNAIANBACAEIAEbQQAgEVAiGxtqQX9qIRwCQAJAIBQNAEEAKAKACCICIBxBCnQiHGohCgwBCwJAIAFB/wBxIgINAEEAQQApA8AQQgF8NwPAEEGQGEGQEEGQIEEAEANBkBhBkBhBkCBBABADCyAcQQp0IRwgAkEDdEGQGGohCkEAKAKACCECCyACIANBCnRqIAIgHGogAiAKKQMAIh1CIIinIAVwIBogFhsiHCAEbCABIAFBACAZIBytUSIcGyIKIBsbIBdqIAogC2ogExsgAUUgHHJrIhsgFWqtIB1C/////w+DIh0gHX5CIIggG61+QiCIfSAMgqdqQQp0akEBEAMgA0EBaiEDIAggAUEBaiIBRw0ACwsgGUIBfCIZIA1SDQALIBFCAXwiEachASARQgRSDQALIA9CAXwiDyAHUg0AC0EAKAKACCECCyAJQQx0QYB4aiEXIAVBf2oiCkUNAgwBC0EAQgM3A6AQQQAgBEF/aq03A5AQQYB4IRcLIAIgF2ohGyAIQQx0IQhBACEcA0AgCCAcQQFqIhxsQYB4aiEEQQAhAQNAIBsgAWoiAyADKQMAIAIgBCABamopAwCFNwMAIANBCGoiAyADKQMAIAIgBCABQQhyamopAwCFNwMAIAFBCGohAyABQRBqIQEgA0H4B0kNAAsgHCAKRw0ACwsgAiAXaiEbQXghAQNAIAIgAWoiA0EIaiAbIAFqIgRBCGopAwA3AwAgA0EQaiAEQRBqKQMANwMAIANBGGogBEEYaikDADcDACADQSBqIARBIGopAwA3AwAgAUEgaiIBQfgHSQ0ACwsL";
  var hash$k = "e4cdc523";
  var wasmJson$k = {
    name: name$k,
    data: data$k,
    hash: hash$k
  };
  var name$j = "blake2b";
  var data$j = "AGFzbQEAAAABEQRgAAF/YAJ/fwBgAX8AYAAAAwoJAAECAwECAgABBQQBAQICBg4CfwFBsIsFC38AQYAICwdwCAZtZW1vcnkCAA5IYXNoX0dldEJ1ZmZlcgAACkhhc2hfRmluYWwAAwlIYXNoX0luaXQABQtIYXNoX1VwZGF0ZQAGDUhhc2hfR2V0U3RhdGUABw5IYXNoX0NhbGN1bGF0ZQAIClNUQVRFX1NJWkUDAQrTOAkFAEGACQvrAgIFfwF+AkAgAUEBSA0AAkACQAJAIAFBgAFBACgC4IoBIgJrIgNKDQAgASEEDAELQQBBADYC4IoBAkAgAkH/AEoNACACQeCJAWohBSAAIQRBACEGA0AgBSAELQAAOgAAIARBAWohBCAFQQFqIQUgAyAGQQFqIgZB/wFxSg0ACwtBAEEAKQPAiQEiB0KAAXw3A8CJAUEAQQApA8iJASAHQv9+Vq18NwPIiQFB4IkBEAIgACADaiEAAkAgASADayIEQYEBSA0AIAIgAWohBQNAQQBBACkDwIkBIgdCgAF8NwPAiQFBAEEAKQPIiQEgB0L/flatfDcDyIkBIAAQAiAAQYABaiEAIAVBgH9qIgVBgAJLDQALIAVBgH9qIQQMAQsgBEEATA0BC0EAIQUDQCAFQQAoAuCKAWpB4IkBaiAAIAVqLQAAOgAAIAQgBUEBaiIFQf8BcUoNAAsLQQBBACgC4IoBIARqNgLgigELC78uASR+QQBBACkD0IkBQQApA7CJASIBQQApA5CJAXwgACkDICICfCIDhULr+obav7X2wR+FQiCJIgRCq/DT9K/uvLc8fCIFIAGFQiiJIgYgA3wgACkDKCIBfCIHIASFQjCJIgggBXwiCSAGhUIBiSIKQQApA8iJAUEAKQOoiQEiBEEAKQOIiQF8IAApAxAiA3wiBYVCn9j52cKR2oKbf4VCIIkiC0K7zqqm2NDrs7t/fCIMIASFQiiJIg0gBXwgACkDGCIEfCIOfCAAKQNQIgV8Ig9BACkDwIkBQQApA6CJASIQQQApA4CJASIRfCAAKQMAIgZ8IhKFQtGFmu/6z5SH0QCFQiCJIhNCiJLznf/M+YTqAHwiFCAQhUIoiSIVIBJ8IAApAwgiEHwiFiAThUIwiSIXhUIgiSIYQQApA9iJAUEAKQO4iQEiE0EAKQOYiQF8IAApAzAiEnwiGYVC+cL4m5Gjs/DbAIVCIIkiGkLx7fT4paf9p6V/fCIbIBOFQiiJIhwgGXwgACkDOCITfCIZIBqFQjCJIhogG3wiG3wiHSAKhUIoiSIeIA98IAApA1giCnwiDyAYhUIwiSIYIB18Ih0gDiALhUIwiSIOIAx8Ih8gDYVCAYkiDCAWfCAAKQNAIgt8Ig0gGoVCIIkiFiAJfCIaIAyFQiiJIiAgDXwgACkDSCIJfCIhIBaFQjCJIhYgGyAchUIBiSIMIAd8IAApA2AiB3wiDSAOhUIgiSIOIBcgFHwiFHwiFyAMhUIoiSIbIA18IAApA2giDHwiHCAOhUIwiSIOIBd8IhcgG4VCAYkiGyAZIBQgFYVCAYkiFHwgACkDcCINfCIVIAiFQiCJIhkgH3wiHyAUhUIoiSIUIBV8IAApA3giCHwiFXwgDHwiIoVCIIkiI3wiJCAbhUIoiSIbICJ8IBJ8IiIgFyAYIBUgGYVCMIkiFSAffCIZIBSFQgGJIhQgIXwgDXwiH4VCIIkiGHwiFyAUhUIoiSIUIB98IAV8Ih8gGIVCMIkiGCAXfCIXIBSFQgGJIhR8IAF8IiEgFiAafCIWIBUgHSAehUIBiSIaIBx8IAl8IhyFQiCJIhV8Ih0gGoVCKIkiGiAcfCAIfCIcIBWFQjCJIhWFQiCJIh4gGSAOIBYgIIVCAYkiFiAPfCACfCIPhUIgiSIOfCIZIBaFQiiJIhYgD3wgC3wiDyAOhUIwiSIOIBl8Ihl8IiAgFIVCKIkiFCAhfCAEfCIhIB6FQjCJIh4gIHwiICAiICOFQjCJIiIgJHwiIyAbhUIBiSIbIBx8IAp8IhwgDoVCIIkiDiAXfCIXIBuFQiiJIhsgHHwgE3wiHCAOhUIwiSIOIBkgFoVCAYkiFiAffCAQfCIZICKFQiCJIh8gFSAdfCIVfCIdIBaFQiiJIhYgGXwgB3wiGSAfhUIwiSIfIB18Ih0gFoVCAYkiFiAVIBqFQgGJIhUgD3wgBnwiDyAYhUIgiSIYICN8IhogFYVCKIkiFSAPfCADfCIPfCAHfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgBnwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAOIBd8Ig4gDyAYhUIwiSIPICAgFIVCAYkiFCAZfCAKfCIXhUIgiSIYfCIZIBSFQiiJIhQgF3wgC3wiF3wgBXwiICAPIBp8Ig8gHyAOIBuFQgGJIg4gIXwgCHwiGoVCIIkiG3wiHyAOhUIoiSIOIBp8IAx8IhogG4VCMIkiG4VCIIkiISAdIB4gDyAVhUIBiSIPIBx8IAF8IhWFQiCJIhx8Ih0gD4VCKIkiDyAVfCADfCIVIByFQjCJIhwgHXwiHXwiHiAWhUIoiSIWICB8IA18IiAgIYVCMIkiISAefCIeIBogFyAYhUIwiSIXIBl8IhggFIVCAYkiFHwgCXwiGSAchUIgiSIaICR8IhwgFIVCKIkiFCAZfCACfCIZIBqFQjCJIhogHSAPhUIBiSIPICJ8IAR8Ih0gF4VCIIkiFyAbIB98Iht8Ih8gD4VCKIkiDyAdfCASfCIdIBeFQjCJIhcgH3wiHyAPhUIBiSIPIBsgDoVCAYkiDiAVfCATfCIVICOFQiCJIhsgGHwiGCAOhUIoiSIOIBV8IBB8IhV8IAx8IiKFQiCJIiN8IiQgD4VCKIkiDyAifCAHfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBogHHwiGiAVIBuFQjCJIhUgHiAWhUIBiSIWIB18IAR8IhuFQiCJIhx8Ih0gFoVCKIkiFiAbfCAQfCIbfCABfCIeIBUgGHwiFSAXIBogFIVCAYkiFCAgfCATfCIYhUIgiSIXfCIaIBSFQiiJIhQgGHwgCXwiGCAXhUIwiSIXhUIgiSIgIB8gISAVIA6FQgGJIg4gGXwgCnwiFYVCIIkiGXwiHyAOhUIoiSIOIBV8IA18IhUgGYVCMIkiGSAffCIffCIhIA+FQiiJIg8gHnwgBXwiHiAghUIwiSIgICF8IiEgGyAchUIwiSIbIB18IhwgFoVCAYkiFiAYfCADfCIYIBmFQiCJIhkgJHwiHSAWhUIoiSIWIBh8IBJ8IhggGYVCMIkiGSAfIA6FQgGJIg4gInwgAnwiHyAbhUIgiSIbIBcgGnwiF3wiGiAOhUIoiSIOIB98IAZ8Ih8gG4VCMIkiGyAafCIaIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAh8IhUgI4VCIIkiFyAcfCIcIBSFQiiJIhQgFXwgC3wiFXwgBXwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IAh8IiIgGiAgIBUgF4VCMIkiFSAcfCIXIBSFQgGJIhQgGHwgCXwiGIVCIIkiHHwiGiAUhUIoiSIUIBh8IAZ8IhggHIVCMIkiHCAafCIaIBSFQgGJIhR8IAR8IiAgGSAdfCIZIBUgISAPhUIBiSIPIB98IAN8Ih2FQiCJIhV8Ih8gD4VCKIkiDyAdfCACfCIdIBWFQjCJIhWFQiCJIiEgFyAbIBkgFoVCAYkiFiAefCABfCIZhUIgiSIbfCIXIBaFQiiJIhYgGXwgE3wiGSAbhUIwiSIbIBd8Ihd8Ih4gFIVCKIkiFCAgfCAMfCIgICGFQjCJIiEgHnwiHiAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIB18IBJ8Ih0gG4VCIIkiGyAafCIaIA6FQiiJIg4gHXwgC3wiHSAbhUIwiSIbIBcgFoVCAYkiFiAYfCANfCIXICKFQiCJIhggFSAffCIVfCIfIBaFQiiJIhYgF3wgEHwiFyAYhUIwiSIYIB98Ih8gFoVCAYkiFiAVIA+FQgGJIg8gGXwgCnwiFSAchUIgiSIZICN8IhwgD4VCKIkiDyAVfCAHfCIVfCASfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgBXwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAbIBp8IhogFSAZhUIwiSIVIB4gFIVCAYkiFCAXfCADfCIXhUIgiSIZfCIbIBSFQiiJIhQgF3wgB3wiF3wgAnwiHiAVIBx8IhUgGCAaIA6FQgGJIg4gIHwgC3wiGoVCIIkiGHwiHCAOhUIoiSIOIBp8IAR8IhogGIVCMIkiGIVCIIkiICAfICEgFSAPhUIBiSIPIB18IAZ8IhWFQiCJIh18Ih8gD4VCKIkiDyAVfCAKfCIVIB2FQjCJIh0gH3wiH3wiISAWhUIoiSIWIB58IAx8Ih4gIIVCMIkiICAhfCIhIBogFyAZhUIwiSIXIBt8IhkgFIVCAYkiFHwgEHwiGiAdhUIgiSIbICR8Ih0gFIVCKIkiFCAafCAJfCIaIBuFQjCJIhsgHyAPhUIBiSIPICJ8IBN8Ih8gF4VCIIkiFyAYIBx8Ihh8IhwgD4VCKIkiDyAffCABfCIfIBeFQjCJIhcgHHwiHCAPhUIBiSIPIBggDoVCAYkiDiAVfCAIfCIVICOFQiCJIhggGXwiGSAOhUIoiSIOIBV8IA18IhV8IA18IiKFQiCJIiN8IiQgD4VCKIkiDyAifCAMfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBsgHXwiGyAVIBiFQjCJIhUgISAWhUIBiSIWIB98IBB8IhiFQiCJIh18Ih8gFoVCKIkiFiAYfCAIfCIYfCASfCIhIBUgGXwiFSAXIBsgFIVCAYkiFCAefCAHfCIZhUIgiSIXfCIbIBSFQiiJIhQgGXwgAXwiGSAXhUIwiSIXhUIgiSIeIBwgICAVIA6FQgGJIg4gGnwgAnwiFYVCIIkiGnwiHCAOhUIoiSIOIBV8IAV8IhUgGoVCMIkiGiAcfCIcfCIgIA+FQiiJIg8gIXwgBHwiISAehUIwiSIeICB8IiAgGCAdhUIwiSIYIB98Ih0gFoVCAYkiFiAZfCAGfCIZIBqFQiCJIhogJHwiHyAWhUIoiSIWIBl8IBN8IhkgGoVCMIkiGiAcIA6FQgGJIg4gInwgCXwiHCAYhUIgiSIYIBcgG3wiF3wiGyAOhUIoiSIOIBx8IAN8IhwgGIVCMIkiGCAbfCIbIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAt8IhUgI4VCIIkiFyAdfCIdIBSFQiiJIhQgFXwgCnwiFXwgBHwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IAl8IiIgGyAeIBUgF4VCMIkiFSAdfCIXIBSFQgGJIhQgGXwgDHwiGYVCIIkiHXwiGyAUhUIoiSIUIBl8IAp8IhkgHYVCMIkiHSAbfCIbIBSFQgGJIhR8IAN8Ih4gGiAffCIaIBUgICAPhUIBiSIPIBx8IAd8IhyFQiCJIhV8Ih8gD4VCKIkiDyAcfCAQfCIcIBWFQjCJIhWFQiCJIiAgFyAYIBogFoVCAYkiFiAhfCATfCIahUIgiSIYfCIXIBaFQiiJIhYgGnwgDXwiGiAYhUIwiSIYIBd8Ihd8IiEgFIVCKIkiFCAefCAFfCIeICCFQjCJIiAgIXwiISAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIBx8IAt8IhwgGIVCIIkiGCAbfCIbIA6FQiiJIg4gHHwgEnwiHCAYhUIwiSIYIBcgFoVCAYkiFiAZfCABfCIXICKFQiCJIhkgFSAffCIVfCIfIBaFQiiJIhYgF3wgBnwiFyAZhUIwiSIZIB98Ih8gFoVCAYkiFiAVIA+FQgGJIg8gGnwgCHwiFSAdhUIgiSIaICN8Ih0gD4VCKIkiDyAVfCACfCIVfCANfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgCXwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAYIBt8IhggFSAahUIwiSIVICEgFIVCAYkiFCAXfCASfCIXhUIgiSIafCIbIBSFQiiJIhQgF3wgCHwiF3wgB3wiISAVIB18IhUgGSAYIA6FQgGJIg4gHnwgBnwiGIVCIIkiGXwiHSAOhUIoiSIOIBh8IAt8IhggGYVCMIkiGYVCIIkiHiAfICAgFSAPhUIBiSIPIBx8IAp8IhWFQiCJIhx8Ih8gD4VCKIkiDyAVfCAEfCIVIByFQjCJIhwgH3wiH3wiICAWhUIoiSIWICF8IAN8IiEgHoVCMIkiHiAgfCIgIBggFyAahUIwiSIXIBt8IhogFIVCAYkiFHwgBXwiGCAchUIgiSIbICR8IhwgFIVCKIkiFCAYfCABfCIYIBuFQjCJIhsgHyAPhUIBiSIPICJ8IAx8Ih8gF4VCIIkiFyAZIB18Ihl8Ih0gD4VCKIkiDyAffCATfCIfIBeFQjCJIhcgHXwiHSAPhUIBiSIPIBkgDoVCAYkiDiAVfCAQfCIVICOFQiCJIhkgGnwiGiAOhUIoiSIOIBV8IAJ8IhV8IBN8IiKFQiCJIiN8IiQgD4VCKIkiDyAifCASfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBsgHHwiGyAVIBmFQjCJIhUgICAWhUIBiSIWIB98IAt8IhmFQiCJIhx8Ih8gFoVCKIkiFiAZfCACfCIZfCAJfCIgIBUgGnwiFSAXIBsgFIVCAYkiFCAhfCAFfCIahUIgiSIXfCIbIBSFQiiJIhQgGnwgA3wiGiAXhUIwiSIXhUIgiSIhIB0gHiAVIA6FQgGJIg4gGHwgEHwiFYVCIIkiGHwiHSAOhUIoiSIOIBV8IAF8IhUgGIVCMIkiGCAdfCIdfCIeIA+FQiiJIg8gIHwgDXwiICAhhUIwiSIhIB58Ih4gGSAchUIwiSIZIB98IhwgFoVCAYkiFiAafCAIfCIaIBiFQiCJIhggJHwiHyAWhUIoiSIWIBp8IAp8IhogGIVCMIkiGCAdIA6FQgGJIg4gInwgBHwiHSAZhUIgiSIZIBcgG3wiF3wiGyAOhUIoiSIOIB18IAd8Ih0gGYVCMIkiGSAbfCIbIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAx8IhUgI4VCIIkiFyAcfCIcIBSFQiiJIhQgFXwgBnwiFXwgEnwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IBN8IiIgGyAhIBUgF4VCMIkiFSAcfCIXIBSFQgGJIhQgGnwgBnwiGoVCIIkiHHwiGyAUhUIoiSIUIBp8IBB8IhogHIVCMIkiHCAbfCIbIBSFQgGJIhR8IA18IiEgGCAffCIYIBUgHiAPhUIBiSIPIB18IAJ8Ih2FQiCJIhV8Ih4gD4VCKIkiDyAdfCABfCIdIBWFQjCJIhWFQiCJIh8gFyAZIBggFoVCAYkiFiAgfCADfCIYhUIgiSIZfCIXIBaFQiiJIhYgGHwgBHwiGCAZhUIwiSIZIBd8Ihd8IiAgFIVCKIkiFCAhfCAIfCIhIB+FQjCJIh8gIHwiICAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIB18IAd8Ih0gGYVCIIkiGSAbfCIbIA6FQiiJIg4gHXwgDHwiHSAZhUIwiSIZIBcgFoVCAYkiFiAafCALfCIXICKFQiCJIhogFSAefCIVfCIeIBaFQiiJIhYgF3wgCXwiFyAahUIwiSIaIB58Ih4gFoVCAYkiFiAVIA+FQgGJIg8gGHwgBXwiFSAchUIgiSIYICN8IhwgD4VCKIkiDyAVfCAKfCIVfCACfCIChUIgiSIifCIjIBaFQiiJIhYgAnwgC3wiAiAihUIwiSILICN8IiIgFoVCAYkiFiAZIBt8IhkgFSAYhUIwiSIVICAgFIVCAYkiFCAXfCANfCINhUIgiSIXfCIYIBSFQiiJIhQgDXwgBXwiBXwgEHwiECAVIBx8Ig0gGiAZIA6FQgGJIg4gIXwgDHwiDIVCIIkiFXwiGSAOhUIoiSIOIAx8IBJ8IhIgFYVCMIkiDIVCIIkiFSAeIB8gDSAPhUIBiSINIB18IAl8IgmFQiCJIg98IhogDYVCKIkiDSAJfCAIfCIJIA+FQjCJIgggGnwiD3wiGiAWhUIoiSIWIBB8IAd8IhAgEYUgDCAZfCIHIA6FQgGJIgwgCXwgCnwiCiALhUIgiSILIAUgF4VCMIkiBSAYfCIJfCIOIAyFQiiJIgwgCnwgE3wiEyALhUIwiSIKIA58IguFNwOAiQFBACADIAYgDyANhUIBiSINIAJ8fCICIAWFQiCJIgUgB3wiBiANhUIoiSIHIAJ8fCICQQApA4iJAYUgBCABIBIgCSAUhUIBiSIDfHwiASAIhUIgiSISICJ8IgkgA4VCKIkiAyABfHwiASAShUIwiSIEIAl8IhKFNwOIiQFBACATQQApA5CJAYUgECAVhUIwiSIQIBp8IhOFNwOQiQFBACABQQApA5iJAYUgAiAFhUIwiSICIAZ8IgGFNwOYiQFBACASIAOFQgGJQQApA6CJAYUgAoU3A6CJAUEAIBMgFoVCAYlBACkDqIkBhSAKhTcDqIkBQQAgASAHhUIBiUEAKQOwiQGFIASFNwOwiQFBACALIAyFQgGJQQApA7iJAYUgEIU3A7iJAQvdAgUBfwF+AX8BfgJ/IwBBwABrIgAkAAJAQQApA9CJAUIAUg0AQQBBACkDwIkBIgFBACgC4IoBIgKsfCIDNwPAiQFBAEEAKQPIiQEgAyABVK18NwPIiQECQEEALQDoigFFDQBBAEJ/NwPYiQELQQBCfzcD0IkBAkAgAkH/AEoNAEEAIQQDQCACIARqQeCJAWpBADoAACAEQQFqIgRBgAFBACgC4IoBIgJrSA0ACwtB4IkBEAIgAEEAKQOAiQE3AwAgAEEAKQOIiQE3AwggAEEAKQOQiQE3AxAgAEEAKQOYiQE3AxggAEEAKQOgiQE3AyAgAEEAKQOoiQE3AyggAEEAKQOwiQE3AzAgAEEAKQO4iQE3AzhBACgC5IoBIgVBAUgNAEEAIQRBACECA0AgBEGACWogACAEai0AADoAACAEQQFqIQQgBSACQQFqIgJB/wFxSg0ACwsgAEHAAGokAAv9AwMBfwF+AX8jAEGAAWsiAiQAQQBBgQI7AfKKAUEAIAE6APGKAUEAIAA6APCKAUGQfiEAA0AgAEGAiwFqQgA3AAAgAEH4igFqQgA3AAAgAEHwigFqQgA3AAAgAEEYaiIADQALQQAhAEEAQQApA/CKASIDQoiS853/zPmE6gCFNwOAiQFBAEEAKQP4igFCu86qptjQ67O7f4U3A4iJAUEAQQApA4CLAUKr8NP0r+68tzyFNwOQiQFBAEEAKQOIiwFC8e30+KWn/aelf4U3A5iJAUEAQQApA5CLAULRhZrv+s+Uh9EAhTcDoIkBQQBBACkDmIsBQp/Y+dnCkdqCm3+FNwOoiQFBAEEAKQOgiwFC6/qG2r+19sEfhTcDsIkBQQBBACkDqIsBQvnC+JuRo7Pw2wCFNwO4iQFBACADp0H/AXE2AuSKAQJAIAFBAUgNACACQgA3A3ggAkIANwNwIAJCADcDaCACQgA3A2AgAkIANwNYIAJCADcDUCACQgA3A0ggAkIANwNAIAJCADcDOCACQgA3AzAgAkIANwMoIAJCADcDICACQgA3AxggAkIANwMQIAJCADcDCCACQgA3AwBBACEEA0AgAiAAaiAAQYAJai0AADoAACAAQQFqIQAgBEEBaiIEQf8BcSABSA0ACyACQYABEAELIAJBgAFqJAALEgAgAEEDdkH/P3EgAEEQdhAECwkAQYAJIAAQAQsGAEGAiQELGwAgAUEDdkH/P3EgAUEQdhAEQYAJIAAQARADCwsLAQBBgAgLBPAAAAA=";
  var hash$j = "c6f286e6";
  var wasmJson$j = {
    name: name$j,
    data: data$j,
    hash: hash$j
  };
  var mutex$k = new Mutex();
  function validateBits$4(bits2) {
    if (!Number.isInteger(bits2) || bits2 < 8 || bits2 > 512 || bits2 % 8 !== 0) {
      return new Error("Invalid variant! Valid values: 8, 16, ..., 512");
    }
    return null;
  }
  function getInitParam$1(outputBits, keyBits) {
    return outputBits | keyBits << 16;
  }
  function createBLAKE2b(bits2 = 512, key = null) {
    if (validateBits$4(bits2)) {
      return Promise.reject(validateBits$4(bits2));
    }
    let keyBuffer = null;
    let initParam = bits2;
    if (key !== null) {
      keyBuffer = getUInt8Buffer(key);
      if (keyBuffer.length > 64) {
        return Promise.reject(new Error("Max key length is 64 bytes"));
      }
      initParam = getInitParam$1(bits2, keyBuffer.length);
    }
    const outputSize = bits2 / 8;
    return WASMInterface(wasmJson$j, outputSize).then((wasm) => {
      if (initParam > 512) {
        wasm.writeMemory(keyBuffer);
      }
      wasm.init(initParam);
      const obj = {
        init: initParam > 512 ? () => {
          wasm.writeMemory(keyBuffer);
          wasm.init(initParam);
          return obj;
        } : () => {
          wasm.init(initParam);
          return obj;
        },
        update: (data) => {
          wasm.update(data);
          return obj;
        },
        // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
        digest: (outputType) => wasm.digest(outputType),
        save: () => wasm.save(),
        load: (data) => {
          wasm.load(data);
          return obj;
        },
        blockSize: 128,
        digestSize: outputSize
      };
      return obj;
    });
  }
  function encodeResult(salt, options, res) {
    const parameters = [
      `m=${options.memorySize}`,
      `t=${options.iterations}`,
      `p=${options.parallelism}`
    ].join(",");
    return `$argon2${options.hashType}$v=19$${parameters}$${encodeBase64(salt, false)}$${encodeBase64(res, false)}`;
  }
  var uint32View = new DataView(new ArrayBuffer(4));
  function int32LE(x) {
    uint32View.setInt32(0, x, true);
    return new Uint8Array(uint32View.buffer);
  }
  function hashFunc(blake512, buf, len) {
    return __awaiter(this, void 0, void 0, function* () {
      if (len <= 64) {
        const blake = yield createBLAKE2b(len * 8);
        blake.update(int32LE(len));
        blake.update(buf);
        return blake.digest("binary");
      }
      const r = Math.ceil(len / 32) - 2;
      const ret = new Uint8Array(len);
      blake512.init();
      blake512.update(int32LE(len));
      blake512.update(buf);
      let vp = blake512.digest("binary");
      ret.set(vp.subarray(0, 32), 0);
      for (let i = 1; i < r; i++) {
        blake512.init();
        blake512.update(vp);
        vp = blake512.digest("binary");
        ret.set(vp.subarray(0, 32), i * 32);
      }
      const partialBytesNeeded = len - 32 * r;
      let blakeSmall;
      if (partialBytesNeeded === 64) {
        blakeSmall = blake512;
        blakeSmall.init();
      } else {
        blakeSmall = yield createBLAKE2b(partialBytesNeeded * 8);
      }
      blakeSmall.update(vp);
      vp = blakeSmall.digest("binary");
      ret.set(vp.subarray(0, partialBytesNeeded), r * 32);
      return ret;
    });
  }
  function getHashType(type) {
    switch (type) {
      case "d":
        return 0;
      case "i":
        return 1;
      default:
        return 2;
    }
  }
  function argon2Internal(options) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a3;
      const { parallelism, iterations, hashLength } = options;
      const password = getUInt8Buffer(options.password);
      const salt = getUInt8Buffer(options.salt);
      const version = 19;
      const hashType = getHashType(options.hashType);
      const { memorySize } = options;
      const secret = getUInt8Buffer((_a3 = options.secret) !== null && _a3 !== void 0 ? _a3 : "");
      const [argon2Interface, blake512] = yield Promise.all([
        WASMInterface(wasmJson$k, 1024),
        createBLAKE2b(512)
      ]);
      argon2Interface.setMemorySize(memorySize * 1024 + 1024);
      const initVector = new Uint8Array(24);
      const initVectorView = new DataView(initVector.buffer);
      initVectorView.setInt32(0, parallelism, true);
      initVectorView.setInt32(4, hashLength, true);
      initVectorView.setInt32(8, memorySize, true);
      initVectorView.setInt32(12, iterations, true);
      initVectorView.setInt32(16, version, true);
      initVectorView.setInt32(20, hashType, true);
      argon2Interface.writeMemory(initVector, memorySize * 1024);
      blake512.init();
      blake512.update(initVector);
      blake512.update(int32LE(password.length));
      blake512.update(password);
      blake512.update(int32LE(salt.length));
      blake512.update(salt);
      blake512.update(int32LE(secret.length));
      blake512.update(secret);
      blake512.update(int32LE(0));
      const segments = Math.floor(memorySize / (parallelism * 4));
      const lanes = segments * 4;
      const param = new Uint8Array(72);
      const H0 = blake512.digest("binary");
      param.set(H0);
      for (let lane = 0; lane < parallelism; lane++) {
        param.set(int32LE(0), 64);
        param.set(int32LE(lane), 68);
        let position = lane * lanes;
        let chunk = yield hashFunc(blake512, param, 1024);
        argon2Interface.writeMemory(chunk, position * 1024);
        position += 1;
        param.set(int32LE(1), 64);
        chunk = yield hashFunc(blake512, param, 1024);
        argon2Interface.writeMemory(chunk, position * 1024);
      }
      const C = new Uint8Array(1024);
      writeHexToUInt8(C, argon2Interface.calculate(new Uint8Array([]), memorySize));
      const res = yield hashFunc(blake512, C, hashLength);
      if (options.outputType === "hex") {
        const digestChars = new Uint8Array(hashLength * 2);
        return getDigestHex(digestChars, res, hashLength);
      }
      if (options.outputType === "encoded") {
        return encodeResult(salt, options, res);
      }
      return res;
    });
  }
  var validateOptions$3 = (options) => {
    var _a3;
    if (!options || typeof options !== "object") {
      throw new Error("Invalid options parameter. It requires an object.");
    }
    if (!options.password) {
      throw new Error("Password must be specified");
    }
    options.password = getUInt8Buffer(options.password);
    if (options.password.length < 1) {
      throw new Error("Password must be specified");
    }
    if (!options.salt) {
      throw new Error("Salt must be specified");
    }
    options.salt = getUInt8Buffer(options.salt);
    if (options.salt.length < 8) {
      throw new Error("Salt should be at least 8 bytes long");
    }
    options.secret = getUInt8Buffer((_a3 = options.secret) !== null && _a3 !== void 0 ? _a3 : "");
    if (!Number.isInteger(options.iterations) || options.iterations < 1) {
      throw new Error("Iterations should be a positive number");
    }
    if (!Number.isInteger(options.parallelism) || options.parallelism < 1) {
      throw new Error("Parallelism should be a positive number");
    }
    if (!Number.isInteger(options.hashLength) || options.hashLength < 4) {
      throw new Error("Hash length should be at least 4 bytes.");
    }
    if (!Number.isInteger(options.memorySize)) {
      throw new Error("Memory size should be specified.");
    }
    if (options.memorySize < 8 * options.parallelism) {
      throw new Error("Memory size should be at least 8 * parallelism.");
    }
    if (options.outputType === void 0) {
      options.outputType = "hex";
    }
    if (!["hex", "binary", "encoded"].includes(options.outputType)) {
      throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary', 'encoded']`);
    }
  };
  function argon2id(options) {
    return __awaiter(this, void 0, void 0, function* () {
      validateOptions$3(options);
      return argon2Internal(Object.assign(Object.assign({}, options), { hashType: "id" }));
    });
  }
  var mutex$j = new Mutex();
  var mutex$i = new Mutex();
  var mutex$h = new Mutex();
  var mutex$g = new Mutex();
  var polyBuffer = new Uint8Array(8);
  var mutex$f = new Mutex();
  var mutex$e = new Mutex();
  var mutex$d = new Mutex();
  var mutex$c = new Mutex();
  var mutex$b = new Mutex();
  var mutex$a = new Mutex();
  var mutex$9 = new Mutex();
  var mutex$8 = new Mutex();
  var mutex$7 = new Mutex();
  var mutex$6 = new Mutex();
  var mutex$5 = new Mutex();
  var seedBuffer$2 = new Uint8Array(8);
  var mutex$4 = new Mutex();
  var seedBuffer$1 = new Uint8Array(8);
  var mutex$3 = new Mutex();
  var seedBuffer = new Uint8Array(8);
  var mutex$2 = new Mutex();
  var mutex$1 = new Mutex();
  var mutex = new Mutex();

  // src/shared/argon2.ts
  var hashWasmArgon2 = (password, salt, params) => argon2id({ password, salt, parallelism: params.p, iterations: params.t, memorySize: params.m, hashLength: 32, outputType: "binary" });

  // src/embedded/index.ts
  var receiveFromHost = () => {
    throw new Error("pappdrive.start(options, send) must run before pappdrive.receive(text).");
  };
  function start(opts, send3) {
    const channel = createChannel({
      send: send3,
      onMessage: (cb) => {
        receiveFromHost = cb;
      }
    });
    const background = /* @__PURE__ */ new Set();
    const platform = {
      argon2: hashWasmArgon2,
      openPrivate: openOpfs,
      async openVisible(path) {
        throw new SyncError("not-allowed", `A visible folder ("${path}") works only on the desktop. On a phone, open the private folder: open({ mode: "private" }).`);
      },
      async persist() {
        await navigator.storage.persist();
      },
      onBackground(cb) {
        background.add(cb);
        return () => {
          background.delete(cb);
        };
      }
    };
    channel.on({
      "host.background": async () => {
        await Promise.all([...background].map((cb) => cb()));
      }
    });
    serve(createPappCore(opts, platform, hostKeyStore(channel)), channel);
  }
  function receive(text) {
    receiveFromHost(text);
  }
  return __toCommonJS(embedded_exports);
})();
/*! Bundled license information:

hash-wasm/dist/index.esm.js:
  (*!
   * hash-wasm (https://www.npmjs.com/package/hash-wasm)
   * (c) Dani Biro
   * @license MIT
   *)
*/
