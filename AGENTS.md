Always think of code structure, component structure & design, top down data flow, clean with taste - code, prioritizing readability and maintainability.
No god objects and files.
No defensive programming
No fallbacks
No backwards comp
No legacy
No _avoidable_ normalizations code paths
A comment may only carry a fact from outside the code - a library behaviour, a spec, a browser quirk. Rationale for your own design goes in the commit message. The marker is not a stamp.

Never guess - trace the type, trace the usage, know the interface and its shape concretly and use it without the mentioned above.

Errors are part of the interface. Trace what can fail and which boundary owns recovery.
Never catch merely to log, suppress, continue, return success, return empty data, or provide a default value.
Catch only at a deliberate recovery boundary, translate the error to that boundary's explicit contract, or rethrow it.
Expected invalid input must have an explicit typed outcome. Unexpected failures propagate.

Prefer immutable bindings and initialize variables where they are declared.
Never split declaration from initialization to move a value across a try/catch boundary. Extract the boundary behind an interface that returns the concrete value.

No scratch files, scratch pages or throwaway harnesses, unless explicitly told so. Verify in the real app.

Simplicity is king, we think critically on "best practice" ( not all worth the cost )
duplication is ok if it makes the code simpler and cleaner

Never stage changes, unless explicitly told so. i will manually review them.
Never commit, unless explicitly told so
Never stash, unless explicitly told so
Never push, unless explicitly told so
Actually - You are alowed to do read only operation unless explicitly told so!

- Always know - i personally can stage files at any time, do not alram and do not do anything about that
- Always know - there could be several agents working in parrallel, if you suddenly see broken code from something that suddenly appeared / not you did, do not alarm - do not do anything about that, ignore.
- Never Ever touch non read only git commands unless explictly asked too.
- When asked to revert/go back/undo - lways do that manually and not via git unless explicitly told so.

Writing:

- Recall Churchill's 1940 "Brevity" memo. Say the whole point in the fewest words. Lead with it, detail after, cut the woolly connective tissue. Compression, not omission.
- Use direct English, then let William Zinsser (On Writing Well) redpen it. Strip preamble, restatement, hedges, and every word doing no work. Plain verbs over jargon. Rewrite before sending.
